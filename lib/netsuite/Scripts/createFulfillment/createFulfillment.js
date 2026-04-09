/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/record", "N/log", "N/email"], function (
  query,
  record,
  log,
  email,
) {
  var NOTIFY_EMAIL = [
    "raktim@hplapidary.com",
    "sherman@hplapidary.com",
    "roxanne@hplapidary.com",
    "liezl@hplapidary.com",
    "taylahna@hplapidary.com",
    "alissa@hplapidary.com",
  ];

  function isBlank(v) {
    return v === null || v === undefined || String(v).trim() === "";
  }

  function safeString(v) {
    return v === null || v === undefined ? "" : String(v).trim();
  }

  function getAddressSnapshotFromRec(parentRec, subrecordFieldId) {
    var out = {
      exists: false,
      values: {
        addr1: "",
        addr2: "",
        city: "",
        state: "",
        zip: "",
        country: "",
      },
      missing: [],
    };

    try {
      var subrec = parentRec.getSubrecord({ fieldId: subrecordFieldId });
      if (!subrec) return out;

      out.exists = true;
      out.values.addr1 = safeString(subrec.getValue({ fieldId: "addr1" }));
      out.values.addr2 = safeString(subrec.getValue({ fieldId: "addr2" }));
      out.values.city = safeString(subrec.getValue({ fieldId: "city" }));
      out.values.state = safeString(subrec.getValue({ fieldId: "state" }));
      out.values.zip = safeString(subrec.getValue({ fieldId: "zip" }));
      out.values.country = safeString(subrec.getValue({ fieldId: "country" }));

      var fields = ["addr1", "addr2", "city", "state", "zip"];
      for (var i = 0; i < fields.length; i++) {
        if (isBlank(out.values[fields[i]])) out.missing.push(fields[i]);
      }
    } catch (e) {
      out.error = e;
    }

    return out;
  }

  function writeNotFulfilled(context, soId, tranId, reason, details) {
    try {
      context.write(
        "__not_fulfilled__",
        JSON.stringify({
          soId: String(soId),
          tranId: tranId ? String(tranId) : "",
          reason: String(reason || ""),
          details: details || {},
        }),
      );
    } catch (e) {
      log.error("Failed writing __not_fulfilled__", {
        soId: soId,
        tranId: tranId,
        reason: reason,
        details: details,
        err: e,
      });
    }
  }

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
      "    AND itemtype IN ('InvtPart','Assembly','NonInvtPart','Service','ServiceResale')\n" +
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
      "              AND (itemtype IN ('NonInvtPart','Service','ServiceResale') OR qty_committed > 0)\n" +
      "              AND GREATEST(0, qty - qty_shiprecv) > 0\n" +
      "             THEN 1\n" +
      "             ELSE 0\n" +
      "           END\n" +
      "         ) AS paid_eligible_lines,\n" +
      "         MAX(CASE WHEN qty_backordered > 0 THEN 1 ELSE 0 END) AS has_backorder,\n" +
      "         SUM(CASE WHEN GREATEST(0, qty - qty_shiprecv) > 0 THEN 1 ELSE 0 END) AS remaining_lines,\n" +
      "         SUM(\n" +
      "           CASE\n" +
      "             WHEN item_paid_flag = 'T'\n" +
      "              AND qty_backordered = 0\n" +
      "              AND (itemtype IN ('NonInvtPart','Service','ServiceResale') OR qty_committed > 0)\n" +
      "              AND GREATEST(0, qty - qty_shiprecv) > 0\n" +
      "             THEN 1\n" +
      "             ELSE 0\n" +
      "           END\n" +
      "         ) AS eligible_remaining_lines\n" +
      "  FROM filt\n" +
      "  GROUP BY so_id\n" +
      "), eligible AS (\n" +
      "  SELECT f.so_id,\n" +
      "         f.so_line,\n" +
      "         GREATEST(0, f.qty - f.qty_shiprecv) AS remaining\n" +
      "  FROM filt f\n" +
      "  JOIN ord o ON o.so_id = f.so_id\n" +
      "  WHERE f.item_paid_flag = 'T'\n" +
      "    AND ( f.itemtype IN ('NonInvtPart','Service','ServiceResale') OR f.qty_committed > 0 )\n" +
      "    AND f.qty_backordered = 0\n" +
      "    AND GREATEST(0, f.qty - f.qty_shiprecv) > 0\n" +
      "    AND o.paid_eligible_lines >= 1\n" +
      "    AND (\n" +
      "      f.shipcomplete = 'F'\n" +
      "      OR (\n" +
      "        f.shipcomplete = 'T'\n" +
      "        AND o.has_backorder = 0\n" +
      "        AND o.remaining_lines > 0\n" +
      "        AND o.eligible_remaining_lines = o.remaining_lines\n" +
      "      )\n" +
      "    )\n" +
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

    try {
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
        writeNotFulfilled(context, soId, "", "Invalid SO id", {});
        return;
      }

      var meta = query
        .runSuiteQL({
          query:
            "SELECT id, tranid, custbody_hpl_paid_released_timestamp, custbody_hpl_paidreleased, custbody_hpl_hold_till " +
            "FROM transaction WHERE type = 'SalesOrd' AND id = " +
            soIdNum +
            " FETCH FIRST 1 ROWS ONLY",
        })
        .asMappedResults();

      if (!meta || !meta.length) {
        log.error("SO not found by SuiteQL", { salesorder: soIdNum });
        context.write("__error__", String(soId));
        writeNotFulfilled(context, soIdNum, "", "SO not found by SuiteQL", {});
        return;
      }

      var row = meta[0];
      var tranId = row.tranid;

      context.write(
        "__meta__",
        JSON.stringify({ soId: String(soIdNum), tranId: String(tranId) }),
      );

      var holdStr = row.custbody_hpl_hold_till;
      if (holdStr) {
        try {
          var s = String(holdStr).trim();
          var holdDate = new Date(s);

          if (isNaN(holdDate.getTime()) && s.indexOf("/") >= 0) {
            var parts = s.split("/");
            if (parts.length === 3) {
              var mm = parseInt(parts[0], 10);
              var dd = parseInt(parts[1], 10);
              var yy = parseInt(parts[2], 10);
              if (mm > 0 && dd > 0 && yy > 0) {
                holdDate = new Date(yy, mm - 1, dd);
              }
            }
          }

          var holdMs = holdDate.getTime();
          if (!isNaN(holdMs) && holdMs > Date.now()) {
            log.audit("Skip transform (hold till in future)", {
              salesorder: soIdNum,
              tranid: tranId,
              holdTill: s,
            });
            context.write("__skipped_hold_till__", String(soIdNum));
            writeNotFulfilled(context, soIdNum, tranId, "Hold till in future", {
              holdTill: s,
            });
            return;
          }
        } catch (eHold) {
          log.error("Hold till parse error; proceeding with transform", {
            salesorder: soIdNum,
            tranid: tranId,
            holdTill: holdStr,
            err: eHold,
          });
        }
      }

      var releasedVal = row.custbody_hpl_paidreleased;
      var isReleased =
        releasedVal === "T" || releasedVal === true || releasedVal === "true";

      if (!isReleased) {
        log.audit("Skip transform (paid released unchecked)", {
          salesorder: soIdNum,
          tranid: tranId,
          custbody_hpl_paidreleased: releasedVal,
        });
        context.write("__skipped_unreleased__", String(soIdNum));
        writeNotFulfilled(context, soIdNum, tranId, "Paid released unchecked", {
          custbody_hpl_paidreleased: releasedVal,
        });
        return;
      }

      var tsStr = row.custbody_hpl_paid_released_timestamp;
      if (tsStr) {
        try {
          var lastDate = new Date(String(tsStr));
          var lastMs = lastDate.getTime();
          if (!isNaN(lastMs)) {
            var nowMs = Date.now();
            var diffMs = nowMs - lastMs;
            var THIRTY_MIN_MS = 30 * 60 * 1000;
            if (diffMs < THIRTY_MIN_MS) {
              log.audit("Skip transform (recent paid_released timestamp)", {
                salesorder: soIdNum,
                tranid: tranId,
                timestamp: tsStr,
                ageMinutes: diffMs / 60000,
              });
              context.write("__skipped_ts__", String(soIdNum));
              writeNotFulfilled(
                context,
                soIdNum,
                tranId,
                "Recent paid released timestamp",
                {
                  timestamp: tsStr,
                  ageMinutes: diffMs / 60000,
                },
              );
              return;
            }
          }
        } catch (eTs) {
          log.error("Timestamp parse error; proceeding with transform", {
            salesorder: soIdNum,
            tranid: tranId,
            timestamp: tsStr,
            err: eTs,
          });
        }
      }

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
        writeNotFulfilled(context, soIdNum, tranId, "Transform failed", {
          error: String(e2),
        });
        return;
      }

      var shippingAddress = getAddressSnapshotFromRec(ifRec, "shippingaddress");
      var warnings = [];

      if (shippingAddress.error) {
        warnings.push(
          "Could not fully inspect shipping address: " +
            String(shippingAddress.error),
        );
        log.error("Shipping address read error", {
          salesorder: soIdNum,
          tranid: tranId,
          err: shippingAddress.error,
        });
      }

      if (!shippingAddress.exists) {
        log.audit("Skip transform (shipping address subrecord missing)", {
          salesorder: soIdNum,
          tranid: tranId,
        });
        context.write("__skipped_addr__", String(soIdNum));
        writeNotFulfilled(
          context,
          soIdNum,
          tranId,
          "Shipping address subrecord missing",
          {},
        );
        return;
      }

      if (isBlank(shippingAddress.values.addr1)) {
        log.audit("Skip transform (shipping addr1 missing)", {
          salesorder: soIdNum,
          tranid: tranId,
          shippingAddress: shippingAddress.values,
        });
        context.write("__skipped_addr__", String(soIdNum));
        writeNotFulfilled(context, soIdNum, tranId, "Shipping addr1 missing", {
          shippingAddress: shippingAddress.values,
        });
        return;
      }

      var shippingSoftMissing = [];
      var shippingSoftFields = ["addr2", "city", "state", "zip"];
      for (var sf = 0; sf < shippingSoftFields.length; sf++) {
        if (isBlank(shippingAddress.values[shippingSoftFields[sf]])) {
          shippingSoftMissing.push(shippingSoftFields[sf]);
        }
      }

      if (shippingSoftMissing.length) {
        warnings.push(
          "Shipping address missing non-blocking fields: " +
            shippingSoftMissing.join(", "),
        );
      }

      if (warnings.length) {
        log.audit("Address warnings; proceeding with fulfillment", {
          salesorder: soIdNum,
          tranid: tranId,
          warnings: warnings,
          shippingAddress: shippingAddress.values,
        });
        context.write(
          "__warning__",
          JSON.stringify({
            soId: String(soIdNum),
            tranId: String(tranId),
            warnings: warnings,
          }),
        );
      }

      var selected = 0;
      var m = ifRec.getLineCount({ sublistId: "item" }) || 0;
      for (var j = 0; j < m; j++) {
        ifRec.selectLine({ sublistId: "item", line: j });
        var soLineNum = Number(
          ifRec.getCurrentSublistValue({
            sublistId: "item",
            fieldId: "orderline",
          }) || 0,
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
        writeNotFulfilled(
          context,
          soIdNum,
          tranId,
          "No eligible lines to fulfill",
          {},
        );
        return;
      }

      try {
        var ifId = ifRec.save({
          ignoreMandatoryFields: false,
          enableSourcing: true,
        });

        context.write(
          "__fulfilled__",
          JSON.stringify({
            soId: String(soIdNum),
            tranId: String(tranId),
            itemFulfillmentId: String(ifId),
            linesSelected: selected,
          }),
        );

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
        writeNotFulfilled(context, soIdNum, tranId, "Save IF failed", {
          error: String(e3),
        });
      }
    } catch (eOuter) {
      log.error("Reduce failed", {
        salesorder: soId,
        err: eOuter,
      });
      context.write("__error__", String(soId));
      writeNotFulfilled(context, soId, "", "Reduce failed", {
        error: String(eOuter),
      });
    }
  }

  function summarize(summary) {
    var soCount = 0,
      totalQualifiedLines = 0,
      soIds = [],
      errorCount = 0,
      errorIds = [],
      metaById = {},
      skippedIds = [],
      skippedUnreleasedIds = [],
      skippedHoldTillIds = [],
      skippedAddrIds = [],
      warningRows = [],
      notFulfilledRows = [],
      fulfilledRows = [];

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
      } else if (key === "__skipped_ts__") {
        skippedIds.push(String(value));
      } else if (key === "__skipped_hold_till__") {
        skippedHoldTillIds.push(String(value));
      } else if (key === "__skipped_unreleased__") {
        skippedUnreleasedIds.push(String(value));
      } else if (key === "__skipped_addr__") {
        skippedAddrIds.push(String(value));
      } else if (key === "__warning__") {
        try {
          warningRows.push(JSON.parse(String(value)));
        } catch (_) {}
      } else if (key === "__not_fulfilled__") {
        try {
          notFulfilledRows.push(JSON.parse(String(value)));
        } catch (_) {}
      } else if (key === "__fulfilled__") {
        try {
          fulfilledRows.push(JSON.parse(String(value)));
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
    var skipped = skippedIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });
    var skippedUnreleased = skippedUnreleasedIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });
    var skippedHoldTill = skippedHoldTillIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });
    var skippedAddr = skippedAddrIds.map(function (id) {
      return { id: String(id), tranid: metaById[String(id)] || null };
    });

    if (summary.inputSummary.error) {
      log.error("Input error", summary.inputSummary.error);
    }
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
      createdFulfillments: fulfilledRows.length,
    });

    log.audit("MR usage", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
    });

    log.audit("Timestamp-skipped SOs", {
      skippedCount: skipped.length,
      skippedSOs: skipped,
    });

    log.audit("Unreleased-skipped SOs", {
      skippedCount: skippedUnreleased.length,
      skippedSOs: skippedUnreleased,
    });

    log.audit("Hold-till-skipped SOs", {
      skippedCount: skippedHoldTill.length,
      skippedSOs: skippedHoldTill,
    });

    log.audit("Address-skipped SOs", {
      skippedCount: skippedAddr.length,
      skippedSOs: skippedAddr,
    });

    log.audit("Address-related totals", {
      addressSkippedCount: skippedAddr.length,
      addressWarningCount: warningRows.length,
    });

    if (warningRows.length) {
      log.audit("Address warning SOs", {
        warningCount: warningRows.length,
        warnings: warningRows,
      });
    }

    if (fulfilledRows.length) {
      log.audit("Created fulfillments", {
        count: fulfilledRows.length,
        rows: fulfilledRows,
      });
    }

    if (skippedAddr.length) {
      try {
        var subject = "Auto-fulfillment run summary";
        var body = [];

        body.push("Auto-fulfillment run completed.");
        body.push("");
        body.push("Summary:");
        body.push("Processed SOs: " + soCount);
        body.push("Qualified Lines: " + totalQualifiedLines);
        body.push("Created Fulfillments: " + fulfilledRows.length);
        body.push("Error SO Count: " + errorCount);
        body.push("Timestamp Skips: " + skipped.length);
        body.push("Unreleased Skips: " + skippedUnreleased.length);
        body.push("Hold Till Skips: " + skippedHoldTill.length);
        body.push("Address Skips: " + skippedAddr.length);
        body.push("Address Warnings Logged: " + warningRows.length);
        body.push("Not Fulfilled Rows: " + notFulfilledRows.length);
        body.push("");

        if (fulfilledRows.length) {
          body.push("Created fulfillments:");
          for (var f = 0; f < fulfilledRows.length; f++) {
            var fr = fulfilledRows[f] || {};
            body.push(
              [
                "SO ID: " + safeString(fr.soId),
                "Tran ID: " + safeString(fr.tranId),
                "IF ID: " + safeString(fr.itemFulfillmentId),
                "Lines Selected: " + safeString(fr.linesSelected),
              ].join(" | "),
            );
          }
          body.push("");
        }
        if (skippedAddr.length) {
          body.push("Address-skipped sales orders:");
          for (var a = 0; a < skippedAddr.length; a++) {
            var as = skippedAddr[a] || {};
            body.push(
              [
                "SO ID: " + safeString(as.id),
                "Tran ID: " + safeString(as.tranid),
              ].join(" | "),
            );
          }
          body.push("");
        }
        if (warningRows.length) {
          body.push("Address warnings logged:");
          for (var w = 0; w < warningRows.length; w++) {
            var wr = warningRows[w] || {};
            body.push(
              [
                "SO ID: " + safeString(wr.soId),
                "Tran ID: " + safeString(wr.tranId),
                "Warnings: " + JSON.stringify(wr.warnings || []),
              ].join(" | "),
            );
          }
          body.push("");
        }

        if (notFulfilledRows.length) {
          body.push("The following sales orders were not fulfilled:");
          body.push("");
          for (var n = 0; n < notFulfilledRows.length; n++) {
            var nf = notFulfilledRows[n] || {};
            body.push(
              [
                "SO ID: " + safeString(nf.soId),
                "Tran ID: " + safeString(nf.tranId),
                "Reason: " + safeString(nf.reason),
                "Details: " + JSON.stringify(nf.details || {}),
              ].join(" | "),
            );
          }
          body.push("");
        }

        if (errored.length) {
          body.push("Errored sales orders:");
          for (var e = 0; e < errored.length; e++) {
            var er = errored[e] || {};
            body.push(
              [
                "SO ID: " + safeString(er.id),
                "Tran ID: " + safeString(er.tranid),
              ].join(" | "),
            );
          }
        }

        email.send({
          author: -5,
          recipients: NOTIFY_EMAIL,
          subject: subject,
          body: body.join("\n"),
        });

        log.audit("Run summary email sent", {
          recipient: NOTIFY_EMAIL,
          notFulfilledCount: notFulfilledRows.length,
          createdFulfillments: fulfilledRows.length,
          addressWarningCount: warningRows.length,
          addressSkippedCount: skippedAddr.length,
          errorSOCount: errorCount,
        });
      } catch (eEmail) {
        log.error("Failed to send run summary email", {
          recipient: NOTIFY_EMAIL,
          err: eEmail,
        });
      }
    }
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
