/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 */
define(["N/record", "N/log"], (record, log) => {
  const ITEM_SUBLIST = "item";
  const PAID_FLAG = "custcol_hpl_itempaid";
  const HEADER_FLAG = "custbody_hpl_paidreleased";
  const NET30_ID = "2"; // "Net 30" internal ID

  const EXCLUDE_ITEMTYPES = new Set([
    "Subtotal",
    "Discount",
    "Description",
    "ShipItem",
    "TaxItem",
    "Group",
    "EndGroup",
    "Markup",
    "OthCharge",
    "Payment",
  ]);

  function afterSubmit(ctx) {
    try {
      const type = ctx.type;

      if (
        type !== ctx.UserEventType.APPROVE &&
        type !== ctx.UserEventType.EDIT
      ) {
        log.debug("Skip: event type not relevant", { type });
        return;
      }

      const oldApproved = isApprovedSafe(ctx.oldRecord);

      const soId = ctx.newRecord.id;
      const so = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });

      const nowApproved = isApprovedLoaded(so);
      const becameApproved =
        type === ctx.UserEventType.APPROVE ||
        (type === ctx.UserEventType.EDIT && !oldApproved && nowApproved);

      log.debug("Approval gate", {
        type,
        oldApproved,
        nowApproved,
        becameApproved,
      });

      if (!becameApproved) {
        log.debug("Skip: not an approval transition", { type });
        return;
      }

      const termsId = String(so.getValue("terms") || "");
      const termsText = (so.getText("terms") || "").trim();
      if (termsId !== NET30_ID && !/NET\s*30/i.test(termsText)) {
        log.debug("Skip: terms not Net 30", { termsId, termsText });
        return;
      }

      let changed = false;

      if (!truthy(so.getValue({ fieldId: HEADER_FLAG }))) {
        so.setValue({ fieldId: HEADER_FLAG, value: true });
        changed = true;
      }

      const n = so.getLineCount({ sublistId: ITEM_SUBLIST }) || 0;
      for (let i = 0; i < n; i++) {
        const itemType =
          so.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: "itemtype",
            line: i,
          }) || "";
        if (EXCLUDE_ITEMTYPES.has(itemType)) continue;

        const cur = so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line: i,
        });
        if (!truthy(cur)) {
          so.setSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: PAID_FLAG,
            line: i,
            value: true,
          });
          changed = true;
        }
      }

      if (changed) {
        so.save({ ignoreMandatoryFields: true, enableSourcing: false });
        log.audit("Net30 approval flags applied", {
          soId,
          termsId,
          termsText,
          lineCount: n,
        });
      } else {
        log.audit("No changes needed (already set)", {
          soId,
          termsId,
          termsText,
        });
      }
    } catch (e) {
      log.error("SO Net30 approval handler failed", e);
    }
  }

  // ---- helpers ----
  function isApprovedSafe(rec) {
    if (!rec) return false;
    const v = rec.getValue && rec.getValue("approvalstatus");
    if (String(v) === "2") return true;
    const t = (safeGetText(rec, "approvalstatus") || "").toLowerCase();
    return t === "approved";
  }

  function isApprovedLoaded(so) {
    const v = so.getValue("approvalstatus");
    if (String(v) === "2") return true;
    const t = (so.getText("approvalstatus") || "").toLowerCase();
    return t === "approved";
  }

  function safeGetText(rec, fld) {
    try {
      return rec.getText(fld);
    } catch (_) {
      return "";
    }
  }

  function truthy(v) {
    return v === true || v === "T";
  }

  return { afterSubmit };
});
