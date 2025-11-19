/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/record", "N/log"], function (query, record, log) {
  function getInputData() {
    var sql =
      "\nWITH lines AS (\n" +
      "  SELECT o.id AS so_id,\n" +
      "         l.id AS so_line,\n" +
      "         ABS(NVL(l.quantity,0)) AS qty,\n" +
      "         ABS(NVL(l.quantityshiprecv,0)) AS qty_shiprecv,\n" +
      "         ABS(NVL(l.quantitycommitted,0)) AS qty_committed,\n" +
      "         ABS(NVL(l.quantitybackordered,0)) AS qty_backordered,\n" +
      "         NVL(l.custcol_hpl_itempaid,'F') AS item_paid_flag,\n" +
      "         l.itemtype AS itemtype,\n" +
      "         l.assemblycomponent AS assemblycomponent,\n" +
      "         l.kitcomponent AS kitcomponent,\n" +
      "         NVL(l.isclosed,'F') AS isclosed,\n" +
      "         NVL(i.isserialitem,'F') AS isserialitem\n" +
      "  FROM transaction o\n" +
      "  JOIN transactionline l ON o.id = l.transaction\n" +
      "  JOIN item i ON l.item = i.id\n" +
      "  WHERE o.type = 'SalesOrd' AND l.mainline = 'F'\n" +
      "), filt AS (\n" +
      "  SELECT *\n" +
      "  FROM lines\n" +
      "  WHERE isclosed = 'F'\n" +
      "    AND itemtype IN ('InvtPart','Assembly','NonInvtPart')\n" +
      "    AND assemblycomponent = 'F'\n" +
      "    AND kitcomponent = 'F'\n" +
      "    AND isserialitem = 'F'\n" +
      "), ord AS (\n" +
      "  SELECT so_id,\n" +
      "         COUNT(*) AS total_lines,\n" +
      "         SUM(CASE WHEN item_paid_flag = 'T' THEN 1 ELSE 0 END) AS paid_lines,\n" +
      "         SUM(CASE WHEN item_paid_flag = 'T' AND qty_committed > 0 AND qty_backordered = 0 THEN 1 ELSE 0 END) AS paid_committed_lines\n" +
      "  FROM filt\n" +
      "  GROUP BY so_id\n" +
      "), eligible AS (\n" +
      "  SELECT f.so_id,\n" +
      "         f.so_line,\n" +
      "         GREATEST(0, f.qty - f.qty_shiprecv) AS remaining\n" +
      "  FROM filt f\n" +
      "  JOIN ord o ON o.so_id = f.so_id\n" +
      "  WHERE f.item_paid_flag = 'T'\n" +
      "    AND ( f.itemtype = 'NonInvtPart' OR f.qty_committed > 0 )\n" +
      "    AND f.qty_backordered = 0\n" +
      "    AND GREATEST(0, f.qty - f.qty_shiprecv) > 0\n" +
      "    AND o.paid_committed_lines >= 1\n" +
      ")\n" +
      "SELECT e.so_id, e.so_line, e.remaining\n" +
      "FROM eligible e";
    var rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    var picked = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var id = String(rows[i].so_id);
      if (!seen[id]) {
        picked.push(id);
        seen[id] = true;
      }
    }
    if (picked.length)
      log.audit("Selected SOs for transform", { salesorders: picked });
    return rows.map(function (r) {
      return {
        soId: String(r.so_id),
        soLine: Number(r.so_line),
        remaining: Number(r.remaining || 0),
      };
    });
  }

  function map(context) {
    var row = JSON.parse(context.value);
    if (row.remaining <= 0) return;
    context.write({
      key: row.soId,
      value: { soLine: Number(row.soLine), remaining: Number(row.remaining) },
    });
  }

  function reduce(context) {
    var soId = context.key;
    var bySoLine = {};
    for (var i = 0; i < context.values.length; i++) {
      var v = JSON.parse(context.values[i]);
      bySoLine[Number(v.soLine)] = Number(v.remaining) || 0;
    }
    var preCount = Object.keys(bySoLine).length;
    log.audit("Eligible paid+committed lines", {
      salesorder: soId,
      lineCount: preCount,
    });
    if (preCount > 0) context.write("__qualified__", String(preCount));
    if (!preCount) return;

    var soIdNum = parseInt(String(soId).trim(), 10);
    if (!(soIdNum > 0)) {
      log.error("Invalid SO id", { soId: soId });
      context.write("__error__", String(soId));
      return;
    }

    var meta = query
      .runSuiteQL({
        query:
          "SELECT id, tranid FROM transaction WHERE type = 'SalesOrd' AND id = " +
          soIdNum +
          " FETCH FIRST 1 ROWS ONLY",
      })
      .asMappedResults();
    if (!meta || !meta.length) {
      log.error("SO not found by SuiteQL", { salesorder: soIdNum });
      context.write("__error__", String(soId));
      return;
    }
    var tranId = meta[0].tranid;

    context.write(
      "__meta__",
      JSON.stringify({ soId: String(soIdNum), tranId: String(tranId) })
    );

    var ifRec;
    try {
      ifRec = record.transform({
        fromType: "salesorder",
        fromId: soIdNum,
        toType: record.Type.ITEM_FULFILLMENT,
        isDynamic: true,
      });
    } catch (e2) {
      log.error("Transform failed", {
        salesorder: soIdNum,
        tranid: tranId,
        err: e2,
      });
      context.write("__error__", String(soId));
      return;
    }

    var selected = 0;
    var m = ifRec.getLineCount({ sublistId: "item" }) || 0;
    for (var j = 0; j < m; j++) {
      ifRec.selectLine({ sublistId: "item", line: j });
      var soLineNum = Number(
        ifRec.getCurrentSublistValue({
          sublistId: "item",
          fieldId: "orderline",
        }) || 0
      );
      var rem = bySoLine[soLineNum] || 0;
      var eligible = rem > 0;
      ifRec.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "itemreceive",
        value: eligible,
      });
      if (eligible) {
        ifRec.setCurrentSublistValue({
          sublistId: "item",
          fieldId: "quantity",
          value: rem,
        });
        selected++;
      }
      ifRec.commitLine({ sublistId: "item" });
    }

    if (!selected) {
      log.audit("No eligible lines to fulfill", {
        salesorder: soIdNum,
        tranid: tranId,
      });
      return;
    }

    try {
      var ifId = ifRec.save({
        ignoreMandatoryFields: false,
        enableSourcing: true,
      });
      log.audit("Item Fulfillment created", {
        salesorder: soIdNum,
        tranid: tranId,
        itemfulfillment: ifId,
        linesSelected: selected,
      });
    } catch (e3) {
      log.error("Save IF failed", {
        salesorder: soIdNum,
        tranid: tranId,
        err: e3,
      });
      context.write("__error__", String(soId));
    }
  }

  function summarize(summary) {
    var soCount = 0,
      totalQualifiedLines = 0,
      soIds = [],
      errorCount = 0,
      errorIds = [],
      metaById = {};

    summary.reduceSummary.keys.iterator().each(function (k) {
      soCount += 1;
      soIds.push(k);
      return true;
    });

    summary.output.iterator().each(function (key, value) {
      if (key === "__qualified__") {
        totalQualifiedLines += Number(value || 0);
      } else if (key === "__error__") {
        errorCount += 1;
        errorIds.push(String(value));
      } else if (key === "__meta__") {
        try {
          var m = JSON.parse(String(value));
          metaById[m.soId] = m.tranId;
        } catch (_) {}
      }
      return true;
    });

    var processed = soIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });
    var errored = errorIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });

    if (summary.inputSummary.error)
      log.error("Input error", summary.inputSummary.error);
    summary.mapSummary.errors.iterator().each(function (k, e) {
      log.error("Map error " + k, e);
      return true;
    });
    summary.reduceSummary.errors.iterator().each(function (k, e) {
      log.error("Reduce error " + k, e);
      return true;
    });

    log.audit("Run totals", {
      salesOrdersProcessed: soCount,
      qualifiedLines: totalQualifiedLines,
      processedSOs: processed,
      errorSOCount: errorCount,
      errorSOs: errored,
    });

    log.audit("MR usage", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
