/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/record", "N/log"], function (query, record, log) {
  var FROM_FIELD = "custbody_hpl_hs_deal_name";
  var TO_FIELD = "custbody_hpl_so_reference";

  // Hardcoded test internal id (could be SO or Invoice)
  var TEST_ID = 33170;

  var ONLY_TEST_ID = true; // set false later for ALL
  var DRY_RUN = false;

  function isEmpty(v) {
    if (v === null || v === undefined) return true;
    return String(v).trim().length === 0;
  }

  function getTransactionType(id) {
    var res = query
      .runSuiteQL({
        query: "SELECT type FROM transaction WHERE id = ?",
        params: [Number(id)],
      })
      .asMappedResults();

    return res && res.length ? res[0].type : null; // e.g. 'SalesOrd' or 'CustInvc'
  }

  function nsRecordTypeFromTxnType(txnType) {
    if (txnType === "SalesOrd") return record.Type.SALES_ORDER;
    if (txnType === "CustInvc") return record.Type.INVOICE;
    return null;
  }

  function getInputData() {
    if (ONLY_TEST_ID) {
      log.audit({
        title: "Copy deal name → SO reference (input)",
        details: {
          ONLY_TEST_ID: ONLY_TEST_ID,
          TEST_ID: TEST_ID,
          DRY_RUN: DRY_RUN,
          rows: 1,
        },
      });
      return [{ id: TEST_ID }];
    }

    // Full run (later): pull all ids for SO+Invoice
    var sql =
      "SELECT id FROM transaction WHERE type IN ('SalesOrd','CustInvc')";
    var paged = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
    var out = [];
    paged.pageRanges.forEach(function (r) {
      var page = paged.fetch({ index: r.index });
      page.data.asMappedResults().forEach(function (row) {
        out.push({ id: Number(row.id) });
      });
    });
    return out;
  }

  function map(ctx) {
    var row = JSON.parse(ctx.value);
    var id = Number(row.id);
    if (!id) return;
    ctx.write({ key: String(id), value: "1" });
  }

  function reduce(ctx) {
    var id = Number(ctx.key);
    if (!id) return;

    try {
      var txnType = getTransactionType(id);
      if (!txnType) {
        log.error({
          title: "Not a transaction id",
          details: { id: id, msg: "No row in transaction table for this id" },
        });
        return;
      }

      var recType = nsRecordTypeFromTxnType(txnType);
      if (!recType) {
        log.error({
          title: "Unsupported transaction type",
          details: { id: id, txnType: txnType },
        });
        return;
      }

      var rec = record.load({ type: recType, id: id, isDynamic: false });

      var fromVal = rec.getValue({ fieldId: FROM_FIELD });
      var toVal = rec.getValue({ fieldId: TO_FIELD });

      log.audit({
        title: "Loaded",
        details: {
          id: id,
          txnType: txnType,
          fromVal: fromVal,
          toVal: toVal,
          fromEmpty: isEmpty(fromVal),
          toEmpty: isEmpty(toVal),
        },
      });

      // no overwrite
      if (!isEmpty(toVal)) return;
      if (isEmpty(fromVal)) return;

      if (DRY_RUN) {
        log.audit({
          title: "DRY RUN would update",
          details: { id: id, txnType: txnType, copiedValue: fromVal },
        });
        return;
      }

      rec.setValue({ fieldId: TO_FIELD, value: String(fromVal) });
      var savedId = rec.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });

      log.audit({
        title: "Updated",
        details: { id: savedId, txnType: txnType, copiedValue: fromVal },
      });
    } catch (e) {
      log.error({ title: "Failed updating id " + id, details: e });
    }
  }

  function summarize(summary) {
    var mapErrors = 0;
    var reduceErrors = 0;

    summary.mapSummary.errors.iterator().each(function (k, e) {
      mapErrors++;
      log.error({ title: "Map error " + k, details: e });
      return true;
    });

    summary.reduceSummary.errors.iterator().each(function (k, e) {
      reduceErrors++;
      log.error({ title: "Reduce error " + k, details: e });
      return true;
    });

    log.audit({
      title: "Copy deal name → SO reference (summary)",
      details: {
        ONLY_TEST_ID: ONLY_TEST_ID,
        TEST_ID: TEST_ID,
        DRY_RUN: DRY_RUN,
        mapErrors: mapErrors,
        reduceErrors: reduceErrors,
        usage: summary.usage,
        yields: summary.yields,
        seconds: summary.seconds,
      },
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
