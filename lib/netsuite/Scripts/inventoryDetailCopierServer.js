/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
 */
define(["N/log", "N/runtime", "N/search", "N/record"], (
  log,
  runtime,
  search,
  record
) => {
  const HEADER_CARTONS = "custbody_hpl_cartons"; // header "Cartons used"
  const LINE_SERIAL = "custcol_hpl_serialnumber"; // line "Serial#"
  const CARTON_LINECOL = "custcol_wms_packcarton";

  const IA_CARTON_CANDIDATES = [
    "pickcarton",
    "custrecord_wms_pickcarton",
    "custrecord_wms_pick_carton",
    "custrecord_wmsse_pick_carton",
    "custrecord_pick_carton",
  ];

  // ===================== BEFORE SUBMIT =====================
  function beforeSubmit(ctx) {
    try {
      const exec = runtime.executionContext;
      log.audit(
        "[HPL-UE] beforeSubmit start",
        `type=${ctx.type}, exec=${exec}`
      );

      const rec = ctx.newRecord;
      const lineCount = rec.getLineCount({ sublistId: "item" }) || 0;
      log.debug(
        "[HPL-UE] lines",
        `lineCount=${lineCount}, id=${rec.id || "(new)"}, type=${rec.type}`
      );

      const headerCartons = new Set();
      let linesTouched = 0;

      for (let i = 0; i < lineCount; i++) {
        const invDetail = safeGetSubrecord(rec, "item", "inventorydetail", i);
        if (invDetail) {
          const { serials, cartons } = readAssignments(invDetail);
          log.debug(
            "[HPL-UE] line values",
            `line ${i}: serials=[${serials.join(
              ", "
            )}] iaCartons=[${cartons.join(", ")}]`
          );

          if (LINE_SERIAL) {
            try {
              rec.setSublistValue({
                sublistId: "item",
                fieldId: LINE_SERIAL,
                line: i,
                value: serials.join(", "),
              });
              linesTouched++;
            } catch (e) {
              log.error(
                "[HPL-UE] set line serial error",
                `line ${i}, field=${LINE_SERIAL}, msg=${e && e.message}`
              );
            }
          }
          cartons.forEach((c) => c && headerCartons.add(c));
        }

        const lineCarton = safeGetLine(rec, CARTON_LINECOL, i);
        if (lineCarton) headerCartons.add(String(lineCarton));
      }

      // Header roll-up
      const headerValue = Array.from(headerCartons).join(", ");
      log.debug(
        "[HPL-UE] header rollup (beforeSubmit)",
        `cartons used=[${headerValue}]`
      );
      if (HEADER_CARTONS) {
        try {
          rec.setValue({ fieldId: HEADER_CARTONS, value: headerValue });
        } catch (e) {
          log.error(
            "[HPL-UE] set header error",
            `field=${HEADER_CARTONS}, msg=${e && e.message}`
          );
        }
      }

      log.audit(
        "[HPL-UE] beforeSubmit done",
        `linesTouched=${linesTouched}, headerCartons=${headerValue}`
      );
    } catch (e) {
      log.error(
        "[HPL-UE] fatal in beforeSubmit",
        e && (e.stack || e.message || String(e))
      );
    }
  }

  // ===================== AFTER SUBMIT =====================

  function afterSubmit(ctx) {
    try {
      const exec = runtime.executionContext;
      const nr = ctx.newRecord;
      const VERSION = "UE_v7_2025-08-20T19:50Z";
      log.audit(
        "[HPL-UE] afterSubmit start",
        `v=${VERSION}, type=${ctx.type}, exec=${exec}, id=${nr.id}, t=${nr.type}`
      );

      let existingHeader = "";
      try {
        existingHeader = nr.getValue({ fieldId: "custbody_hpl_cartons" }) || "";
      } catch (_) {}

      const cartons = new Set();
      let lineCount = 0;
      try {
        lineCount = nr.getLineCount({ sublistId: "item" }) || 0;
      } catch (_) {}

      for (let i = 0; i < lineCount; i++) {
        let invDetail = null;
        try {
          invDetail = nr.getSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
            line: i,
          });
        } catch (_) {}
        if (!invDetail) continue;

        let nAssign = 0;
        try {
          nAssign =
            invDetail.getLineCount({ sublistId: "inventoryassignment" }) || 0;
        } catch (_) {}
        for (let r = 0; r < nAssign; r++) {
          let pc = "";
          try {
            pc =
              invDetail.getSublistText({
                sublistId: "inventoryassignment",
                fieldId: "pickcarton",
                line: r,
              }) || "";
          } catch (_) {}
          if (!pc) {
            try {
              pc =
                invDetail.getSublistValue({
                  sublistId: "inventoryassignment",
                  fieldId: "pickcarton",
                  line: r,
                }) || "";
            } catch (_) {}
          }
          if (pc) cartons.add(String(pc));
        }
      }

      const computed = Array.from(cartons).join(", ");
      log.debug(
        "[HPL-UE] header(existing vs computed)",
        `${existingHeader} || ${computed}`
      );

      if (!computed || existingHeader.trim() === computed) {
        log.debug("[HPL-UE] afterSubmit", "nothing to write");
        return;
      }

      record.submitFields({
        type: nr.type,
        id: nr.id,
        values: { custbody_hpl_cartons: computed },
        options: { enableSourcing: false, ignoreMandatoryFields: true },
      });
      log.audit(
        "[HPL-UE] afterSubmit wrote header",
        `id=${nr.id}, value=${computed}`
      );
    } catch (e) {
      log.error(
        "[HPL-UE] afterSubmit fatal",
        e && (e.stack || e.message || String(e))
      );
    }
  }

  // ===================== helpers =====================
  function safeGet(rec, fieldId) {
    try {
      return rec.getValue({ fieldId }) || "";
    } catch (_) {
      return "";
    }
  }
  function safeGetLine(rec, fieldId, line) {
    try {
      return rec.getSublistValue({ sublistId: "item", fieldId, line }) || "";
    } catch (_) {
      return "";
    }
  }
  function safeGetSubrecord(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistSubrecord({ sublistId, fieldId, line });
    } catch (_) {
      return null;
    }
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

  function lookupInventoryNumberText(search, id) {
    try {
      const r = search.lookupFields({
        type: "inventorynumber",
        id,
        columns: ["inventorynumber"],
      });
      return (r && r.inventorynumber) || "";
    } catch (_) {
      return "";
    }
  }

  function readAssignments(invDetail) {
    const n = invDetail.getLineCount({ sublistId: "inventoryassignment" }) || 0;
    const serials = new Set();
    const cartons = new Set();

    for (let r = 0; r < n; r++) {
      let s =
        getText(invDetail, "inventoryassignment", "issueinventorynumber", r) ||
        getText(
          invDetail,
          "inventoryassignment",
          "receiptinventorynumber",
          r
        ) ||
        getText(invDetail, "inventoryassignment", "inventorynumber", r);

      if (!s) {
        const id =
          getVal(invDetail, "inventoryassignment", "issueinventorynumber", r) ||
          getVal(
            invDetail,
            "inventoryassignment",
            "receiptinventorynumber",
            r
          ) ||
          getVal(invDetail, "inventoryassignment", "inventorynumber", r);
        if (id) s = lookupInventoryNumberText(search, id);
      }
      if (s) serials.add(String(s));

      for (const fid of IA_CARTON_CANDIDATES) {
        const pc =
          getText(invDetail, "inventoryassignment", fid, r) ||
          getVal(invDetail, "inventoryassignment", fid, r);
        if (pc) {
          cartons.add(String(pc));
          break;
        }
      }
    }
    return { serials: Array.from(serials), cartons: Array.from(cartons) };
  }

  return { beforeSubmit, afterSubmit };
});
