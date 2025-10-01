/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/record",
  "N/url",
  "N/log",
  "N/runtime",
], function (ui, search, record, url, log, runtime) {
  const ITEM_SUBLIST = "item";
  const PAID_FLAG = "custcol_hpl_itempaid";
  const HEADER_FLAG = "custbody_hpl_paidreleased";
  const WARRANTY_TRACK = "custcol_wrm_reg_hid_trackwarranty";
  const CONFIRM_PARAM = "confirm";

  function onRequest(ctx) {
    const soParam = (ctx.request.parameters.so || "").trim();
    const formOverride = (ctx.request.parameters.form || "").trim();
    const confirmed = (ctx.request.parameters[CONFIRM_PARAM] || "") === "1";

    if (!soParam) {
      const f = ui.createForm({ title: "Unwind Related — Financials" });
      f.addField({
        id: "msg",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue =
        '<div style="color:#b00020">Missing Sales Order ID</div>';
      ctx.response.writePage(f);
      return;
    }

    const soId = resolveSOInternalId(soParam);
    if (!soId) {
      const f = ui.createForm({ title: "Unwind Related — Financials" });
      f.addField({
        id: "msg2",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue =
        '<div style="color:#b00020">Sales Order not found</div>';
      ctx.response.writePage(f);
      return;
    }

    log.audit("Start unwind", { soId, formOverride });

    const warnList = warrantyInvoicesForSO(soId);
    if (warnList.length && !confirmed) {
      const soUrl = url.resolveRecord({
        recordType: record.Type.SALES_ORDER,
        recordId: soId,
      });
      const proceedUrl = url.resolveScript({
        scriptId: runtime.getCurrentScript().id,
        deploymentId: runtime.getCurrentScript().deploymentId,
        params: { so: soParam, form: formOverride || "", [CONFIRM_PARAM]: "1" },
      });
      const f = ui.createForm({ title: "Unwind Related — Confirmation" });
      f.addField({
        id: "warn",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue = `
        <div style="font-family:system-ui,Arial,sans-serif">
          <div style="margin:10px 0;padding:10px;border:1px solid #fcd34d;background:#fff7ed;border-radius:8px;color:#b45309">
            <b>Heads up:</b> The following invoices have items with warranty tracking enabled. Proceeding will unapply payments/deposits and may delete invoices if fully clear.
          </div>
          <ul style="margin:8px 0 12px 16px">
            ${warnList
              .map((w) => `<li>Invoice <b>${h(w.tranid || w.id)}</b></li>`)
              .join("")}
          </ul>
          <div style="display:flex;gap:10px;">
            <a href="${proceedUrl}" style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;text-decoration:none">Proceed anyway</a>
            <a href="${soUrl}" style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;text-decoration:none">Cancel &amp; go back</a>
          </div>
        </div>
      `;
      ctx.response.writePage(f);
      return;
    }

    const invRows = findInvoicesForSO(soId).map((inv) =>
      processInvoice(inv.id, inv.tranid)
    );

    const flagsResult = clearPaidFlagsOnSO(soId, formOverride);
    log.audit("Flags cleared", flagsResult);

    const soUrl = url.resolveRecord({
      recordType: record.Type.SALES_ORDER,
      recordId: soId,
    });

    const invBlocks = invRows
      .map(
        (r) => `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:8px 0">
        <div><b>Invoice:</b> ${h(r.invoiceTranId || r.invoiceId)}</div>
        ${
          r.hasWarranty
            ? `<div style="margin:6px 0;padding:6px;border:1px solid #fcd34d;background:#fff7ed;border-radius:6px;color:#b45309">
                 <b>Warranty warning:</b> This invoice has at least one item with warranty tracking enabled.
               </div>`
            : ""
        }
        <div>Payments unapplied: ${
          r.paymentsUnapplied.length
            ? r.paymentsUnapplied.map(h).join(", ")
            : "—"
        }</div>
        <div>Deposit applications deleted: ${
          r.depositAppsDeleted.length
            ? r.depositAppsDeleted.map(h).join(", ")
            : "—"
        }</div>
        <div>${
          r.deletedInvoice
            ? '<span style="color:#047857"><b>Invoice deleted</b></span>'
            : "Invoice kept"
        }</div>
        ${
          r.blockers.length
            ? `<div style="color:#b00020">Blockers: ${h(
                r.blockers.join(", ")
              )}</div>`
            : ""
        }
        ${
          r.errors.length
            ? `<div style="color:#b00020">Errors: ${h(
                r.errors.join(" | ")
              )}</div>`
            : ""
        }
      </div>`
      )
      .join("");

    const form = ui.createForm({ title: "Unwind Related — Financials" });
    form.addField({
      id: "out",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `
      <div style="font-family:system-ui,Arial,sans-serif">
        <h2 style="margin:0 0 8px 0">Unwind Related — Financials</h2>
        <div>Sales Order: <b>${h(soId)}</b></div>
        <div style="color:#4b5563;margin:8px 0">Unapplied payments & deposit applications removed; invoices deleted when fully clear.</div>
        ${
          invRows.length ? invBlocks : "No invoices found for this Sales Order."
        }
        <div style="margin-top:10px"><a href="${soUrl}">Back to Sales Order</a></div>
      </div>`;
    ctx.response.writePage(form);
  }

  function resolveSOInternalId(val) {
    if (/^\d+$/.test(val)) return val;
    const s = search.create({
      type: search.Type.SALES_ORDER,
      filters: [["tranid", "is", val]],
      columns: ["internalid"],
    });
    const r = s.run().getRange({ start: 0, end: 1 });
    if (r && r[0]) return r[0].getValue("internalid");
    return null;
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
    log.debug("Invoices found", { soId, count: out.length });
    return out;
  }

  function invoiceHasWarranty(invoiceId) {
    try {
      const s = search.create({
        type: "invoice",
        filters: [
          ["internalid", "anyof", String(invoiceId)],
          "AND",
          ["mainline", "is", "F"],
          "AND",
          [WARRANTY_TRACK, "is", "T"],
        ],
        columns: ["internalid"],
      });
      const res = s.run().getRange({ start: 0, end: 1 });
      return !!(res && res.length);
    } catch (e) {
      log.error("invoiceHasWarranty failed", {
        invoiceId,
        err: e && e.message,
      });
      return false;
    }
  }

  function warrantyInvoicesForSO(soId) {
    const invs = findInvoicesForSO(soId);
    const hits = [];
    for (const inv of invs) {
      if (invoiceHasWarranty(inv.id)) hits.push(inv);
    }
    return hits;
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
      hasWarranty: false,
    };
    try {
      res.hasWarranty = invoiceHasWarranty(invoiceId);

      let applying = findApplying(invoiceId);
      log.debug("Applying transactions", {
        invoiceId,
        count: applying.length,
        list: applying,
      });

      for (const a of applying) {
        try {
          if (a.type === "CustPymt") {
            unapplyPayment(a.id);
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
          log.audit("Invoice deleted", { invoiceId, invoiceTranId });
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
        log.debug("Invoice kept due to blockers", {
          invoiceId,
          blockers: res.blockers,
        });
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

  function unapplyPayment(paymentId) {
    const r = record.load({
      type: record.Type.CUSTOMER_PAYMENT,
      id: paymentId,
      isDynamic: false,
    });
    const n = r.getLineCount({ sublistId: "apply" }) || 0;
    let toggled = 0;
    for (let i = 0; i < n; i++) {
      try {
        const cur = !!r.getSublistValue({
          sublistId: "apply",
          fieldId: "apply",
          line: i,
        });
        if (cur) {
          r.setSublistValue({
            sublistId: "apply",
            fieldId: "apply",
            line: i,
            value: false,
          });
          toggled++;
        }
      } catch (_) {}
    }
    r.save({ enableSourcing: false, ignoreMandatoryFields: true });
    log.debug("Unapplied payment lines", { paymentId, toggled, total: n });
  }

  function clearPaidFlagsOnSO(soId, formOverride) {
    const idNum = parseInt(String(soId), 10);

    let headerCleared = false;
    try {
      record.submitFields({
        type: record.Type.SALES_ORDER,
        id: idNum,
        values: { [HEADER_FLAG]: false },
        options: { ignoreMandatoryFields: true, enablesourcing: false },
      });
      headerCleared = true;
      log.debug("Header flag cleared via submitFields", {
        soId: idNum,
        field: HEADER_FLAG,
      });
    } catch (e) {
      log.error("Header submitFields failed", {
        soId: idNum,
        err: e && e.message,
      });
    }

    const currentForm = lookupForm(idNum);
    const triedForms = [];
    let switched = false;
    let loadOk = false;
    let so = null;

    const candidates = [];
    if (formOverride) candidates.push(formOverride);
    candidates.push(currentForm);
    candidates.push("124", "135", "149", "120", "128");

    for (const formId of candidates) {
      if (!formId || triedForms.indexOf(formId) >= 0) continue;
      triedForms.push(formId);
      try {
        if (String(formId) !== String(currentForm)) {
          record.submitFields({
            type: record.Type.SALES_ORDER,
            id: idNum,
            values: { customform: Number(formId) },
            options: { ignoreMandatoryFields: true, enablesourcing: false },
          });
          switched = true;
          log.debug("Temporarily switched SO form", { soId: idNum, formId });
        }
        try {
          so = record.load({
            type: record.Type.SALES_ORDER,
            id: idNum,
            isDynamic: false,
          });
          loadOk = true;
          break;
        } catch (e1) {
          log.error("SO load failed after form switch", {
            soId: idNum,
            formId,
            err: e1 && e1.message,
          });
          continue;
        }
      } catch (e0) {
        log.error("Form switch failed", {
          soId: idNum,
          formId,
          err: e0 && e0.message,
        });
        continue;
      }
    }

    if (!loadOk) {
      try {
        if (switched && currentForm) {
          record.submitFields({
            type: record.Type.SALES_ORDER,
            id: idNum,
            values: { customform: Number(currentForm) },
            options: { ignoreMandatoryFields: true, enablesourcing: false },
          });
        }
      } catch (_) {}
      return {
        soId: idNum,
        ok: false,
        reason: "load_failed",
        headerCleared,
        triedForms,
      };
    }

    const n = Number(so.getLineCount({ sublistId: ITEM_SUBLIST }) || 0);
    let attempted = 0;
    let setFalse = 0;
    let skipped = 0;

    for (let i = 0; i < n; i++) {
      try {
        const hasField = !!so.getSublistField({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line: i,
        });
        if (!hasField) {
          skipped++;
          continue;
        }
        const cur = so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line: i,
        });
        attempted++;
        so.setSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line: i,
          value: "F",
        });
        if (cur === true || cur === "T") setFalse++;
      } catch (e) {
        log.debug("Line unset skipped", {
          soId: idNum,
          line: i,
          field: PAID_FLAG,
          err: e && e.message,
        });
      }
    }

    let saveId = null;
    try {
      saveId = so.save({ ignoreMandatoryFields: true, enableSourcing: false });
    } catch (e) {
      try {
        if (switched && currentForm) {
          record.submitFields({
            type: record.Type.SALES_ORDER,
            id: idNum,
            values: { customform: Number(currentForm) },
            options: { ignoreMandatoryFields: true, enablesourcing: false },
          });
        }
      } catch (_) {}
      log.error("SO save failed", {
        soId: idNum,
        err: e && e.message,
        attempted,
        setFalse,
        skipped,
        triedForms,
      });
      return {
        soId: idNum,
        ok: false,
        reason: "save_failed",
        headerCleared,
        attempted,
        setFalse,
        skipped,
        triedForms,
      };
    }

    try {
      if (switched && currentForm) {
        record.submitFields({
          type: record.Type.SALES_ORDER,
          id: idNum,
          values: { customform: Number(currentForm) },
          options: { ignoreMandatoryFields: true, enablesourcing: false },
        });
        log.debug("Restored original SO form", {
          soId: idNum,
          formId: currentForm,
        });
      }
    } catch (e) {
      log.error("Restore original form failed", {
        soId: idNum,
        err: e && e.message,
      });
    }

    log.audit("SO flags cleared", {
      soId: idNum,
      headerCleared,
      linesAttempted: attempted,
      linesSetFalse: setFalse,
      linesSkippedNoField: skipped,
      saveId,
      triedForms,
    });
    return {
      soId: idNum,
      ok: true,
      headerCleared,
      linesAttempted: attempted,
      linesSetFalse: setFalse,
      linesSkippedNoField: skipped,
      saveId,
      triedForms,
    };
  }

  function lookupForm(soId) {
    try {
      const r = search.lookupFields({
        type: search.Type.SALES_ORDER,
        id: soId,
        columns: ["customform"],
      });
      const v =
        r &&
        r.customform &&
        (Array.isArray(r.customform)
          ? r.customform[0] && r.customform[0].value
          : r.customform[0] && r.customform[0].value);
      if (typeof v === "number" || /^\d+$/.test(String(v || "")))
        return String(v);
    } catch (e) {
      log.error("lookupForm failed", { soId, err: e && e.message });
    }
    return "";
  }

  function h(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  return { onRequest };
});
