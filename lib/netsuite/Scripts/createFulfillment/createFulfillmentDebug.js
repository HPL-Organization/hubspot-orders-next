/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/log"], function (query, log) {
  var TARGET_SO_ID = 460974;
  var TARGET_TRANID = "SO-528421";

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
      "         NVL(i.isserialitem,'F') AS isserialitem,\n" +
      "         NVL(o.shipcomplete,'F') AS shipcomplete\n" +
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
      "         SUM(\n" +
      "           CASE\n" +
      "             WHEN item_paid_flag = 'T'\n" +
      "              AND qty_backordered = 0\n" +
      "              AND (itemtype = 'NonInvtPart' OR qty_committed > 0)\n" +
      "              AND GREATEST(0, qty - qty_shiprecv) > 0\n" +
      "             THEN 1\n" +
      "             ELSE 0\n" +
      "           END\n" +
      "         ) AS paid_eligible_lines,\n" +
      "         MAX(CASE WHEN qty_backordered > 0 THEN 1 ELSE 0 END) AS has_backorder\n" +
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
      "    AND o.paid_eligible_lines >= 1\n" +
      "    AND (\n" +
      "      f.shipcomplete = 'F'\n" +
      "      OR (f.shipcomplete = 'T' AND o.has_backorder = 0)\n" +
      "    )\n" +
      ")\n" +
      "SELECT e.so_id, e.so_line, e.remaining\n" +
      "FROM eligible e";

    var rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    var picked = [];
    var seen = {};
    var targetSeenInEligible = false;

    for (var i = 0; i < rows.length; i++) {
      var id = String(rows[i].so_id);
      if (!seen[id]) {
        picked.push(id);
        seen[id] = true;
      }
      if (Number(id) === TARGET_SO_ID) {
        targetSeenInEligible = true;
      }
    }

    if (picked.length) {
      log.audit("TEST: Selected SOs for potential transform", {
        salesorders: picked,
      });
    }

    if (targetSeenInEligible) {
      log.audit("TEST: TARGET SO found in eligible CTE", {
        targetSoId: TARGET_SO_ID,
        targetTranId: TARGET_TRANID,
      });
    } else {
      log.audit("TEST: TARGET SO NOT in eligible CTE", {
        targetSoId: TARGET_SO_ID,
        targetTranId: TARGET_TRANID,
      });
    }

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
    var soIdNum = parseInt(String(soId).trim(), 10);
    var isTarget = soIdNum === TARGET_SO_ID;

    log.audit("TEST: Eligible paid+committed lines", {
      salesorder: soId,
      lineCount: preCount,
      lines: bySoLine,
    });

    if (isTarget) {
      log.audit("TEST: TARGET SO reduce start", {
        salesorder: soIdNum,
        tranid: TARGET_TRANID,
        lineCount: preCount,
        lines: bySoLine,
      });
    }

    if (preCount > 0) {
      context.write("__qualified__", String(preCount));
    }

    if (!preCount) {
      if (isTarget) {
        log.audit(
          "TEST: TARGET SO has no eligible lines; would NOT transform",
          {
            salesorder: soIdNum,
            tranid: TARGET_TRANID,
          }
        );
      }
      return;
    }

    var meta = query
      .runSuiteQL({
        query:
          "SELECT id, tranid, custbody_hpl_paid_released_timestamp " +
          "FROM transaction WHERE type = 'SalesOrd' AND id = " +
          soIdNum +
          " FETCH FIRST 1 ROWS ONLY",
      })
      .asMappedResults();

    if (!meta || !meta.length) {
      log.error("TEST: SO not found by SuiteQL", { salesorder: soIdNum });
      context.write("__error__", String(soId));
      if (isTarget) {
        log.audit("TEST: TARGET SO not found by SuiteQL", {
          salesorder: soIdNum,
          tranid: TARGET_TRANID,
        });
      }
      return;
    }

    var tranId = meta[0].tranid;
    context.write(
      "__meta__",
      JSON.stringify({ soId: String(soIdNum), tranId: String(tranId) })
    );

    var tsStr = meta[0].custbody_hpl_paid_released_timestamp;
    if (tsStr) {
      try {
        var lastDate = new Date(String(tsStr));
        var lastMs = lastDate.getTime();
        if (!isNaN(lastMs)) {
          var nowMs = Date.now();
          var diffMs = nowMs - lastMs;
          var THIRTY_MIN_MS = 30 * 60 * 1000;
          if (diffMs < THIRTY_MIN_MS) {
            log.audit("TEST: Skip transform (recent paid_released timestamp)", {
              salesorder: soIdNum,
              tranid: tranId,
              timestamp: tsStr,
              ageMinutes: diffMs / 60000,
            });
            context.write("__skipped_ts__", String(soIdNum));
            if (isTarget) {
              log.audit("TEST: TARGET SO WOULD BE SKIPPED BY TIMESTAMP GATE", {
                salesorder: soIdNum,
                tranid: tranId,
                timestamp: tsStr,
                ageMinutes: diffMs / 60000,
              });
            }
            return;
          }
        }
      } catch (eTs) {
        log.error("TEST: Timestamp parse error; would still proceed", {
          salesorder: soIdNum,
          tranid: tranId,
          timestamp: tsStr,
          err: eTs,
        });
      }
    }

    var eligibleLines = 0;
    var keys = Object.keys(bySoLine);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (bySoLine[k] > 0) eligibleLines++;
    }

    if (!eligibleLines) {
      log.audit("TEST: After remaining-qty check, no lines would be received", {
        salesorder: soIdNum,
        tranid: tranId,
        lines: bySoLine,
      });
      if (isTarget) {
        log.audit(
          "TEST: TARGET SO WOULD NOT BE TRANSFORMED (no remaining qty)",
          {
            salesorder: soIdNum,
            tranid: tranId,
            lines: bySoLine,
          }
        );
      }
      return;
    }

    log.audit("TEST: SO WOULD BE PICKED FOR TRANSFORM (no IF created)", {
      salesorder: soIdNum,
      tranid: tranId,
      eligibleLineCount: eligibleLines,
      lines: bySoLine,
    });

    if (isTarget) {
      log.audit(
        "TEST: TARGET SO WOULD BE PICKED FOR TRANSFORM (no IF created)",
        {
          salesorder: soIdNum,
          tranid: TARGET_TRANID,
          eligibleLineCount: eligibleLines,
          lines: bySoLine,
        }
      );
    }
  }

  function summarize(summary) {
    var soCount = 0;
    var totalQualifiedLines = 0;
    var soIds = [];
    var errorCount = 0;
    var errorIds = [];
    var metaById = {};
    var skippedIds = [];

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
        } catch (e) {}
      } else if (key === "__skipped_ts__") {
        skippedIds.push(String(value));
      }
      return true;
    });

    var processed = soIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });
    var errored = errorIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });
    var skipped = skippedIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });

    if (summary.inputSummary.error) {
      log.error("TEST: Input error", summary.inputSummary.error);
    }
    summary.mapSummary.errors.iterator().each(function (k, e) {
      log.error("TEST: Map error " + k, e);
      return true;
    });
    summary.reduceSummary.errors.iterator().each(function (k, e) {
      log.error("TEST: Reduce error " + k, e);
      return true;
    });

    log.audit("TEST: Run totals", {
      salesOrdersProcessed: soCount,
      qualifiedLines: totalQualifiedLines,
      processedSOs: processed,
      errorSOCount: errorCount,
      errorSOs: errored,
    });

    log.audit("TEST: MR usage", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
    });

    log.audit("TEST: Timestamp-skipped SOs", {
      skippedCount: skipped.length,
      skippedSOs: skipped,
    });

    var targetInProcessed = false;
    for (var i = 0; i < processed.length; i++) {
      if (Number(processed[i].id) === TARGET_SO_ID) {
        targetInProcessed = true;
        break;
      }
    }

    log.audit("TEST: TARGET SUMMARY", {
      targetSoId: TARGET_SO_ID,
      targetTranId: TARGET_TRANID,
      seenInProcessed: targetInProcessed,
      seenInSkippedTimestamp: skippedIds.indexOf(String(TARGET_SO_ID)) !== -1,
      seenInErrored: errorIds.indexOf(String(TARGET_SO_ID)) !== -1,
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
