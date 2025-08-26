/**
 *@NApiVersion 2.1
 *@NScriptType ClientScript
 */
define(["N/search"], (search) => {
  const TARGET = {
    headerPickCartons: "custbody_hpl_cartons", // header: Cartons used
    lineSerialField: "custcol_hpl_serialnumber", // line column: Serial#
  };

  const PICK_CARTON_FIELD_ID = "custrecord_wms_pickcarton";

  let bulkWriteInProgress = false;

  function dbg(...a) {
    try {
      console.log("[IF-CS]", ...a);
    } catch (_) {}
  }
  function dedupe(arr) {
    return Array.from(new Set(arr));
  }

  function getInvDetailIfExists(rec, line /* null => current line */) {
    try {
      if (line == null) {
        if (
          typeof rec.hasCurrentSublistSubrecord === "function" &&
          rec.hasCurrentSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
          })
        ) {
          return rec.getCurrentSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
          });
        }
      } else {
        if (
          typeof rec.hasSublistSubrecord === "function" &&
          rec.hasSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
            line,
          })
        ) {
          return rec.getSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
            line,
          });
        }
      }
    } catch (_) {}
    return null;
  }

  function getText(subrec, sublistId, fieldId, line) {
    try {
      return subrec.getSublistText({ sublistId, fieldId, line }) || "";
    } catch (_) {
      return "";
    }
  }
  function getVal(subrec, sublistId, fieldId, line) {
    try {
      return subrec.getSublistValue({ sublistId, fieldId, line });
    } catch (_) {
      return "";
    }
  }

  function lookupInventoryNumberText(id) {
    try {
      const res = search.lookupFields({
        type: "inventorynumber",
        id,
        columns: ["inventorynumber"],
      });
      return (res && res.inventorynumber) || "";
    } catch (_) {
      return "";
    }
  }

  function readAssignments(invDetail) {
    const n = invDetail.getLineCount({ sublistId: "inventoryassignment" }) || 0;
    const serials = [];
    const pickCartons = [];

    for (let r = 0; r < n; r++) {
      let serialText =
        getText(invDetail, "inventoryassignment", "issueinventorynumber", r) ||
        getText(
          invDetail,
          "inventoryassignment",
          "receiptinventorynumber",
          r
        ) ||
        getText(invDetail, "inventoryassignment", "inventorynumber", r);

      if (!serialText) {
        const id =
          getVal(invDetail, "inventoryassignment", "issueinventorynumber", r) ||
          getVal(
            invDetail,
            "inventoryassignment",
            "receiptinventorynumber",
            r
          ) ||
          getVal(invDetail, "inventoryassignment", "inventorynumber", r);
        if (id) serialText = lookupInventoryNumberText(id);
      }
      if (serialText) serials.push(String(serialText));

      const pc =
        getText(invDetail, "inventoryassignment", PICK_CARTON_FIELD_ID, r) ||
        getVal(invDetail, "inventoryassignment", PICK_CARTON_FIELD_ID, r);
      if (pc) pickCartons.push(String(pc));
    }

    return { serials: dedupe(serials), pickCartons: dedupe(pickCartons) };
  }

  function pageInit(context) {
    dbg("pageInit");
    try {
      const rec = context.currentRecord;
      if ((rec.getLineCount({ sublistId: "item" }) || 0) === 0) return;
      recomputeHeaderPickCartons(rec);
    } catch (e) {
      dbg("pageInit header recompute error", e && (e.message || e));
    }
  }

  function validateLine(context) {
    if (context.sublistId !== "item") return true;
    if (bulkWriteInProgress) {
      dbg("validateLine skipped (bulk write)");
      return true;
    }

    const rec = context.currentRecord;
    dbg("validateLine:item");

    try {
      setSerialsForCurrentLine(rec);
      recomputeHeaderPickCartons(rec);
    } catch (e) {
      dbg("validateLine error", e && (e.message || e));
    }

    return true;
  }

  function saveRecord(context) {
    const rec = context.currentRecord;
    dbg("saveRecord");

    try {
      bulkWriteInProgress = true;
      setSerialsForAllLines(rec);
      recomputeHeaderPickCartons(rec);
      dbg("saveRecord: finished writing line serials + header cartons");
    } catch (e) {
      dbg("saveRecord error", e && (e.message || e));
    } finally {
      bulkWriteInProgress = false;
    }
    return true;
  }

  // ---------- core logic ----------
  function setSerialsForCurrentLine(rec) {
    const invDetail = getInvDetailIfExists(rec, null);
    if (!invDetail) {
      dbg("current line: no inventorydetail (skip)");
      return;
    }

    const { serials } = readAssignments(invDetail);
    const serialStr = serials.join(", ");
    dbg("current line serials:", serials);

    if (!TARGET.lineSerialField) return;

    try {
      rec.setCurrentSublistValue({
        sublistId: "item",
        fieldId: TARGET.lineSerialField,
        value: serialStr,
      });
      dbg(`set CURRENT line ${TARGET.lineSerialField} =`, serialStr);
    } catch (e) {
      dbg("current line: set serials error", e && (e.message || e));
    }
  }

  function setSerialsForAllLines(rec) {
    const lineCount = rec.getLineCount({ sublistId: "item" }) || 0;
    dbg("setSerialsForAllLines: lines=", lineCount);

    if (!TARGET.lineSerialField) return;

    for (let i = 0; i < lineCount; i++) {
      try {
        const invDetail = getInvDetailIfExists(rec, i);
        if (!invDetail) {
          dbg(`line ${i}: no inventorydetail (skip)`);
          continue;
        }

        const { serials } = readAssignments(invDetail);
        const serialStr = serials.join(", ");
        dbg(`line ${i} serials:`, serials);

        // Direct write to the specific line — no selectLine/commitLine
        rec.setSublistValue({
          sublistId: "item",
          fieldId: TARGET.lineSerialField,
          line: i,
          value: serialStr,
        });
        dbg(`set line ${i} ${TARGET.lineSerialField} =`, serialStr);
      } catch (e) {
        dbg(`line ${i} write serials error`, e && (e.message || e));
      }
    }
  }

  function recomputeHeaderPickCartons(rec) {
    const lineCount = rec.getLineCount({ sublistId: "item" }) || 0;
    const pcs = new Set();

    for (let i = 0; i < lineCount; i++) {
      try {
        const invDetail = getInvDetailIfExists(rec, i);
        if (!invDetail) continue;

        const { pickCartons } = readAssignments(invDetail);
        pickCartons.forEach((v) => v && pcs.add(v));
      } catch (e) {
        dbg(`line ${i} header-scan error`, e && (e.message || e));
      }
    }

    const headerValue = Array.from(pcs).join(", ");
    dbg("Using Pick Carton field id:", PICK_CARTON_FIELD_ID);
    try {
      rec.setValue({ fieldId: TARGET.headerPickCartons, value: headerValue });
      dbg(`set header ${TARGET.headerPickCartons} =`, headerValue);
    } catch (e) {
      dbg("set header error", e && (e.message || e));
    }
  }

  return { pageInit, validateLine, saveRecord };
});
