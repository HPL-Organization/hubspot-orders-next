/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/file", "N/search", "N/log"], function (
  query,
  file,
  search,
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
    var folderId = 2279;
    var PAGE = 1000;

    function two(n) {
      return n < 10 ? "0" + n : "" + n;
    }

    function toBool(v) {
      if (v === true) return true;
      var s = String(v || "").toUpperCase();
      return s === "T";
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

    var soLines = [];
    var lineLines = [];
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

      var headersQ =
        "SELECT " +
        "  T.id AS soId, " +
        "  T.tranid AS tranId, " +
        "  T.trandate AS trandate, " +
        "  T.entity AS customerId, " +
        "  T.custbody_hpl_so_reference AS soReference, " +
        "  T.foreigntotal AS totalFx, " +
        "  T.shipcomplete AS shipComplete, " +
        "  T.terms AS termsId, " +
        "  T.cseg_nsps_so_class AS salesChannelId, " +
        "  T.custbody_hpl_hs_deal_name AS hubspotSoId, " +
        "  T.custbody_hpl_ordernote AS orderNote, " +
        "  T.custbody_hpl_giveaway AS giveaway, " +
        "  T.custbody_hpl_warranty AS warranty " +
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

      var h = query.runSuiteQL({ query: headersQ }).asMappedResults() || [];
      var l = query.runSuiteQL({ query: linesQ }).asMappedResults() || [];
      var st = query.runSuiteQL({ query: salesTeamQ }).asMappedResults() || [];
      var pt = query.runSuiteQL({ query: partnersQ }).asMappedResults() || [];

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
            total: totalFx,
            tax_total: null,
            customer_id: row.customerid != null ? Number(row.customerid) : null,
            netsuite_url: null,
            sales_rep: salesRepName,
            ship_address: null,
            so_reference: row.soreference || null,
            hubspot_so_id: row.hubspotsoid || null,
            sales_channel_id: salesChannelIdVal,
            affiliate_id: affiliateId,
            order_note: row.ordernote || null,
            ship_complete: shipCompleteBool,
            billing_terms_id: termsIdVal,
            sales_team: teamArr,
            partners: partnerArr,

            // NEW FIELDS
            custbody_hpl_giveaway: giveawayBool,
            custbody_hpl_warranty: warrantyBool,
          }) + "\n"
        );
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
            rate: Number(r2.rate || 0),
            amount: Number(r2.amountfx || 0),
            description: r2.description || null,
            comment: r2.linecomment || null,
            is_closed: isClosedFlag,
            fulfillment_status: null,
            ns_line_id: r2.nslineid != null ? Number(r2.nslineid) : null,
          }) + "\n"
        );
      }

      soCount += h.length;
      lineCount += l.length;
    }

    var soName = "sales_orders.jsonl";
    var lnName = "sales_order_lines.jsonl";

    var fSoId = createTempThenRename(
      soName,
      soLines.join(""),
      file.Type.PLAINTEXT
    );
    var fLnId = createTempThenRename(
      lnName,
      lineLines.join(""),
      file.Type.PLAINTEXT
    );

    var manifest = {
      generated_at: new Date().toISOString(),
      tag: tag,
      files: {
        sales_orders: { id: fSoId, name: soName, rows: soCount },
        sales_order_lines: { id: fLnId, name: lnName, rows: lineCount },
      },
    };

    createTempThenRename(
      "sales_orders_manifest_latest.json",
      JSON.stringify(manifest),
      file.Type.JSON
    );
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
