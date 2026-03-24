/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Invoice Out Sales Orders
 */

define(["N/search", "N/record", "N/log"], (search, record, log) => {
  // --------- CONTROLS ----------
  const TARGET_SO_ID = null;
  const DRY_RUN = false;

  function getInputData() {
    log.audit("Invoice MR Input", {
      DRY_RUN,
      TARGET_SO_ID: TARGET_SO_ID || "(none)",
    });

    if (TARGET_SO_ID) {
      return [{ soId: TARGET_SO_ID }];
    }

    return search.create({
      type: search.Type.SALES_ORDER,
      filters: [
        ["mainline", "is", "F"],
        "AND",
        ["taxline", "is", "F"],
        "AND",
        ["shipping", "is", "F"],
        "AND",
        ["cogs", "is", "F"],
        "AND",
        ["closed", "is", "F"], // <-- FIX: was "isclosed"
        "AND",
        [
          "formulanumeric: CASE WHEN NVL({quantitybilled},0) < NVL({quantity},0) THEN 1 ELSE 0 END",
          "equalto",
          "1",
        ],
      ],
      columns: [
        search.createColumn({
          name: "internalid",
          summary: search.Summary.GROUP,
        }),
        search.createColumn({ name: "tranid", summary: search.Summary.GROUP }),
      ],
    });
  }

  function map(context) {
    let soId = null;
    let tranid = "";

    try {
      const row = JSON.parse(context.value);

      // Array mode
      if (row && row.soId) {
        soId = Number(row.soId);
      } else {
        // Search summary mode
        const gid =
          row.values?.["GROUP(internalid)"]?.value ??
          row.values?.["GROUP(internalid)"] ??
          null;
        soId = Number(gid);
        tranid = row.values?.["GROUP(tranid)"] ?? "";
      }
    } catch (e) {
      log.error("Map parse failed", { err: String(e), raw: context.value });
      return;
    }

    if (!soId) return;

    try {
      if (DRY_RUN) {
        log.audit("DRY_RUN would invoice SO", { soId, tranid });
        return;
      }

      log.audit("Creating invoice via transform", { soId, tranid });

      const inv = record.transform({
        fromType: record.Type.SALES_ORDER,
        fromId: soId,
        toType: record.Type.INVOICE,
        isDynamic: true,
      });

      const invoiceId = inv.save({
        enableSourcing: true,
        ignoreMandatoryFields: false,
      });

      log.audit("Created invoice", { soId, invoiceId, tranid });
    } catch (e) {
      log.error("Failed to invoice SO", {
        soId,
        tranid,
        err: e && e.message ? e.message : String(e),
      });
    }
  }

  function summarize(summary) {
    if (summary.inputSummary?.error) {
      log.error("Input error", summary.inputSummary.error);
    }

    summary.mapSummary.errors.iterator().each((k, err) => {
      log.error("Map error", { k, err });
      return true;
    });

    log.audit("Invoice MR finished", {
      DRY_RUN,
      seconds: summary.seconds,
      usage: summary.usage,
      yields: summary.yields,
      concurrency: summary.concurrency,
    });
  }

  return { getInputData, map, summarize };
});
