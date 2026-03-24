/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * ETA per SO line for ALL ACTIVE ITEMS (item.isinactive = F).
 *
 *
 * Outputs Export\:
 *  - eta_all_lines.jsonl
 *  - manifest_eta_all_lines_latest.json
 *
 * Date source:
 *  - Inbound supply uses Inbound Shipment Expected Delivery Date
 */
define(["N/query", "N/file", "N/search", "N/runtime", "N/log"], function (
  query,
  file,
  search,
  runtime,
  log,
) {
  function getInputData() {
    return [1];
  }

  function map(ctx) {
    ctx.write({ key: "RUN", value: "RUN" });
  }

  function reduce(ctx) {}

  function summarize(summary) {
    // ----------------------------
    // Params
    // ----------------------------
    var folderId = Number(
      runtime
        .getCurrentScript()
        .getParameter({ name: "custscript_exports_folder_id" }) || 2279,
    );

    var locationName =
      runtime
        .getCurrentScript()
        .getParameter({ name: "custscript_eta_location_name" }) || "Warehouse";

    var PAGE = 1000;

    function two(n) {
      return n < 10 ? "0" + n : "" + n;
    }

    var d = new Date();
    var tag =
      d.getFullYear().toString() +
      two(d.getMonth() + 1) +
      two(d.getDate()) +
      "_" +
      two(d.getHours()) +
      two(d.getMinutes()) +
      two(d.getSeconds());

    // ----------------------------
    // File helpers
    // ----------------------------
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
          log.debug("deleteAllByName: delete failed", {
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
              log.debug("createTempThenRename: cleanup delete failed", {
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

    function createAppendWriter(finalName) {
      deleteAllByName(finalName);

      var tempName = finalName + "." + Date.now() + ".tmp";
      var tempId = file
        .create({
          name: tempName,
          fileType: file.Type.PLAINTEXT,
          contents: "",
          folder: folderId,
        })
        .save();

      var f = file.load({ id: tempId });
      var pendingAppends = 0;

      function appendChunk(text) {
        if (!text) return;
        var v = String(text);
        if (v.endsWith("\n")) v = v.slice(0, -1);
        if (!v) return;

        f.appendLine({ value: v });
        pendingAppends++;

        if (pendingAppends >= 40) {
          tempId = f.save();
          f = file.load({ id: tempId });
          pendingAppends = 0;
        }
      }

      function finalizeRename() {
        tempId = f.save();
        var finalF = file.load({ id: tempId });
        finalF.name = finalName;
        var finalId = finalF.save();

        var ids = findFileIdsByName(finalName);
        if (ids.length > 1) {
          for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (id !== finalId) {
              try {
                file["delete"]({ id: id });
              } catch (e) {
                log.debug("writer cleanup failed", {
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

      return { appendChunk: appendChunk, finalizeRename: finalizeRename };
    }

    // ----------------------------
    // Helpers
    // ----------------------------
    function toNum(v) {
      var n = Number(v);
      return isFinite(n) ? n : 0;
    }

    function dateToMs(v) {
      if (!v) return null;
      if (Object.prototype.toString.call(v) === "[object Date]") {
        var t = v.getTime();
        return isFinite(t) ? t : null;
      }
      var s = String(v).trim();
      if (!s) return null;

      if (s.indexOf("/") !== -1) {
        var parts = s.split("/");
        if (parts.length >= 3) {
          var mm = parseInt(parts[0], 10);
          var dd = parseInt(parts[1], 10);
          var yy = parseInt(parts[2], 10);
          if (isFinite(mm) && isFinite(dd) && isFinite(yy)) {
            var d2 = new Date(yy, mm - 1, dd);
            var ms = d2.getTime();
            return isFinite(ms) ? ms : null;
          }
        }
      }
      var ms2 = Date.parse(s);
      return isFinite(ms2) ? ms2 : null;
    }

    function msOrFarFuture(v) {
      var ms = dateToMs(v);
      return ms == null ? 253402214400000 : ms;
    }

    function getLocationIdByName(name) {
      var s = search.create({
        type: search.Type.LOCATION,
        filters: [["name", "is", String(name)]],
        columns: ["internalid"],
      });
      var r = s.run().getRange({ start: 0, end: 1 })[0];
      return r ? Number(r.getValue("internalid")) : null;
    }

    function fetchOnHandByItem(locationId, itemIds) {
      var map = {};
      var batch = 1000;

      for (var i = 0; i < itemIds.length; i += batch) {
        var slice = itemIds.slice(i, i + batch).map(String);
        var s = search.create({
          type: search.Type.ITEM,
          filters: [
            ["internalid", "anyof", slice],
            "AND",
            ["inventorylocation", "anyof", String(locationId)],
          ],
          columns: [
            "internalid",
            search.createColumn({ name: "locationquantityonhand" }),
          ],
        });

        s.run().each(function (r) {
          var id = Number(r.getValue("internalid"));
          map[id] = toNum(r.getValue("locationquantityonhand"));
          return true;
        });
      }
      return map;
    }

    // ----------------------------
    // Load SUPPLY (Inbound only) grouped by itemId
    // ----------------------------
    function loadSupplyInboundByItem(locationId) {
      var supplyByItem = {};
      var supported = true;
      var colsUsed = [];
      var count = 0;

      function safeVal(r, field) {
        try {
          return r.getValue(field);
        } catch (e) {
          return null;
        }
      }

      try {
        var cols = [
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: "shipmentnumber" }),
          search.createColumn({ name: "expecteddeliverydate" }),
          search.createColumn({ name: "item" }),
          search.createColumn({ name: "quantityexpected" }),
          search.createColumn({ name: "quantityreceived" }),
        ];

        var s = search.create({
          type: "inboundshipment",
          filters: [["expecteddeliverydate", "isnotempty", ""]],
          columns: cols,
        });

        colsUsed = [
          "internalid",
          "shipmentnumber",
          "expecteddeliverydate",
          "item",
          "quantityexpected",
          "quantityreceived",
        ];

        var paged = s.runPaged({ pageSize: 1000 });
        paged.pageRanges.forEach(function (pr) {
          var page = paged.fetch({ index: pr.index });
          page.data.forEach(function (r) {
            var exp = safeVal(r, "expecteddeliverydate");
            if (!exp) return;

            var itemId = Number(safeVal(r, "item"));
            if (!itemId) return;

            var expectedQty = Math.abs(toNum(safeVal(r, "quantityexpected")));
            var receivedQty = Math.abs(toNum(safeVal(r, "quantityreceived")));
            var remaining = Math.max(0, expectedQty - receivedQty);
            if (remaining <= 0) return;

            if (!supplyByItem[itemId]) supplyByItem[itemId] = [];
            supplyByItem[itemId].push({
              expectedDate: exp,
              expectedMs: msOrFarFuture(exp),
              qty: remaining,
              sourceType: "Inbound Shipment",
              sourceId: Number(safeVal(r, "internalid")),
              sourceTranId: safeVal(r, "shipmentnumber") || null,
            });
            count++;
          });
        });

        log.debug("Inbound supply loaded", {
          colsUsed: colsUsed,
          dateFieldUsed: "expecteddeliverydate",
        });
      } catch (e) {
        supported = false;
        log.audit("Inbound shipments skipped", { message: e && e.message });
      }

      return {
        supplyByItem: supplyByItem,
        supported: supported,
        colsUsed: colsUsed,
        count: count,
      };
    }

    // ----------------------------
    // Load DEMAND (SO lines) grouped by itemId
    // ----------------------------
    function loadDemandByItem(locationId) {
      var demandByItem = {};
      var itemIdSet = {};
      var soCount = 0;
      var lineCount = 0;

      var lastId = 0;

      for (;;) {
        var ids =
          query
            .runSuiteQL({
              query:
                "SELECT T.id AS soId " +
                "FROM transaction T " +
                "WHERE T.type='SalesOrd' AND T.id > ? " +
                "ORDER BY T.id ASC " +
                "FETCH NEXT " +
                PAGE +
                " ROWS ONLY",
              params: [lastId],
            })
            .asMappedResults() || [];

        if (!ids.length) break;

        var idList = ids.map(function (r) {
          return Number(r.soid);
        });
        lastId = idList[idList.length - 1];
        var csv = idList.join(",");

        var q1 =
          "SELECT " +
          "  TL.transaction AS soId, " +
          "  T.tranid AS soTranId, " +
          "  T.trandate AS trandate, " +
          "  T.shipdate AS shipdate, " +
          "  T.entity AS customerId, " +
          "  TL.linesequencenumber AS lineSeq, " +
          "  TL.id AS nsLineId, " +
          "  I.id AS itemId, " +
          "  I.itemid AS sku, " +
          "  NVL(ABS(TL.quantity),0) AS qty, " +
          "  NVL(ABS(TL.quantityshiprecv),0) AS shiprecv " +
          "FROM transactionline TL " +
          "JOIN transaction T ON T.id = TL.transaction " +
          "JOIN item I ON I.id = TL.item " +
          "WHERE TL.transaction IN (" +
          csv +
          ") " +
          "  AND TL.mainline='F' " +
          "  AND NVL(TL.accountinglinetype,'') <> 'Tax' " +
          "  AND TL.location = " +
          Number(locationId) +
          " " +
          "  AND I.isinactive = 'F' " +
          "  AND NVL(I.itemtype,'') <> 'NonInvtPart' " +
          "  AND NVL(TL.isclosed,'F') = 'F'";

        var rows = null;
        var usedShipRecv = true;
        try {
          rows = query.runSuiteQL({ query: q1 }).asMappedResults() || [];
        } catch (e) {
          usedShipRecv = false;
          var q2 =
            "SELECT " +
            "  TL.transaction AS soId, " +
            "  T.tranid AS soTranId, " +
            "  T.trandate AS trandate, " +
            "  T.shipdate AS shipdate, " +
            "  T.entity AS customerId, " +
            "  TL.linesequencenumber AS lineSeq, " +
            "  TL.id AS nsLineId, " +
            "  I.id AS itemId, " +
            "  I.itemid AS sku, " +
            "  NVL(ABS(TL.quantity),0) AS qty " +
            "FROM transactionline TL " +
            "JOIN transaction T ON T.id = TL.transaction " +
            "JOIN item I ON I.id = TL.item " +
            "WHERE TL.transaction IN (" +
            csv +
            ") " +
            "  AND TL.mainline='F' " +
            "  AND NVL(TL.accountinglinetype,'') <> 'Tax' " +
            "  AND TL.location = " +
            Number(locationId) +
            " " +
            "  AND I.isinactive = 'F' " +
            "  AND NVL(I.itemtype,'') <> 'NonInvtPart' " +
            "  AND NVL(TL.isclosed,'F') = 'F'";
          rows = query.runSuiteQL({ query: q2 }).asMappedResults() || [];
        }

        soCount += ids.length;

        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];

          var itemId = Number(r.itemid);
          if (!itemId) continue;

          var qty = toNum(r.qty);
          var shiprecv = usedShipRecv ? toNum(r.shiprecv) : 0;
          var remaining = Math.max(0, Math.abs(qty) - Math.abs(shiprecv));
          if (remaining <= 0) continue;

          var trandate = r.trandate || null;

          if (!demandByItem[itemId]) demandByItem[itemId] = [];
          demandByItem[itemId].push({
            soId: Number(r.soid),
            soTranId: r.sotranid || null,
            trandate: trandate,
            trandateMs: msOrFarFuture(trandate),
            shipdate: r.shipdate || null,
            customerId:
              r.customerid != null && r.customerid !== ""
                ? Number(r.customerid)
                : null,
            lineSeq: toNum(r.lineseq),
            nsLineId:
              r.nslineid != null && r.nslineid !== ""
                ? Number(r.nslineid)
                : null,
            itemSku: r.sku || null,
            qtyRemaining: remaining,
          });

          itemIdSet[itemId] = true;
          lineCount++;
        }
      }

      return {
        demandByItem: demandByItem,
        itemIds: Object.keys(itemIdSet)
          .map(function (x) {
            return Number(x);
          })
          .sort(function (a, b) {
            return a - b;
          }),
        soCount: soCount,
        lineCount: lineCount,
      };
    }

    // ----------------------------
    // Core ETA compute (per item)
    // ----------------------------
    function computeAndWriteAll(
      demandByItem,
      supplyByItem,
      onHandByItem,
      writer,
      locationId,
    ) {
      var totalOut = 0;

      var itemIds = Object.keys(demandByItem)
        .map(function (x) {
          return Number(x);
        })
        .sort(function (a, b) {
          return a - b;
        });

      for (var ii = 0; ii < itemIds.length; ii++) {
        var itemId = itemIds[ii];
        var demand = demandByItem[itemId] || [];
        if (!demand.length) continue;

        demand.sort(function (a, b) {
          if (a.trandateMs !== b.trandateMs) return a.trandateMs - b.trandateMs;
          if (a.soId !== b.soId) return a.soId - b.soId;
          return (a.lineSeq || 0) - (b.lineSeq || 0);
        });

        var supply = supplyByItem[itemId] || [];
        if (supply.length) {
          supply.sort(function (a, b) {
            if (a.expectedMs !== b.expectedMs)
              return a.expectedMs - b.expectedMs;
            return (a.sourceId || 0) - (b.sourceId || 0);
          });
        }

        var cum = [];
        var runningCum = 0;
        for (var s = 0; s < supply.length; s++) {
          runningCum += Math.abs(toNum(supply[s].qty));
          cum.push(runningCum);
        }

        var startingOnHand = Math.abs(toNum(onHandByItem[itemId] || 0));
        var running = startingOnHand;

        var etaIdx = 0;
        var buf = [];
        var BUF_MAX = 500;

        for (var k = 0; k < demand.length; k++) {
          var drow = demand[k];
          running -= Math.abs(toNum(drow.qtyRemaining));

          if (running < 0) {
            var deficit = Math.abs(running);

            while (etaIdx < cum.length && cum[etaIdx] < deficit) etaIdx++;
            var eta = etaIdx < supply.length ? supply[etaIdx] : null;

            buf.push(
              JSON.stringify({
                location_id: locationId,
                location_name: locationName,

                item_id: itemId,
                item_sku: drow.itemSku,

                starting_on_hand: startingOnHand,

                so_id: drow.soId,
                so_tranid: drow.soTranId,
                customer_id: drow.customerId,

                queue_date: drow.trandate,
                tran_date: drow.trandate,
                ship_date: drow.shipdate,

                line_seq: drow.lineSeq,
                ns_line_id: drow.nsLineId,

                qty_remaining: drow.qtyRemaining,
                projected_after: running,
                deficit: deficit,

                eta_date: eta ? eta.expectedDate : null,
                eta_source_type: eta ? eta.sourceType : null,
                eta_source_id: eta ? eta.sourceId : null,
                eta_source_tranid: eta ? eta.sourceTranId : null,
                eta_source_qty: eta ? eta.qty : null,
              }),
            );

            totalOut++;

            if (buf.length >= BUF_MAX) {
              writer.appendChunk(buf.join("\n") + "\n");
              buf = [];
            }
          }
        }

        if (buf.length) {
          writer.appendChunk(buf.join("\n") + "\n");
        }
      }

      return totalOut;
    }

    // ----------------------------
    // RUN
    // ----------------------------
    var locationId = getLocationIdByName(locationName);
    if (!locationId) {
      log.error("ETA export failed", {
        reason: "Location not found",
        locationName: locationName,
      });
      return;
    }

    var inboundLoad = loadSupplyInboundByItem(locationId);
    var supplyByItem = inboundLoad.supplyByItem;

    var demandLoad = loadDemandByItem(locationId);
    var demandByItem = demandLoad.demandByItem;

    var onHandByItem = fetchOnHandByItem(locationId, demandLoad.itemIds);

    var etaName = "eta_all_lines.jsonl";
    var writer = createAppendWriter(etaName);

    var outRows = computeAndWriteAll(
      demandByItem,
      supplyByItem,
      onHandByItem,
      writer,
      locationId,
    );

    var etaFileId = writer.finalizeRename();

    var manifestName = "manifest_eta_all_lines_latest.json";
    var manifest = {
      generated_at: new Date().toISOString(),
      tag: tag,
      folder_id: folderId,
      location_id: locationId,
      location_name: locationName,

      counts: {
        sales_orders_scanned: demandLoad.soCount,
        so_lines_with_remaining_demand: demandLoad.lineCount,
        items_with_demand: demandLoad.itemIds.length,

        inbound_supported: inboundLoad.supported,
        inbound_rows: inboundLoad.count,

        output_rows: outRows,
      },

      notes: {
        demand_sort: "SO trandate ASC (oldest first), then soId, then line_seq",
        active_items_filter: "item.isinactive = 'F'",
        demand_remaining:
          "max(0, abs(TL.quantity) - abs(TL.quantityshiprecv)) with fallback if column blocked",
        supply_date_basis: "Inbound only: expecteddeliverydate",
        supply_remaining_inbound:
          "max(0, abs(quantityexpected) - abs(quantityreceived))",
        inbound_cols_used: inboundLoad.colsUsed,
      },

      files: {
        eta_all_lines: { id: etaFileId, name: etaName, rows: outRows },
      },
    };

    var mfId = createTempThenRename(
      manifestName,
      JSON.stringify(manifest),
      file.Type.JSON,
    );

    log.audit("ETA ALL export complete", {
      folderId: folderId,
      locationId: locationId,
      locationName: locationName,
      etaFileId: etaFileId,
      manifestFileId: mfId,
      outRows: outRows,
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
