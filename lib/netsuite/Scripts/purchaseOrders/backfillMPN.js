/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/search"], (record, search) => {
  const SUBLIST = "item";
  const LINE_ITEM_FIELD = "item";
  const LINE_MPN_FIELD = "custcol_hpl_item_mpn"; // your PO line field id
  const ITEM_MPN_FIELD = "mpn"; // item field id

  function safeStr(v) {
    // Handles ScriptNullObjectAdapter safely
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function lookupItemMpn(itemId) {
    if (!itemId) return "";
    const res = search.lookupFields({
      type: search.Type.ITEM,
      id: itemId,
      columns: [ITEM_MPN_FIELD],
    });
    return safeStr(res && res[ITEM_MPN_FIELD]);
  }

  function backfillOnePO(poId) {
    const po = record.load({
      type: record.Type.PURCHASE_ORDER,
      id: poId,
      isDynamic: false,
    });

    const lineCount = po.getLineCount({ sublistId: SUBLIST });
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < lineCount; i++) {
      const existing = safeStr(
        po.getSublistValue({
          sublistId: SUBLIST,
          fieldId: LINE_MPN_FIELD,
          line: i,
        })
      );
      if (existing) {
        skipped++;
        continue;
      }

      const itemId = po.getSublistValue({
        sublistId: SUBLIST,
        fieldId: LINE_ITEM_FIELD,
        line: i,
      });
      if (!itemId) {
        skipped++;
        continue;
      }

      const mpn = lookupItemMpn(itemId);
      if (!mpn) {
        skipped++;
        continue;
      }

      po.setSublistValue({
        sublistId: SUBLIST,
        fieldId: LINE_MPN_FIELD,
        line: i,
        value: mpn,
      });
      updated++;
    }

    if (updated > 0) {
      po.save({ enableSourcing: false, ignoreMandatoryFields: true });
    }

    return { lineCount, updated, skipped };
  }

  function getOpenPOIds() {
    // Open POs only (status filter may vary by account, but PurchOrd:H = Closed is commonly valid)
    const s = search.create({
      type: search.Type.PURCHASE_ORDER,
      filters: [
        ["mainline", "is", "T"],
        "AND",
        ["memorized", "is", "F"],
        "AND",
        ["status", "noneof", "PurchOrd:H"], // exclude closed
      ],
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.DESC }),
      ],
    });

    const ids = [];
    const paged = s.runPaged({ pageSize: 1000 });

    for (const pr of paged.pageRanges) {
      const page = paged.fetch({ index: pr.index });
      for (const r of page.data) {
        const id = Number(r.getValue({ name: "internalid" }));
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  function onRequest(ctx) {
    try {
      const ids = getOpenPOIds();

      let poChanged = 0;
      let poNoChange = 0;
      let errors = 0;
      let totalLinesUpdated = 0;

      let html = `<h2>PO MPN Backfill (Open POs)</h2>
        <p>POs found: <b>${ids.length}</b></p>
        <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>PO ID</th><th>Lines</th><th>Updated</th><th>Skipped</th><th>Status</th></tr>`;

      for (const poId of ids) {
        try {
          const r = backfillOnePO(poId);
          totalLinesUpdated += r.updated;
          if (r.updated > 0) poChanged++;
          else poNoChange++;

          html += `<tr>
            <td>${poId}</td>
            <td>${r.lineCount}</td>
            <td>${r.updated}</td>
            <td>${r.skipped}</td>
            <td>OK</td>
          </tr>`;
        } catch (e) {
          errors++;
          html += `<tr>
            <td>${poId}</td><td>-</td><td>-</td><td>-</td>
            <td style="color:red;">${safeStr(
              e && e.message ? e.message : e
            )}</td>
          </tr>`;
        }
      }

      html += `</table>
        <p><b>Summary:</b> Changed POs: ${poChanged}, No change: ${poNoChange}, Errors: ${errors}, Total lines updated: ${totalLinesUpdated}</p>
        <p>After verifying, inactivate this Suitelet deployment (one-time).</p>`;

      ctx.response.write(html);
    } catch (e) {
      ctx.response.write(
        `<h2>PO MPN Backfill</h2><p style="color:red;"><b>Error:</b> ${safeStr(
          e && e.message ? e.message : e
        )}</p>`
      );
    }
  }

  return { onRequest };
});
