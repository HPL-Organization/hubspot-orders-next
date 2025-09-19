/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/record", "N/url"], (
  ui,
  search,
  record,
  url
) => {
  const DONE_TEXTS = ["COMPLETED", "COMPLETE", "DONE", "CLOSED"];

  function onRequest(ctx) {
    const soId = (ctx.request.parameters.so || "").trim();
    const form = ui.createForm({ title: "Unwind Related" });
    if (!soId) {
      form.addField({
        id: "msg",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue =
        '<div style="color:#b00020">Missing Sales Order ID</div>';
      return void ctx.response.writePage(form);
    }

    const soTranId = getSoTranId(soId);
    const invoices = findInvoicesForSO(soId);
    const invRes = invoices.map((inv) => processInvoice(inv.id, inv.tranid));
    const pt = findPickTasksForSO(soId, soTranId);

    form.addField({
      id: "out",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = renderSummary(invRes, soId, soTranId, pt);

    const soUrl = url.resolveRecord({
      recordType: record.Type.SALES_ORDER,
      recordId: soId,
    });
    form.addField({
      id: "back",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `<div style="margin-top:10px"><a href="${soUrl}">Back to Sales Order</a></div>`;

    ctx.response.writePage(form);
  }

  function findInvoicesForSO(soId) {
    const s = search.create({
      type: "invoice",
      filters: [["createdfrom", "anyof", soId], "AND", ["mainline", "is", "T"]],
      columns: ["internalid", "tranid"],
    });
    const out = [];
    s.run().each((r) => {
      out.push({ id: r.getValue("internalid"), tranid: r.getValue("tranid") });
      return true;
    });
    return out;
  }

  function processInvoice(invoiceId, invoiceTranId) {
    const res = {
      invoiceId,
      invoiceTranId,
      paymentsUnapplied: [],
      depositAppsDeleted: [],
      deletedInvoice: false,
      keptInvoice: false,
      blockers: [],
      errors: [],
    };
    try {
      let applying = findApplying(invoiceId);
      for (const a of applying) {
        try {
          if (a.type === "CustPymt") {
            unapplyPayment(a.id, invoiceId, invoiceTranId);
            res.paymentsUnapplied.push(a.tranid || a.id);
          } else if (a.type === "DepAppl") {
            record.delete({ type: record.Type.DEPOSIT_APPLICATION, id: a.id });
            res.depositAppsDeleted.push(a.tranid || a.id);
          } else {
            res.blockers.push(`${a.type}:${a.tranid || a.id}`);
          }
        } catch (e) {
          res.errors.push(`${a.type} ${a.tranid || a.id}: ${e.message}`);
        }
      }
      applying = findApplying(invoiceId);
      if (applying.length === 0) {
        try {
          record.delete({ type: record.Type.INVOICE, id: invoiceId });
          res.deletedInvoice = true;
        } catch (e) {
          res.errors.push(
            `Delete Invoice ${invoiceTranId || invoiceId}: ${e.message}`
          );
          res.keptInvoice = true;
        }
      } else {
        res.keptInvoice = true;
        applying.forEach((x) =>
          res.blockers.push(`${x.type}:${x.tranid || x.id}`)
        );
      }
    } catch (e) {
      res.errors.push(e.message || String(e));
      res.keptInvoice = true;
    }
    return res;
  }

  function findApplying(invoiceId) {
    const s = search.create({
      type: "invoice",
      filters: [["internalid", "anyof", String(invoiceId)]],
      columns: [
        search.createColumn({
          name: "internalid",
          join: "applyingTransaction",
        }),
        search.createColumn({ name: "type", join: "applyingTransaction" }),
        search.createColumn({ name: "tranid", join: "applyingTransaction" }),
      ],
    });
    const out = [];
    s.run().each((r) => {
      const id = r.getValue({
        name: "internalid",
        join: "applyingTransaction",
      });
      const typ = r.getValue({ name: "type", join: "applyingTransaction" });
      const tid = r.getValue({ name: "tranid", join: "applyingTransaction" });
      if (id) out.push({ id, type: typ, tranid: tid });
      return true;
    });
    return out;
  }

  function unapplyPayment(paymentId, invoiceId, invoiceTranId) {
    const pay = record.load({
      type: record.Type.CUSTOMER_PAYMENT,
      id: paymentId,
      isDynamic: false,
    });
    const n = pay.getLineCount({ sublistId: "apply" });
    let touched = false;
    for (let i = 0; i < n; i++) {
      const isApplied = !!pay.getSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        line: i,
      });
      const targetId = safeGet(pay, "apply", "internalid", i);
      const doc = safeGet(pay, "apply", "doc", i);
      const refnum = safeGet(pay, "apply", "refnum", i);
      const match =
        (targetId && String(targetId) === String(invoiceId)) ||
        (invoiceTranId &&
          (String(doc) === String(invoiceTranId) ||
            String(refnum) === String(invoiceTranId)));
      if (isApplied && match) {
        pay.setSublistValue({
          sublistId: "apply",
          fieldId: "apply",
          line: i,
          value: false,
        });
        touched = true;
      }
    }
    if (touched) pay.save({ ignoreMandatoryFields: true });
  }

  function getSoTranId(soId) {
    try {
      const obj = search.lookupFields({
        type: record.Type.SALES_ORDER,
        id: soId,
        columns: ["tranid"],
      });
      const t1 =
        obj &&
        (obj.tranid || (obj.tranid && obj.tranid[0] && obj.tranid[0].text));
      if (t1) return String(t1);
    } catch (_) {}
    try {
      let t2 = null;
      search
        .create({
          type: "salesorder",
          filters: [
            ["internalid", "anyof", soId],
            "AND",
            ["mainline", "is", "T"],
          ],
          columns: ["tranid"],
        })
        .run()
        .each((r) => {
          t2 = r.getValue("tranid");
          return false;
        });
      if (t2) return String(t2);
    } catch (_) {}
    try {
      const so = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });
      const t3 = so.getValue("tranid");
      if (t3) return String(t3);
    } catch (_) {}
    return null;
  }

  function findPickTasksForSO(soId, soTranId) {
    const seen = {};
    const rows = [];

    function pushRow(r) {
      const id = r.getValue("internalid");
      if (seen[id]) return;
      seen[id] = true;
      rows.push({
        id,
        status: (r.getText("status") || r.getValue("status") || "").toString(),
        soTran: (
          r.getValue({ name: "tranid", join: "transaction" }) || ""
        ).toString(),
      });
    }

    try {
      search
        .create({
          type: "picktask",
          filters: [
            search.createFilter({
              name: "internalid",
              join: "transaction",
              operator: search.Operator.ANYOF,
              values: [soId],
            }),
          ],
          columns: [
            "internalid",
            "status",
            search.createColumn({ name: "tranid", join: "transaction" }),
          ],
        })
        .run()
        .each((r) => {
          pushRow(r);
          return true;
        });
    } catch (_) {}

    if (soTranId) {
      try {
        search
          .create({
            type: "picktask",
            filters: [
              search.createFilter({
                name: "tranid",
                join: "transaction",
                operator: search.Operator.IS,
                values: [soTranId],
              }),
            ],
            columns: [
              "internalid",
              "status",
              search.createColumn({ name: "tranid", join: "transaction" }),
            ],
          })
          .run()
          .each((r) => {
            pushRow(r);
            return true;
          });
      } catch (_) {}
    }

    const isClosed = (t) => {
      const x = (t || "").toUpperCase();
      return DONE_TEXTS.some((d) => x.indexOf(d) >= 0);
    };

    const openIds = [],
      closedIds = [];
    for (const r of rows) (isClosed(r.status) ? closedIds : openIds).push(r.id);

    return {
      openCount: openIds.length,
      closedCount: closedIds.length,
      openSample: openIds.slice(0, 5),
      closedSample: closedIds.slice(0, 5),
      openAll: openIds,
      closedAll: closedIds,
    };
  }

  function safeGet(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({ sublistId, fieldId, line });
    } catch {
      return null;
    }
  }

  function renderSummary(invRows, soId, soTranId, pt) {
    const invBlocks = invRows
      .map(
        (r) => `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:8px 0">
        <div><b>Invoice:</b> ${escapeHtml(r.invoiceTranId || r.invoiceId)}</div>
        <div>Payments unapplied: ${
          r.paymentsUnapplied.length
            ? r.paymentsUnapplied.map(escapeHtml).join(", ")
            : "—"
        }</div>
        <div>Deposit applications deleted: ${
          r.depositAppsDeleted.length
            ? r.depositAppsDeleted.map(escapeHtml).join(", ")
            : "—"
        }</div>
        <div>${
          r.deletedInvoice
            ? '<span style="color:#047857"><b>Invoice deleted</b></span>'
            : "Invoice kept"
        }</div>
        ${
          r.blockers.length
            ? `<div style="color:#6b21a8;margin-top:4px"><b>Remaining blockers:</b> ${r.blockers
                .map(escapeHtml)
                .join(", ")}</div>`
            : ""
        }
        ${
          r.errors.length
            ? `<div style="color:#b00020;margin-top:4px"><b>Errors:</b><br>${r.errors
                .map(escapeHtml)
                .join("<br>")}</div>`
            : ""
        }
      </div>`
      )
      .join("");

    const pickBlock = `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:8px 0">
        <div><b>Pick Tasks linked to SO:</b></div>
        <div>Open (not completed): ${pt.openCount}${
      pt.openSample.length
        ? ` — sample: ${pt.openSample.map(escapeHtml).join(" · ")}`
        : ""
    }</div>
        <div>Completed (DONE): ${pt.closedCount}${
      pt.closedSample.length
        ? ` — sample: ${pt.closedSample.map(escapeHtml).join(" · ")}`
        : ""
    }</div>
        ${
          pt.closedAll && pt.closedAll.length
            ? `<div style="margin-top:6px;font-size:12px;color:#374151">All completed IDs: ${escapeHtml(
                pt.closedAll.join(", ")
              )}</div>`
            : ""
        }
      </div>`;

    return `
      <div style="font-family:system-ui,Arial,sans-serif">
        <h2 style="margin:0 0 8px 0">Unwind Summary</h2>
        <div>Sales Order: <b>${escapeHtml(soId)}</b></div>
        <div style="color:#4b5563;margin:8px 0">Invoices handled; Pick Tasks detected (open vs completed).</div>
        ${invBlocks || "No invoices found for this Sales Order."}
        ${pickBlock}
      </div>`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  return { onRequest };
});
