/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * DIAGNOSTIC SCRIPT:
 * Probe where "Expected Delivery Date" is actually available for:
 *  - Purchase Order header (transaction)
 *  - Purchase Order line (transactionline)
 *  - Inbound Shipment search
 *
 * Safe script:
 * - Every probe is wrapped in try/catch
 * - Nothing is exported
 * - Results are logged only
 */
define(["N/query", "N/search", "N/log"], function (query, search, log) {
  function getInputData() {
    return [1];
  }

  function map(ctx) {
    ctx.write({ key: "RUN", value: "RUN" });
  }

  function reduce(ctx) {}

  function summarize(summary) {
    // ----------------------------
    // Helpers
    // ----------------------------
    function runSuiteQLProbe(name, sql) {
      try {
        var rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
        log.audit("SUITEQL PROBE SUCCESS: " + name, {
          rowCount: rows.length,
          sample: rows.length ? rows[0] : null,
          query: sql,
        });
        return { ok: true, rows: rows };
      } catch (e) {
        log.error("SUITEQL PROBE FAILED: " + name, {
          message: e && e.message,
          stack: e && e.stack,
          query: sql,
        });
        return { ok: false, error: e };
      }
    }

    function runSearchProbe(name, type, filters, columns) {
      try {
        var cols = (columns || []).map(function (c) {
          return search.createColumn({ name: c });
        });

        var s = search.create({
          type: type,
          filters: filters || [],
          columns: cols,
        });

        var rows = s.run().getRange({ start: 0, end: 5 }) || [];
        var sample = null;

        if (rows.length) {
          sample = {};
          for (var i = 0; i < columns.length; i++) {
            var col = columns[i];
            try {
              sample[col] = rows[0].getValue(col);
            } catch (e) {
              sample[col] = "__ERROR_READING__";
            }
          }
        }

        log.audit("SEARCH PROBE SUCCESS: " + name, {
          type: type,
          rowCount: rows.length,
          columns: columns,
          sample: sample,
        });

        return { ok: true, rows: rows };
      } catch (e) {
        log.error("SEARCH PROBE FAILED: " + name, {
          type: type,
          columns: columns,
          message: e && e.message,
          stack: e && e.stack,
        });
        return { ok: false, error: e };
      }
    }

    // ----------------------------
    // 1) Purchase Order HEADER probes
    // ----------------------------
    log.audit("DIAG START", "Starting Expected Delivery Date probes");

    runSuiteQLProbe(
      "PO HEADER - T.expecteddeliverydate",
      "SELECT T.id, T.tranid, T.expecteddeliverydate " +
        "FROM transaction T " +
        "WHERE T.type = 'PurchOrd' " +
        "ORDER BY T.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    runSuiteQLProbe(
      "PO HEADER - T.expectedreceiptdate",
      "SELECT T.id, T.tranid, T.expectedreceiptdate " +
        "FROM transaction T " +
        "WHERE T.type = 'PurchOrd' " +
        "ORDER BY T.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    runSuiteQLProbe(
      "PO HEADER - T.duedate",
      "SELECT T.id, T.tranid, T.duedate " +
        "FROM transaction T " +
        "WHERE T.type = 'PurchOrd' " +
        "ORDER BY T.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    // ----------------------------
    // 2) Purchase Order LINE probes
    // ----------------------------
    runSuiteQLProbe(
      "PO LINE - TL.expecteddeliverydate",
      "SELECT TL.transaction, TL.id, TL.expecteddeliverydate " +
        "FROM transactionline TL " +
        "JOIN transaction T ON T.id = TL.transaction " +
        "WHERE T.type = 'PurchOrd' " +
        "  AND TL.mainline = 'F' " +
        "ORDER BY TL.transaction DESC, TL.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    runSuiteQLProbe(
      "PO LINE - TL.expectedreceiptdate",
      "SELECT TL.transaction, TL.id, TL.expectedreceiptdate " +
        "FROM transactionline TL " +
        "JOIN transaction T ON T.id = TL.transaction " +
        "WHERE T.type = 'PurchOrd' " +
        "  AND TL.mainline = 'F' " +
        "ORDER BY TL.transaction DESC, TL.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    runSuiteQLProbe(
      "PO LINE - TL.quantityshiprecv",
      "SELECT TL.transaction, TL.id, TL.quantity, TL.quantityshiprecv " +
        "FROM transactionline TL " +
        "JOIN transaction T ON T.id = TL.transaction " +
        "WHERE T.type = 'PurchOrd' " +
        "  AND TL.mainline = 'F' " +
        "ORDER BY TL.transaction DESC, TL.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    // ----------------------------
    // 3) PO header + line combined useful probes
    // ----------------------------
    runSuiteQLProbe(
      "PO HEADER+LINE - T.expecteddeliverydate with line item",
      "SELECT " +
        "  T.id AS poId, " +
        "  T.tranid AS poTranId, " +
        "  T.expecteddeliverydate AS headerExpectedDeliveryDate, " +
        "  T.duedate AS dueDate, " +
        "  TL.id AS poLineId, " +
        "  TL.expectedreceiptdate AS lineExpectedReceiptDate " +
        "FROM transactionline TL " +
        "JOIN transaction T ON T.id = TL.transaction " +
        "WHERE T.type = 'PurchOrd' " +
        "  AND TL.mainline = 'F' " +
        "ORDER BY T.id DESC, TL.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    runSuiteQLProbe(
      "PO HEADER+LINE - COALESCE(T.expecteddeliverydate, T.duedate, TL.expectedreceiptdate)",
      "SELECT " +
        "  T.id AS poId, " +
        "  T.tranid AS poTranId, " +
        "  COALESCE(T.expecteddeliverydate, T.duedate, TL.expectedreceiptdate) AS chosenDate, " +
        "  T.expecteddeliverydate AS headerExpectedDeliveryDate, " +
        "  T.duedate AS dueDate, " +
        "  TL.expectedreceiptdate AS lineExpectedReceiptDate " +
        "FROM transactionline TL " +
        "JOIN transaction T ON T.id = TL.transaction " +
        "WHERE T.type = 'PurchOrd' " +
        "  AND TL.mainline = 'F' " +
        "ORDER BY T.id DESC, TL.id DESC " +
        "FETCH FIRST 5 ROWS ONLY",
    );

    // ----------------------------
    // 4) Inbound Shipment SEARCH probes
    // ----------------------------
    // We'll test common likely columns one by one so one bad field does not kill the others.

    var inboundBaseFilters = [];

    runSearchProbe(
      "INBOUND SEARCH - internalid",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid"],
    );

    runSearchProbe(
      "INBOUND SEARCH - shipmentnumber",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "shipmentnumber"],
    );

    runSearchProbe(
      "INBOUND SEARCH - inboundshipmentnumber",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "inboundshipmentnumber"],
    );

    runSearchProbe(
      "INBOUND SEARCH - tranid",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "tranid"],
    );

    runSearchProbe(
      "INBOUND SEARCH - expecteddeliverydate",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "expecteddeliverydate"],
    );

    runSearchProbe(
      "INBOUND SEARCH - expectedreceiptdate",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "expectedreceiptdate"],
    );

    runSearchProbe(
      "INBOUND SEARCH - item",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "item"],
    );

    runSearchProbe(
      "INBOUND SEARCH - quantityexpected",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "quantityexpected"],
    );

    runSearchProbe(
      "INBOUND SEARCH - quantityreceived",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "quantityreceived"],
    );

    runSearchProbe(
      "INBOUND SEARCH - quantity",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "quantity"],
    );

    runSearchProbe(
      "INBOUND SEARCH - location",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "location"],
    );

    // ----------------------------
    // 5) Inbound Shipment combo probes
    // ----------------------------
    runSearchProbe(
      "INBOUND SEARCH COMBO A",
      "inboundshipment",
      inboundBaseFilters,
      [
        "internalid",
        "shipmentnumber",
        "expecteddeliverydate",
        "item",
        "quantityexpected",
        "quantityreceived",
      ],
    );

    runSearchProbe(
      "INBOUND SEARCH COMBO B",
      "inboundshipment",
      inboundBaseFilters,
      [
        "internalid",
        "shipmentnumber",
        "expectedreceiptdate",
        "item",
        "quantityexpected",
        "quantityreceived",
      ],
    );

    runSearchProbe(
      "INBOUND SEARCH COMBO C",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "tranid", "expecteddeliverydate", "item", "quantity"],
    );

    runSearchProbe(
      "INBOUND SEARCH COMBO D",
      "inboundshipment",
      inboundBaseFilters,
      ["internalid", "tranid", "expectedreceiptdate", "item", "quantity"],
    );

    log.audit("DIAG END", "Finished Expected Delivery Date probes");
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
