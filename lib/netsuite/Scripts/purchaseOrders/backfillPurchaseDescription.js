/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/search", "N/runtime", "N/url", "N/log"], (
  record,
  search,
  runtime,
  url,
  log
) => {
  const SUBLIST = "item";
  const LINE_ITEM_FIELD = "item";

  const LINE_FIELD = "custcol_hpl_item_purchase_description";

  const ITEM_FIELD = "purchasedescription";

  const MAX_LEN = 3900;

  const MIN_REMAINING_USAGE = 200;

  const itemCache = {};

  function s(v) {
    try {
      if (v === null || v === undefined) return "";
      const out = String(v);
      if (
        out.indexOf(
          "com.netsuite.suitescript.scriptobject.ScriptNullObjectAdapter@"
        ) === 0
      )
        return "";
      return out.trim();
    } catch (_) {
      return "";
    }
  }

  function trunc(v) {
    const out = s(v);
    return out && out.length > MAX_LEN ? out.slice(0, MAX_LEN) : out;
  }

  function esc(t) {
    return s(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function safeErr(e) {
    try {
      return esc(e && e.name ? `${e.name}: ${s(e.message || "")}` : s(e));
    } catch (_) {
      return "Unknown error (see execution log)";
    }
  }

  function getItemRecordType(itemId) {
    try {
      const r = search.lookupFields({
        type: "item",
        id: itemId,
        columns: ["recordtype"],
      });
      return s(r && r.recordtype);
    } catch (e) {
      log.debug({ title: "getItemRecordType failed", details: { itemId, e } });
      return "";
    }
  }

  function getPurchaseDesc(itemId) {
    if (!itemId) return "";
    if (itemCache[itemId] && itemCache[itemId].desc !== undefined)
      return itemCache[itemId].desc;

    try {
      const rt =
        (itemCache[itemId] && itemCache[itemId].rt) ||
        getItemRecordType(itemId);
      if (!rt) {
        itemCache[itemId] = { rt: "", desc: "" };
        return "";
      }

      itemCache[itemId] = itemCache[itemId] || { rt, desc: "" };
      itemCache[itemId].rt = rt;

      const itemRec = record.load({ type: rt, id: itemId, isDynamic: false });

      const v1 = trunc(itemRec.getValue({ fieldId: ITEM_FIELD }));
      let v2 = "";
      try {
        v2 = trunc(itemRec.getText({ fieldId: ITEM_FIELD }));
      } catch (_) {}

      const val = v1 || v2 || "";
      itemCache[itemId].desc = val;
      return val;
    } catch (e) {
      log.debug({ title: "getPurchaseDesc failed", details: { itemId, e } });
      itemCache[itemId] = {
        rt: (itemCache[itemId] && itemCache[itemId].rt) || "",
        desc: "",
      };
      return "";
    }
  }

  function backfillOnePO(poId) {
    const po = record.load({
      type: record.Type.PURCHASE_ORDER,
      id: poId,
      isDynamic: false,
    });
    const n = po.getLineCount({ sublistId: SUBLIST });

    let updated = 0,
      skipped = 0,
      lineErrors = 0;

    for (let i = 0; i < n; i++) {
      if (
        runtime.getCurrentScript().getRemainingUsage() < MIN_REMAINING_USAGE
      ) {
        return { lines: n, updated, skipped, lineErrors, stoppedEarly: true };
      }

      let existing = "";
      try {
        existing = s(
          po.getSublistValue({
            sublistId: SUBLIST,
            fieldId: LINE_FIELD,
            line: i,
          })
        );
      } catch (_) {}

      if (existing) {
        skipped++;
        continue;
      }

      let itemId = null;
      try {
        itemId = po.getSublistValue({
          sublistId: SUBLIST,
          fieldId: LINE_ITEM_FIELD,
          line: i,
        });
      } catch (_) {}

      if (!itemId) {
        skipped++;
        continue;
      }

      const desc = getPurchaseDesc(itemId);
      if (!desc) {
        skipped++;
        continue;
      }

      try {
        po.setSublistValue({
          sublistId: SUBLIST,
          fieldId: LINE_FIELD,
          line: i,
          value: desc,
        });
        updated++;
      } catch (e) {
        lineErrors++;
        log.error({
          title: "setSublistValue failed",
          details: { poId, line: i, itemId, len: desc.length, e },
        });
      }
    }

    if (updated > 0) {
      po.save({ enableSourcing: false, ignoreMandatoryFields: true });
    }

    return { lines: n, updated, skipped, lineErrors, stoppedEarly: false };
  }

  function getOpenPOIds({ limit, startAfter }) {
    const filters = [
      ["mainline", "is", "T"],
      "AND",
      ["memorized", "is", "F"],
      "AND",
      ["status", "noneof", "PurchOrd:H"], // exclude closed
    ];

    if (startAfter) {
      filters.push("AND", ["internalidnumber", "lessthan", String(startAfter)]);
    }

    const sSearch = search.create({
      type: search.Type.PURCHASE_ORDER,
      filters,
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.DESC }),
      ],
    });

    const ids = [];
    const res = sSearch
      .run()
      .getRange({ start: 0, end: Math.min(limit, 1000) });

    for (const r of res || []) {
      const id = Number(r.getValue({ name: "internalid" }));
      if (id) ids.push(id);
    }
    return ids;
  }

  function onRequest(ctx) {
    let html = "";
    try {
      const script = runtime.getCurrentScript();

      const limit = Math.max(
        1,
        Math.min(50, Number(ctx.request.parameters.limit || 5))
      );
      const startAfter = Number(ctx.request.parameters.startAfter || 0) || 0;

      const ids = getOpenPOIds({ limit, startAfter });

      let poChanged = 0,
        poNoChange = 0,
        poErrors = 0;
      let totalLinesUpdated = 0,
        totalLineErrors = 0;

      let lastProcessed = 0;
      let stoppedForGovernance = false;

      html += `<h2>PO Purchase Description Backfill (Open POs)</h2>
        <p><b>Batch limit:</b> ${limit} | <b>StartAfter:</b> ${
        startAfter || "(none)"
      } | <b>Remaining usage at start:</b> ${script.getRemainingUsage()}</p>
        <p>POs in this batch: <b>${ids.length}</b></p>
        <table border="1" cellpadding="6" cellspacing="0">
          <tr><th>PO ID</th><th>Lines</th><th>Updated</th><th>Skipped</th><th>Line Errors</th><th>Status</th></tr>`;

      for (const poId of ids) {
        lastProcessed = poId;

        // stop before the suitelet dies
        if (script.getRemainingUsage() < MIN_REMAINING_USAGE) {
          stoppedForGovernance = true;
          break;
        }

        try {
          const r = backfillOnePO(poId);
          totalLinesUpdated += r.updated;
          totalLineErrors += r.lineErrors;

          if (r.updated > 0) poChanged++;
          else poNoChange++;

          html += `<tr>
            <td>${poId}</td>
            <td>${r.lines}</td>
            <td>${r.updated}</td>
            <td>${r.skipped}</td>
            <td>${r.lineErrors}</td>
            <td>${r.stoppedEarly ? "STOPPED (usage low)" : "OK"}</td>
          </tr>`;

          if (r.stoppedEarly) {
            stoppedForGovernance = true;
            break;
          }
        } catch (e) {
          poErrors++;
          html += `<tr>
            <td>${poId}</td><td>-</td><td>-</td><td>-</td><td>-</td>
            <td style="color:red;">ERROR</td>
          </tr>`;
          log.error({ title: "PO backfill failed", details: { poId, e } });
        }
      }

      html += `</table>
        <p><b>Summary (this batch):</b> Changed POs: ${poChanged}, No change: ${poNoChange}, PO Errors: ${poErrors}, Total lines updated: ${totalLinesUpdated}, Line errors: ${totalLineErrors}</p>
        <p><b>Remaining usage at end:</b> ${script.getRemainingUsage()}</p>`;

      if (lastProcessed) {
        const nextUrl = url.resolveScript({
          scriptId: script.id,
          deploymentId: script.deploymentId,
          params: { limit: String(limit), startAfter: String(lastProcessed) },
        });
        html += `<p><a href="${nextUrl}">Continue next batch</a> (starts after PO internalid ${lastProcessed})</p>`;
      }

      if (stoppedForGovernance) {
        html += `<p><b>Stopped early to avoid crashing (usage low).</b> Click “Continue next batch”.</p>`;
      } else {
        html += `<p><b>Done.</b> If everything looks good, inactivate this deployment (one-time tool).</p>`;
      }

      ctx.response.write(html);
    } catch (e) {
      try {
        ctx.response.write(
          `<h2>Backfill failed (but didn’t crash)</h2><p>${safeErr(
            e
          )}</p><p>Check Script Execution Log for full details.</p>`
        );
      } catch (_) {}
    }
  }

  return { onRequest };
});
