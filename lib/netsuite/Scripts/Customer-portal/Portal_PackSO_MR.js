/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
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

  function map(context) {
    context.write({ key: "RUN", value: "RUN" });
  }

  function reduce(context) {}

  function summarize(summary) {
    var TARGET_SO = 992721;

    var folderId = Number(
      runtime.getCurrentScript().getParameter({
        name: "custscript_exports_folder_id",
      }) || 2279,
    );

    var PAGE = 1000;
    var MAX_BYTES = 9.5 * 1024 * 1024;

    function two(n) {
      return n < 10 ? "0" + n : "" + n;
    }

    function toBool(v) {
      if (v === true) return true;
      var s = String(v || "").toUpperCase();
      return s === "T";
    }

    function pad4(n) {
      n = String(n);
      while (n.length < 4) n = "0" + n;
      return n;
    }

    function byteLen(str) {
      return String(str || "").length;
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

      var finalId = file
        .create({
          name: finalName,
          fileType: fileType,
          contents: contents,
          folder: folderId,
        })
        .save();

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

    function deleteParts(prefix) {
      var s = search.create({
        type: "file",
        filters: [
          ["folder", "anyof", String(folderId)],
          "AND",
          ["name", "startswith", prefix + "_"],
        ],
        columns: ["internalid", "name"],
      });
      s.run().each(function (res) {
        try {
          file["delete"]({ id: Number(res.getValue("internalid")) });
        } catch (e) {}
        return true;
      });
    }

    function writeJsonlParts(prefix, linesArr) {
      deleteParts(prefix);

      var partNo = 1;
      var buf = [];
      var bufBytes = 0;
      var parts = [];

      function flush() {
        if (!buf.length) return;
        var name = prefix + "_" + pad4(partNo) + ".jsonl";
        var id = createTempThenRename(name, buf.join(""), file.Type.PLAINTEXT);
        parts.push({ id: id, name: name, rows: buf.length });
        partNo++;
        buf = [];
        bufBytes = 0;
      }

      for (var i = 0; i < linesArr.length; i++) {
        var line = linesArr[i];
        var b = byteLen(line);

        if (buf.length && bufBytes + b > MAX_BYTES) flush();

        buf.push(line);
        bufBytes += b;
      }

      flush();
      return parts;
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

    var soLines = [];
    var lineLines = [];
    var linkLines = [];
    var soCount = 0;
    var lineCount = 0;
    var linkCount = 0;

    var targetSeenInIdPage = false;
    var targetSeenInHeaders = false;
    var targetSeenInLinks = false;

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

      var idList = ids
        .map(function (r) {
          return Number(r.soid);
        })
        .filter(function (n) {
          return !!n;
        });
      if (!idList.length) break;

      if (idList.indexOf(TARGET_SO) !== -1) {
        targetSeenInIdPage = true;
        log.audit("TARGET SO FOUND IN ID PAGE", {
          targetSo: TARGET_SO,
          firstId: idList[0],
          lastId: idList[idList.length - 1],
          pageSize: idList.length,
        });
      }

      lastId = idList[idList.length - 1];
      var csv = idList.join(",");

      var headersQ =
        "SELECT " +
        "  T.id AS soId, " +
        "  T.tranid AS tranId, " +
        "  T.trandate AS trandate, " +
        "  T.entity AS customerId, " +
        "  T.custbody_hpl_so_reference AS soReference, " +
        "  T.foreigntotal AS totalFx, " +
        "  T.shipcomplete AS shipComplete, " +
        "  T.shipcarrier AS shipCarrier, " +
        "  T.terms AS termsId, " +
        "  T.cseg_nsps_so_class AS salesChannelId, " +
        "  T.custbody_hpl_ordernote AS orderNote, " +
        "  T.custbody_hpl_hold_till AS holdTill, " +
        "  T.custbody_hpl_giveaway AS giveaway, " +
        "  T.custbody_hpl_warranty AS warranty, " +
        "  BUILTIN.DF(T.status) AS status " +
        "FROM transaction T " +
        "WHERE T.type='SalesOrd' AND T.id IN (" +
        csv +
        ")";

      var linesQ =
        "SELECT " +
        "  TL.transaction AS soId, " +
        "  TL.linesequencenumber AS lineNo, " +
        "  I.id AS itemId, " +
        "  I.itemid AS sku, " +
        "  I.displayname AS displayName, " +
        "  NVL(ABS(TL.quantity),0) AS quantity, " +
        "  NVL(ABS(TL.quantitycommitted),0) AS quantityCommitted, " +
        "  NVL(TL.rate,0) AS rate, " +
        "  ABS(NVL(TL.foreignamount,0)) AS amountFx, " +
        "  TL.memo AS description, " +
        "  TL.custcol_comment AS lineComment, " +
        "  TL.id AS nsLineId, " +
        "  TL.isclosed AS isClosed " +
        "FROM transactionline TL " +
        "JOIN item I ON I.id = TL.item " +
        "WHERE TL.transaction IN (" +
        csv +
        ") " +
        "  AND TL.mainline='F' " +
        "  AND NVL(TL.accountinglinetype,'') <> 'Tax'";

      var salesTeamQ =
        "SELECT " +
        "  ST.transaction AS soId, " +
        "  ST.employee AS employeeId, " +
        "  BUILTIN.DF(ST.employee) AS employeeName, " +
        "  ST.isprimary AS isPrimary, " +
        "  ST.contribution AS contribution " +
        "FROM TransactionSalesTeam ST " +
        "WHERE ST.transaction IN (" +
        csv +
        ")";

      var partnersQ =
        "SELECT " +
        "  P.transaction AS soId, " +
        "  P.partner AS partnerId, " +
        "  BUILTIN.DF(P.partner) AS partnerName, " +
        "  P.isprimary AS isPrimary, " +
        "  P.contribution AS contribution " +
        "FROM TransactionPartner P " +
        "WHERE P.transaction IN (" +
        csv +
        ")";

      var linksQ =
        "SELECT DISTINCT " +
        "  PTLL.PreviousDoc AS soId, " +
        "  PTLL.PreviousLine AS soNsLineId, " +
        "  PTLL.NextDoc AS invoiceId, " +
        "  PTLL.NextLine AS invoiceNsLineId " +
        "FROM PreviousTransactionLineLink PTLL " +
        "WHERE PTLL.PreviousType = 'SalesOrd' " +
        "  AND PTLL.NextType = 'CustInvc' " +
        "  AND PTLL.PreviousDoc IN (" +
        csv +
        ")";

      var h = query.runSuiteQL({ query: headersQ }).asMappedResults() || [];
      var l = query.runSuiteQL({ query: linesQ }).asMappedResults() || [];
      var st = query.runSuiteQL({ query: salesTeamQ }).asMappedResults() || [];
      var pt = query.runSuiteQL({ query: partnersQ }).asMappedResults() || [];
      var lk = query.runSuiteQL({ query: linksQ }).asMappedResults() || [];

      for (var a = 0; a < h.length; a++) {
        if (Number(h[a].soid) === TARGET_SO) {
          targetSeenInHeaders = true;
          log.audit("TARGET SO FOUND IN HEADERS", h[a]);
        }
      }

      for (var b = 0; b < lk.length; b++) {
        if (Number(lk[b].soid) === TARGET_SO) {
          targetSeenInLinks = true;
          log.audit("TARGET SO FOUND IN LINKS QUERY", lk[b]);
        }
      }

      var salesTeamBySo = {};
      for (var t = 0; t < st.length; t++) {
        var r = st[t];
        var soIdNum = Number(r.soid);
        if (!soIdNum) continue;
        if (!salesTeamBySo[soIdNum]) salesTeamBySo[soIdNum] = [];
        var contribNum =
          r.contribution != null && r.contribution !== ""
            ? Number(r.contribution)
            : null;
        var isPrim =
          String(r.isprimary || "").toUpperCase() === "T" ? true : false;
        salesTeamBySo[soIdNum].push({
          employee_id:
            r.employeeid != null && r.employeeid !== ""
              ? String(r.employeeid)
              : null,
          employee_name: r.employeename || null,
          is_primary: isPrim,
          contribution: contribNum,
        });
      }

      var partnersBySo = {};
      for (var u = 0; u < pt.length; u++) {
        var pr = pt[u];
        var soIdNum2 = Number(pr.soid);
        if (!soIdNum2) continue;
        if (!partnersBySo[soIdNum2]) partnersBySo[soIdNum2] = [];
        var pContribNum =
          pr.contribution != null && pr.contribution !== ""
            ? Number(pr.contribution)
            : null;
        var pIsPrim =
          String(pr.isprimary || "").toUpperCase() === "T" ? true : false;
        partnersBySo[soIdNum2].push({
          partner_id:
            pr.partnerid != null && pr.partnerid !== ""
              ? String(pr.partnerid)
              : null,
          partner_name: pr.partnername || null,
          is_primary: pIsPrim,
          contribution: pContribNum,
        });
      }

      for (var i = 0; i < h.length; i++) {
        var row = h[i];
        var totalFx = Number(row.totalfx || 0);
        var shipCompleteVal = String(row.shipcomplete || "").toUpperCase();
        var shipCompleteBool = shipCompleteVal === "T";
        var holdTillVal = row.holdtill || row.holdTill || null;

        var termsIdVal =
          row.termsid != null && row.termsid !== ""
            ? String(row.termsid)
            : null;

        var salesChannelIdVal =
          row.saleschannelid != null && row.saleschannelid !== ""
            ? String(row.saleschannelid)
            : null;

        var giveawayBool = toBool(row.giveaway);
        var warrantyBool = toBool(row.warranty);

        var thisSoId = Number(row.soid);
        var teamArr = salesTeamBySo[thisSoId] || [];
        var primaryRep = null;
        for (var p = 0; p < teamArr.length; p++) {
          if (teamArr[p].is_primary) {
            primaryRep = teamArr[p];
            break;
          }
        }
        if (!primaryRep && teamArr.length) {
          primaryRep = teamArr[0];
        }
        var salesRepName = primaryRep ? primaryRep.employee_name : null;

        var partnerArr = partnersBySo[thisSoId] || [];
        var primaryPartner = null;
        for (var q = 0; q < partnerArr.length; q++) {
          if (partnerArr[q].is_primary) {
            primaryPartner = partnerArr[q];
            break;
          }
        }
        if (!primaryPartner && partnerArr.length) {
          primaryPartner = partnerArr[0];
        }
        var affiliateId =
          primaryPartner && primaryPartner.partner_id
            ? primaryPartner.partner_id
            : null;

        soLines.push(
          JSON.stringify({
            so_id: thisSoId,
            tran_id: row.tranid || null,
            trandate: row.trandate || null,
            status: row.status || null,
            total: totalFx,
            tax_total: null,
            customer_id: row.customerid != null ? Number(row.customerid) : null,
            netsuite_url: null,
            sales_rep: salesRepName,
            ship_address: null,
            ship_carrier: row.shipcarrier || null,
            so_reference: row.soreference || null,
            hubspot_so_id: row.hubspotsoid || null,
            sales_channel_id: salesChannelIdVal,
            affiliate_id: affiliateId,
            order_note: row.ordernote || null,
            hold_till: holdTillVal,
            ship_complete: shipCompleteBool,
            billing_terms_id: termsIdVal,
            sales_team: teamArr,
            partners: partnerArr,
            custbody_hpl_giveaway: giveawayBool,
            custbody_hpl_warranty: warrantyBool,
          }) + "\n",
        );
        soCount++;
      }

      for (var j = 0; j < l.length; j++) {
        var r2 = l[j];

        var isClosedFlag =
          String(r2.isclosed || "").toUpperCase() === "T" ? true : false;

        lineLines.push(
          JSON.stringify({
            so_id: Number(r2.soid),
            line_no: Number(r2.lineno || r2.linesequencenumber || 0),
            item_id: r2.itemid != null ? Number(r2.itemid) : null,
            item_sku: r2.sku || null,
            item_display_name: r2.displayname || r2.sku || null,
            quantity: Number(r2.quantity || 0),
            quantity_committed: Number(r2.quantitycommitted || 0),
            rate: Number(r2.rate || 0),
            amount: Number(r2.amountfx || 0),
            description: r2.description || null,
            comment: r2.linecomment || null,
            is_closed: isClosedFlag,
            fulfillment_status: null,
            ns_line_id: r2.nslineid != null ? Number(r2.nslineid) : null,
          }) + "\n",
        );
        lineCount++;
      }

      for (var k = 0; k < lk.length; k++) {
        var rl = lk[k];
        var line =
          JSON.stringify({
            so_id: rl.soid != null ? Number(rl.soid) : null,
            so_ns_line_id: rl.sonslineid != null ? Number(rl.sonslineid) : null,
            invoice_id: rl.invoiceid != null ? Number(rl.invoiceid) : null,
            invoice_ns_line_id:
              rl.invoicenslineid != null ? Number(rl.invoicenslineid) : null,
          }) + "\n";

        linkLines.push(line);
        linkCount++;
      }
    }

    log.audit("TARGET SO SUMMARY", {
      targetSo: TARGET_SO,
      seenInIdPage: targetSeenInIdPage,
      seenInHeaders: targetSeenInHeaders,
      seenInLinks: targetSeenInLinks,
    });

    var soParts = writeJsonlParts("sales_orders", soLines);
    var lineParts = writeJsonlParts("sales_order_lines", lineLines);
    var linkParts = writeJsonlParts(
      "sales_order_invoice_line_links",
      linkLines,
    );

    var manifest = {
      generated_at: new Date().toISOString(),
      tag: tag,
      folder_id: folderId,
      files: {
        sales_orders: {
          total_rows: soCount,
          parts: soParts,
        },
        sales_order_lines: {
          total_rows: lineCount,
          parts: lineParts,
        },
        sales_order_invoice_line_links: {
          total_rows: linkCount,
          parts: linkParts,
        },
      },
    };

    createTempThenRename(
      "sales_orders_manifest_latest.json",
      JSON.stringify(manifest),
      file.Type.JSON,
    );

    log.audit("Sales order export complete (multipart)", {
      folderId: folderId,
      salesOrders: soCount,
      salesOrderLines: lineCount,
      salesOrderInvoiceLineLinks: linkCount,
      salesOrderParts: soParts.length,
      salesOrderLineParts: lineParts.length,
      salesOrderInvoiceLineLinkParts: linkParts.length,
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
