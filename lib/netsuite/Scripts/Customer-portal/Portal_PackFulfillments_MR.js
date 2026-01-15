/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Exports Item Fulfillments (T.type='ItemShip') + line details to File Cabinet "exports" folder as JSONL:
 * - fulfillments.jsonl
 * - fulfillment_lines.jsonl
 * - manifest_fulfillments_latest.json
 *
 * Fulfillments fields:
 *   fulfillment_id, tran_id, trandate, customer_id, ship_status, status,
 *   created_from_so_id, created_from_so_tranid,
 *   tracking, tracking_urls, tracking_details
 *
 * Lines fields:
 *   fulfillment_id, line_id, line_no, item_id, item_sku, item_display_name, quantity,
 *   serial_numbers, comments
 */
define(["N/query", "N/file", "N/search", "N/runtime", "N/log"], function (
  query,
  file,
  search,
  runtime,
  log
) {
  function getInputData() {
    return [1];
  }

  function map(context) {
    context.write({ key: "RUN", value: "RUN" });
  }

  function reduce(context) {}

  function summarize(summary) {
    var folderId = Number(
      runtime.getCurrentScript().getParameter({
        name: "custscript_exports_folder_id",
      }) || 2279
    );

    var PAGE = 1000;

    function runQL(q, params, tag) {
      try {
        return (
          query
            .runSuiteQL({
              query: q,
              params: params || [],
            })
            .asMappedResults() || []
        );
      } catch (e) {
        log.debug("SuiteQL failed: " + (tag || ""), {
          message: e && e.message,
          name: e && e.name,
          details: e,
          q: q,
        });
        throw e;
      }
    }

    function findFileIdsByName(name) {
      var ids = [];
      var s = search.create({
        type: "file",
        filters: [
          ["name", "is", name],
          "AND",
          ["folder", "anyof", String(folderId)],
        ],
        columns: ["internalid"],
      });
      s.run().each(function (res) {
        ids.push(Number(res.getValue("internalid")));
        return true;
      });
      return ids;
    }

    function deleteAllByName(name) {
      var ids = findFileIdsByName(name);
      for (var i = 0; i < ids.length; i++) {
        try {
          file["delete"]({ id: ids[i] });
        } catch (e) {
          log.debug("deleteAllByName failed", {
            name: name,
            id: ids[i],
            error: e,
          });
        }
      }
    }

    function createTempThenRename(finalName, contents, fileType) {
      deleteAllByName(finalName);

      var tempName = finalName + "." + Date.now() + ".tmp";
      var tempId = file
        .create({
          name: tempName,
          fileType: fileType,
          contents: contents,
          folder: folderId,
        })
        .save();

      var f = file.load({ id: tempId });
      f.name = finalName;
      var finalId = f.save();

      var ids = findFileIdsByName(finalName);
      if (ids.length > 1) {
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i];
          if (id !== finalId) {
            try {
              file["delete"]({ id: id });
            } catch (e) {
              log.debug("createTempThenRename cleanup failed", {
                finalName: finalName,
                id: id,
                error: e,
              });
            }
          }
        }
      }

      return finalId;
    }

    function inferCarrierFromNumber(num) {
      var n = String(num || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
      if (/^[A-Z]{2}\d{9}US$/.test(n)) return "usps";
      if (/^\d{20,22}$/.test(n)) {
        if (/^9\d{19,21}$/.test(n)) return "usps";
        return "fedex";
      }
      if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n)) return "fedex";
      if (/^\d{10}$/.test(n) || /^JJD\d+$/i.test(n) || /^JVGL\d+$/i.test(n))
        return "dhl";
      if (/^C\d{12}$/i.test(n)) return "ontrac";
      return "";
    }

    function buildTrackingUrl(carrier, num) {
      if (!num) return "";
      var n = encodeURIComponent(String(num));
      var c = String(carrier || "").toLowerCase();
      if (c.indexOf("fedex") !== -1)
        return "https://www.fedex.com/fedextrack/?tracknumbers=" + n;
      if (c.indexOf("ups") !== -1)
        return "https://www.ups.com/track?tracknum=" + n;
      if (c.indexOf("usps") !== -1)
        return "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + n;
      if (c.indexOf("dhl") !== -1)
        return (
          "https://www.dhl.com/global-en/home/tracking.html?tracking-id=" + n
        );
      if (c.indexOf("ontrac") !== -1)
        return "https://www.ontrac.com/trackingres.asp?tracking_number=" + n;
      return (
        "https://www.google.com/search?q=" +
        encodeURIComponent(String(num) + " tracking")
      );
    }

    function dedupeTrackingDetails(arr) {
      var seen = {};
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var d = arr[i];
        var key =
          String(d.number || "") +
          "::" +
          String(d.carrier || "") +
          "::" +
          String(d.url || "");
        if (!seen[key]) {
          seen[key] = true;
          out.push(d);
        }
      }
      return out;
    }

    function parseTrackingDetails(trackingNumbersText) {
      var s = String(trackingNumbersText || "").trim();
      if (!s)
        return {
          tracking: null,
          tracking_urls: [],
          tracking_details: [],
        };

      var parts = s
        .split(",")
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(function (x) {
          return !!x;
        });

      var details = [];
      for (var i = 0; i < parts.length; i++) {
        var num = parts[i];
        var carrier = inferCarrierFromNumber(num);
        details.push({
          number: num,
          carrier: carrier,
          url: buildTrackingUrl(carrier, num),
        });
      }
      details = dedupeTrackingDetails(details);

      return {
        tracking: details.length
          ? details
              .map(function (p) {
                return p.number;
              })
              .join(", ")
          : null,
        tracking_urls: details.map(function (p) {
          return p.url;
        }),
        tracking_details: details,
      };
    }

    function loadFulfillmentHeaders(csv) {
      var baseSelect =
        "SELECT " +
        "  T.id AS fulfillmentId, " +
        "  T.tranid AS tranId, " +
        "  TO_CHAR(T.trandate,'YYYY-MM-DD') AS trandate, " +
        "  T.entity AS customerId, " +
        "  BUILTIN.DF(T.status) AS status ";

      var fromWhere =
        "FROM transaction T " +
        "WHERE T.type='ItemShip' AND T.id IN (" +
        csv +
        ")";

      var variants = [
        {
          tag: "headers_with_shipstatus_and_tracking",
          q:
            baseSelect +
            ", BUILTIN.DF(T.shipstatus) AS shipStatus, " +
            "  BUILTIN.DF(T.TrackingNumberList) AS trackingNumbers " +
            fromWhere,
          hasShipStatus: true,
          hasTracking: true,
        },
        {
          tag: "headers_with_tracking_only",
          q:
            baseSelect +
            ", BUILTIN.DF(T.TrackingNumberList) AS trackingNumbers " +
            fromWhere,
          hasShipStatus: false,
          hasTracking: true,
        },
        {
          tag: "headers_with_shipstatus_only",
          q:
            baseSelect +
            ", BUILTIN.DF(T.shipstatus) AS shipStatus " +
            fromWhere,
          hasShipStatus: true,
          hasTracking: false,
        },
        {
          tag: "headers_minimal",
          q: baseSelect + fromWhere,
          hasShipStatus: false,
          hasTracking: false,
        },
      ];

      for (var i = 0; i < variants.length; i++) {
        try {
          var rows = runQL(variants[i].q, [], variants[i].tag);
          return {
            rows: rows,
            hasShipStatus: variants[i].hasShipStatus,
            hasTracking: variants[i].hasTracking,
          };
        } catch (e) {
          // try next variant
        }
      }

      return {
        rows: runQL(variants[variants.length - 1].q, [], "headers_final"),
        hasShipStatus: false,
        hasTracking: false,
      };
    }

    var fulfillmentOut = [];
    var lineOut = [];
    var fulfillmentCount = 0;
    var lineCount = 0;

    var lastId = 0;

    for (;;) {
      var ids =
        query
          .runSuiteQL({
            query:
              "SELECT T.id AS fulfillmentId " +
              "FROM transaction T " +
              "WHERE T.type='ItemShip' AND T.id > ? " +
              "ORDER BY T.id ASC " +
              "FETCH NEXT " +
              PAGE +
              " ROWS ONLY",
            params: [lastId],
          })
          .asMappedResults() || [];

      if (!ids.length) break;

      var idList = ids
        .map(function (r) {
          return Number(r.fulfillmentid);
        })
        .filter(function (n) {
          return !!n;
        });

      lastId = idList[idList.length - 1];
      var csv = idList.join(",");

      // Headers with safe fallbacks
      var headerLoad = loadFulfillmentHeaders(csv);
      var h = headerLoad.rows || [];
      var hasShipStatus = !!headerLoad.hasShipStatus;
      var hasTrackingNumbers = !!headerLoad.hasTracking;

      // SO link
      var soLinkQ =
        "SELECT " +
        "  PTL.NextDoc AS fulfillmentId, " +
        "  PTL.PreviousDoc AS soId, " +
        "  S.tranid AS soTranId " +
        "FROM PreviousTransactionLink PTL " +
        "JOIN transaction S ON S.id = PTL.PreviousDoc " +
        "WHERE PTL.NextDoc IN (" +
        csv +
        ") AND S.type='SalesOrd'";

      // Lines
      var linesQ =
        "SELECT " +
        "  TL.transaction AS fulfillmentId, " +
        "  TL.id AS lineId, " +
        "  TL.linesequencenumber AS lineNo, " +
        "  TL.item AS itemId, " +
        "  I.itemid AS sku, " +
        "  COALESCE(I.displayname, I.itemid) AS displayName, " +
        "  ABS(NVL(TL.quantity,0)) AS quantity, " +
        "  TL.custcol_comment AS lineComment " +
        "FROM transactionline TL " +
        "LEFT JOIN item I ON I.id = TL.item " +
        "WHERE TL.transaction IN (" +
        csv +
        ") " +
        "  AND TL.mainline='F' " +
        "  AND NVL(TL.taxline,'F')='F'";

      // Serial / lot numbers
      var invNumsQ =
        "SELECT " +
        "  TIN.transaction_id AS fulfillmentId, " +
        "  TIN.transaction_line AS lineId, " +
        "  TIN.inventory_number AS inventoryNumber " +
        "FROM transaction_inventory_numbers TIN " +
        "WHERE TIN.transaction_id IN (" +
        csv +
        ")";

      var s = runQL(soLinkQ, [], "soLinkQ");
      var l = runQL(linesQ, [], "linesQ");

      var n = [];
      try {
        n = runQL(invNumsQ, [], "invNumsQ");
      } catch (e) {
        log.debug("invNumsQ failed; serial_numbers will be null", {
          message: e && e.message,
        });
        n = [];
      }

      var soByFid = {};
      for (var i = 0; i < s.length; i++) {
        var fid = Number(s[i].fulfillmentid);
        if (!fid) continue;
        if (!soByFid[fid]) {
          soByFid[fid] = {
            soId:
              s[i].soid != null && s[i].soid !== "" ? Number(s[i].soid) : null,
            soTranId: s[i].sotranid || null,
          };
        }
      }

      var serialsByLine = {};
      for (var j = 0; j < n.length; j++) {
        var fid2 = Number(n[j].fulfillmentid);
        var lid2 = Number(n[j].lineid);
        var inv =
          n[j].inventorynumber != null ? String(n[j].inventorynumber) : "";
        if (!fid2 || !lid2 || !inv) continue;
        var key = fid2 + "::" + lid2;
        if (!serialsByLine[key]) serialsByLine[key] = [];
        serialsByLine[key].push(inv);
      }
      Object.keys(serialsByLine).forEach(function (k) {
        var arr = serialsByLine[k];
        var seen = {};
        var out = [];
        for (var x = 0; x < arr.length; x++) {
          var v = String(arr[x]);
          if (!seen[v]) {
            seen[v] = true;
            out.push(v);
          }
        }
        serialsByLine[k] = out;
      });

      var headById = {};
      for (var a = 0; a < h.length; a++) {
        var row = h[a];
        var fid3 = Number(row.fulfillmentid);
        if (!fid3) continue;
        headById[fid3] = row;
      }

      // fulfillments.jsonl
      for (var b = 0; b < idList.length; b++) {
        var fid4 = Number(idList[b]);
        var head = headById[fid4];
        if (!head) continue;

        var so = soByFid[fid4] || { soId: null, soTranId: null };
        var trackingText = hasTrackingNumbers ? head.trackingnumbers || "" : "";
        var track = parseTrackingDetails(trackingText);

        fulfillmentOut.push(
          JSON.stringify({
            fulfillment_id: fid4,
            tran_id: head.tranid || null,
            trandate: head.trandate || null,
            customer_id:
              head.customerid != null && head.customerid !== ""
                ? Number(head.customerid)
                : null,
            ship_status: hasShipStatus ? head.shipstatus || null : null,
            status: head.status || null,
            created_from_so_id: so.soId,
            created_from_so_tranid: so.soTranId,
            tracking: track.tracking,
            tracking_urls: track.tracking_urls.length
              ? track.tracking_urls
              : [],
            tracking_details: track.tracking_details.length
              ? track.tracking_details
              : [],
          }) + "\n"
        );
        fulfillmentCount++;
      }

      // fulfillment_lines.jsonl
      for (var c = 0; c < l.length; c++) {
        var lr = l[c];

        var fid5 = Number(lr.fulfillmentid);
        var lineId =
          lr.lineid != null && lr.lineid !== "" ? Number(lr.lineid) : null;
        var lineNo =
          lr.lineno != null && lr.lineno !== "" ? Number(lr.lineno) : 0;

        var key2 = fid5 && lineId ? fid5 + "::" + lineId : null;
        var serials = key2 && serialsByLine[key2] ? serialsByLine[key2] : null;

        var commentVal =
          lr.linecomment != null && lr.linecomment !== ""
            ? String(lr.linecomment)
            : null;

        lineOut.push(
          JSON.stringify({
            fulfillment_id: fid5,
            line_id: lineId,
            line_no: lineNo,
            item_id:
              lr.itemid != null && lr.itemid !== "" ? Number(lr.itemid) : null,
            item_sku: lr.sku || null,
            item_display_name: lr.displayname || lr.sku || null,
            quantity: Number(lr.quantity || 0),
            serial_numbers: serials && serials.length ? serials : null,
            comments: commentVal ? [commentVal] : null,
          }) + "\n"
        );
        lineCount++;
      }
    }

    var fName = "fulfillments.jsonl";
    var lnName = "fulfillment_lines.jsonl";
    var mfName = "manifest_fulfillments_latest.json";

    var fFulfillmentsId = createTempThenRename(
      fName,
      fulfillmentOut.join(""),
      file.Type.PLAINTEXT
    );

    var fLinesId = createTempThenRename(
      lnName,
      lineOut.join(""),
      file.Type.PLAINTEXT
    );

    var manifest = {
      generated_at: new Date().toISOString(),
      folder_id: folderId,
      notes: {
        ship_status_supported: false,
        tracking_numbers_supported: false,
      },
      files: {
        fulfillments: {
          id: fFulfillmentsId,
          name: fName,
          rows: fulfillmentCount,
        },
        fulfillment_lines: { id: fLinesId, name: lnName, rows: lineCount },
      },
    };

    manifest.notes.ship_status_supported = false;
    manifest.notes.tracking_numbers_supported = true;

    createTempThenRename(mfName, JSON.stringify(manifest), file.Type.JSON);

    log.audit("Fulfillment export complete", {
      folderId: folderId,
      fulfillments: fulfillmentCount,
      lines: lineCount,
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
