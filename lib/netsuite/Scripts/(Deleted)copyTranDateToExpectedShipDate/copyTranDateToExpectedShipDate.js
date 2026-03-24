/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/record", "N/log"], (record, log) => {
  const TEST_SO_IDS = [874139, 926841];

  function getInputData() {
    return TEST_SO_IDS;
  }

  function map(context) {
    const soId = Number(context.value);

    try {
      if (!soId || isNaN(soId)) {
        throw new Error("Invalid SO internal id: " + context.value);
      }

      const soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });

      const tranDate = soRec.getValue({ fieldId: "trandate" });
      if (!tranDate) {
        throw new Error("Sales Order has no trandate");
      }

      const lineCount = soRec.getLineCount({ sublistId: "item" });
      let updatedLines = 0;

      for (let i = 0; i < lineCount; i++) {
        soRec.setSublistValue({
          sublistId: "item",
          fieldId: "expectedshipdate",
          line: i,
          value: tranDate,
        });
        updatedLines++;
      }

      const savedId = soRec.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });

      log.audit({
        title: "SO updated",
        details: {
          soId: savedId,
          tranDate: tranDate,
          updatedLines: updatedLines,
        },
      });
    } catch (e) {
      log.error({
        title: "Failed SO " + soId,
        details: {
          name: e.name || "ERROR",
          message: e.message || e,
          stack: e.stack || "",
        },
      });
    }
  }

  function summarize(summary) {
    if (summary.inputSummary && summary.inputSummary.error) {
      log.error({
        title: "Input Error",
        details: summary.inputSummary.error,
      });
    }

    if (summary.mapSummary && summary.mapSummary.errors) {
      summary.mapSummary.errors.iterator().each((key, error) => {
        log.error({
          title: "Map error for key " + key,
          details: error,
        });
        return true;
      });
    }

    log.audit({
      title: "Summary",
      details: {
        usage: summary.usage,
        concurrency: summary.concurrency,
        yields: summary.yields,
      },
    });
  }

  return {
    getInputData,
    map,
    summarize,
  };
});
