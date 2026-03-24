/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/query", "N/log"], function (record, query, log) {
  // If true, logs what it would do but does not set shipcomplete
  const DRY_RUN = false;

  // Only these line item types are considered "real" shippable lines
  const ALLOWED_ITEMTYPES = new Set([
    "InvtPart",
    "Assembly",
    "NonInvtPart",
    "Service",
    "ServiceResale",
  ]);

  function isSkuAllowed(sku) {
    if (!sku) return false;
    const s = String(sku).toUpperCase();
    return s.indexOf("L-") === 0 || s.indexOf("RR") === 0;
  }

  function safeGetSublistValue(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({ sublistId, fieldId, line });
    } catch (e) {
      return null;
    }
  }

  function getFullSoRecordIfNeeded(context) {
    const rec = context.newRecord;

    // XEDIT often doesn't include sublists; load full SO so we can inspect lines.
    // For create/edit/copy, we can use newRecord directly.
    if (context.type === context.UserEventType.XEDIT) {
      const id = rec.id;
      if (id) {
        return record.load({
          type: record.Type.SALES_ORDER,
          id: id,
          isDynamic: false,
        });
      }
    }
    return rec;
  }

  function beforeSubmit(context) {
    // Only run on saves where a record exists and it makes sense
    if (
      context.type !== context.UserEventType.CREATE &&
      context.type !== context.UserEventType.EDIT &&
      context.type !== context.UserEventType.COPY &&
      context.type !== context.UserEventType.XEDIT
    ) {
      return;
    }

    const soRec = getFullSoRecordIfNeeded(context);

    // If already ship complete, do nothing
    const shipCompleteVal = soRec.getValue({ fieldId: "shipcomplete" });
    const shipComplete =
      shipCompleteVal === true ||
      shipCompleteVal === "T" ||
      shipCompleteVal === "true";
    if (shipComplete) return;

    const lineCount = soRec.getLineCount({ sublistId: "item" }) || 0;
    if (!lineCount) return;

    const itemIds = [];
    const relevantLines = [];
    for (let i = 0; i < lineCount; i++) {
      const isClosed = safeGetSublistValue(soRec, "item", "isclosed", i);
      if (isClosed === true || isClosed === "T") continue;

      const itemType = safeGetSublistValue(soRec, "item", "itemtype", i);
      if (itemType && !ALLOWED_ITEMTYPES.has(String(itemType))) continue;

      const itemId = safeGetSublistValue(soRec, "item", "item", i);
      const itemIdNum = Number(itemId || 0);
      if (!(itemIdNum > 0)) continue;

      relevantLines.push({ line: i, itemId: itemIdNum });
      itemIds.push(itemIdNum);
    }

    if (!relevantLines.length) return;

    const unique = Array.from(new Set(itemIds));
    const inList = unique.join(",");

    const skuMap = {};
    const rows =
      query
        .runSuiteQL({
          query: "SELECT id, itemid FROM item WHERE id IN (" + inList + ")",
        })
        .asMappedResults() || [];

    for (let r of rows) {
      skuMap[Number(r.id)] = String(r.itemid || "");
    }

    for (let k = 0; k < relevantLines.length; k++) {
      const itemId = relevantLines[k].itemId;
      const sku = skuMap[itemId] || "";
      if (!isSkuAllowed(sku)) {
        return;
      }
    }

    if (DRY_RUN) {
      log.audit("DRY_RUN: would set shipcomplete=T", {
        salesorder: soRec.id || "(new)",
        lineCount: relevantLines.length,
      });
      return;
    }

    soRec.setValue({ fieldId: "shipcomplete", value: true });

    log.audit("Set shipcomplete=T (L-/RR-only order)", {
      salesorder: soRec.id || "(new)",
      relevantLines: relevantLines.length,
    });
  }

  return {
    beforeSubmit: beforeSubmit,
  };
});
