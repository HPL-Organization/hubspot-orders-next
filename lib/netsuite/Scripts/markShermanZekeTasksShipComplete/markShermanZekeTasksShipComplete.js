/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/query", "N/log"], function (record, query, log) {
  const DRY_RUN = false;

  const TARGET_ITEMIDS = new Set(["ZEKE ORDER TASK", "SHERMAN ORDER TASK"]);

  function safeGetSublistValue(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({ sublistId, fieldId, line });
    } catch (e) {
      return null;
    }
  }

  function asBool(v) {
    return v === true || v === "T" || v === "true";
  }

  function getFullSoRecordIfNeeded(context) {
    const rec = context.newRecord;

    if (context.type === context.UserEventType.XEDIT) {
      const id = rec.id;
      if (id) {
        return record.load({
          type: record.Type.SALES_ORDER,
          id,
          isDynamic: false,
        });
      }
    }
    return rec;
  }

  function beforeSubmit(context) {
    if (
      context.type !== context.UserEventType.CREATE &&
      context.type !== context.UserEventType.EDIT &&
      context.type !== context.UserEventType.COPY &&
      context.type !== context.UserEventType.XEDIT
    ) {
      return;
    }

    const newRec = context.newRecord;

    const shipCompleteVal = newRec.getValue({ fieldId: "shipcomplete" });
    if (asBool(shipCompleteVal)) return;

    const soRec = getFullSoRecordIfNeeded(context);
    const lineCount = soRec.getLineCount({ sublistId: "item" }) || 0;
    if (!lineCount) return;

    const itemIds = [];
    for (let i = 0; i < lineCount; i++) {
      const isClosed = safeGetSublistValue(soRec, "item", "isclosed", i);
      if (asBool(isClosed)) continue;

      const itemId = safeGetSublistValue(soRec, "item", "item", i);
      const itemIdNum = Number(itemId || 0);
      if (!(itemIdNum > 0)) continue;

      itemIds.push(itemIdNum);
    }

    if (!itemIds.length) return;

    const unique = Array.from(new Set(itemIds));
    const inList = unique.join(",");

    const rows =
      query
        .runSuiteQL({
          query: "SELECT id, itemid FROM item WHERE id IN (" + inList + ")",
        })
        .asMappedResults() || [];

    let found = false;
    for (const r of rows) {
      const sku = String(r.itemid || "")
        .trim()
        .toUpperCase();
      if (TARGET_ITEMIDS.has(sku)) {
        found = true;
        break;
      }
    }

    if (!found) return;

    if (DRY_RUN) {
      log.audit("DRY_RUN: would set shipcomplete=T (task item present)", {
        salesorder: soRec.id || newRec.id || "(new)",
      });
      return;
    }

    newRec.setValue({ fieldId: "shipcomplete", value: true });

    log.audit("Set shipcomplete=T (task item present)", {
      salesorder: soRec.id || newRec.id || "(new)",
    });
  }

  return {
    beforeSubmit,
  };
});
