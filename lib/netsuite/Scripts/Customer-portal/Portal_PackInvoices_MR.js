/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/file", "N/search"], function (query, file, search) {
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

    function loadSoBackorderFlags(soIds) {
      var out = {};

      if (!soIds || !soIds.length) {
        return out;
      }

      var seen = {};
      var uniq = [];
      for (var i = 0; i < soIds.length; i++) {
        var id = Number(soIds[i]);
        if (!id || seen[id]) continue;
        seen[id] = true;
        uniq.push(id);
      }
      if (!uniq.length) return out;

      var csv = uniq.join(",");

      var soBackorderQ =
        "SELECT " +
        "  TL.transaction AS soId, " +
        "  MAX( " +
        "    CASE " +
        "      WHEN NVL(ABS(TL.quantitybackordered),0) > 0 " +
        "      THEN 1 ELSE 0 " +
        "    END " +
        "  ) AS hasBackorder " +
        "FROM transactionline TL " +
        "WHERE TL.transaction IN (" +
        csv +
        ") " +
        "  AND TL.mainline = 'F' " +
        "GROUP BY TL.transaction";

      var rows =
        query.runSuiteQL({ query: soBackorderQ }).asMappedResults() || [];

      for (var j = 0; j < rows.length; j++) {
        var r = rows[j];
        var soIdNum = Number(r.soid);
        var has = Number(r.hasbackorder || 0) > 0;
        if (soIdNum) {
          out[soIdNum] = has;
        }
      }

      return out;
    }

    var invLines = [],
      lineLines = [],
      payLines = [];
    var invCount = 0,
      lineCount = 0,
      payCount = 0;

    var lastId = 0;
    for (;;) {
      var ids =
        query
          .runSuiteQL({
            query:
              "SELECT T.id AS invoiceId " +
              "FROM transaction T " +
              "WHERE T.type='CustInvc' AND T.id > ? " +
              "ORDER BY T.id ASC " +
              "FETCH NEXT " +
              PAGE +
              " ROWS ONLY",
            params: [lastId],
          })
          .asMappedResults() || [];
      if (!ids.length) break;

      var idList = ids.map(function (r) {
        return Number(r.invoiceid);
      });
      lastId = idList[idList.length - 1];
      var csv = idList.join(",");

      var headersQ =
        "SELECT " +
        "  T.id AS invoiceId, " +
        "  T.tranid AS tranId, " +
        "  T.trandate AS trandate, " +
        "  T.entity AS customerId, " +
        "  T.custbody_hpl_so_reference AS soReference, " +
        "  T.foreigntotal AS totalFx, " +
        "  (SELECT TRIM(BUILTIN.DF(x.DestinationAddress)) " +
        "     FROM TransactionShipment x " +
        "     WHERE x.Doc = T.id " +
        "     ORDER BY x.id DESC " +
        "     FETCH NEXT 1 ROWS ONLY) AS shipToText, " +
        "  (SELECT y.salesRepName FROM ( " +
        "     SELECT BUILTIN.DF(ST.employee) AS salesRepName, " +
        "            ROW_NUMBER() OVER ( " +
        "               PARTITION BY ST.transaction " +
        "               ORDER BY CASE WHEN ST.isprimary='T' THEN 0 ELSE 1 END, NVL(ST.contribution,0) DESC " +
        "            ) AS rn " +
        "     FROM TransactionSalesTeam ST WHERE ST.transaction=T.id " +
        "  ) y WHERE y.rn=1) AS salesRepName, " +
        "  SUM(CASE " +
        "        WHEN (NVL(TL.accountinglinetype,'')='Tax' OR NVL(TL.taxline,'F')='T') " +
        "        THEN NVL(ABS(TL.foreignamount),0) ELSE 0 END) AS taxTotalFx, " +
        "  NVL(MAX(CASE WHEN TL.mainline='T' THEN TL.foreignamountunpaid END),0) AS amountRemainingFx, " +
        "  (SELECT PTL.PreviousDoc " +
        "     FROM PreviousTransactionLink PTL " +
        "     JOIN transaction S ON S.id = PTL.PreviousDoc " +
        "     WHERE PTL.NextDoc = T.id AND S.type='SalesOrd' " +
        "     ORDER BY PTL.PreviousDoc DESC " +
        "     FETCH NEXT 1 ROWS ONLY) AS soId, " +
        "  (SELECT S.tranid " +
        "     FROM PreviousTransactionLink PTL " +
        "     JOIN transaction S ON S.id = PTL.PreviousDoc " +
        "     WHERE PTL.NextDoc = T.id AND S.type='SalesOrd' " +
        "     ORDER BY PTL.PreviousDoc DESC " +
        "     FETCH NEXT 1 ROWS ONLY) AS soTranId " +
        "FROM transaction T " +
        "JOIN transactionline TL ON TL.transaction = T.id " +
        "WHERE T.type='CustInvc' AND T.id IN (" +
        csv +
        ") " +
        "GROUP BY T.id, T.tranid, T.trandate, T.entity, T.custbody_hpl_so_reference, T.foreigntotal";

      var linesQ =
        "SELECT " +
        "  TL.transaction AS invoiceId, " +
        "  TL.linesequencenumber AS lineNo, " +
        "  I.id AS itemId, " +
        "  I.itemid AS sku, " +
        "  I.displayname AS displayName, " +
        "  NVL(ABS(TL.quantity),0) AS quantity, " +
        "  NVL(TL.rate,0) AS rate, " +
        "  ABS(NVL(TL.foreignamount,0)) AS amountFx, " +
        "  TL.memo AS description, " +
        "  TL.custcol_hpl_comment AS lineComment " +
        "FROM transactionline TL " +
        "JOIN item I ON I.id = TL.item " +
        "WHERE TL.transaction IN (" +
        csv +
        ") " +
        "  AND TL.mainline='F' " +
        "  AND NVL(TL.accountinglinetype,'') <> 'Tax'";

      var paymentsQ =
        "SELECT " +
        "  TL.createdfrom AS invoiceId, " +
        "  P.id AS paymentId, " +
        "  P.tranid AS tranId, " +
        "  P.trandate AS paymentDate, " +
        "  BUILTIN.DF(P.status) AS status, " +
        "  BUILTIN.DF(P.paymentoption) AS paymentOption, " +
        "  SUM(ABS(NVL(TL.foreignamount,0))) AS amountFx " +
        "FROM transaction P " +
        "JOIN transactionline TL ON TL.transaction = P.id " +
        "WHERE (P.type IN ('CustPymt','CustCred','DepAppl')) AND TL.createdfrom IN (" +
        csv +
        ") " +
        "GROUP BY TL.createdfrom, P.id, P.tranid, P.trandate, BUILTIN.DF(P.status), BUILTIN.DF(P.paymentoption)";

      var h = query.runSuiteQL({ query: headersQ }).asMappedResults() || [];
      var l = query.runSuiteQL({ query: linesQ }).asMappedResults() || [];
      var p = query.runSuiteQL({ query: paymentsQ }).asMappedResults() || [];

      var soIdsForBatch = [];
      for (var s = 0; s < h.length; s++) {
        var soIdVal = h[s].soid;
        if (soIdVal != null && soIdVal !== "") {
          soIdsForBatch.push(Number(soIdVal));
        }
      }

      var soBackorderMap = loadSoBackorderFlags(soIdsForBatch);

      for (var i = 0; i < h.length; i++) {
        var row = h[i];

        var totalFx = Number(row.totalfx || 0);
        var taxFx = Number(row.taxtotalfx || 0);
        var remainingFx = Number(row.amountremainingfx || 0);
        var paidFx = Math.max(0, totalFx - remainingFx);

        var soIdNum = row.soid != null ? Number(row.soid) : null;
        var isBackordered = false;
        if (soIdNum && soBackorderMap.hasOwnProperty(soIdNum)) {
          isBackordered = !!soBackorderMap[soIdNum];
        }

        invLines.push(
          JSON.stringify({
            invoice_id: Number(row.invoiceid),
            tran_id: row.tranid || null,
            trandate: row.trandate || null,
            total: totalFx,
            tax_total: taxFx,
            amount_paid: paidFx,
            amount_remaining: remainingFx,
            customer_id: row.customerid != null ? Number(row.customerid) : null,
            sales_rep: row.salesrepname || null,
            ship_address: row.shiptotext || null,
            so_reference: row.soreference || null,
            created_from_so_id: row.soid != null ? Number(row.soid) : null,
            created_from_so_tranid: row.sotranid || null,
            isBackordered: isBackordered,
          }) + "\n"
        );
      }

      for (var j = 0; j < l.length; j++) {
        var r = l[j];
        lineLines.push(
          JSON.stringify({
            invoice_id: Number(r.invoiceid),
            line_no: Number(r.lineno || r.linesequencenumber || 0),
            item_id: r.itemid != null ? Number(r.itemid) : null,
            item_sku: r.sku || null,
            item_display_name: r.displayname || r.sku || null,
            quantity: Number(r.quantity || 0),
            rate: Number(r.rate || 0),
            amount: Number(r.amountfx || 0),
            description: r.description || null,
            comment: r.linecomment || null,
          }) + "\n"
        );
      }

      for (var k = 0; k < p.length; k++) {
        var pr = p[k];
        payLines.push(
          JSON.stringify({
            invoice_id: Number(pr.invoiceid),
            payment_id: Number(pr.paymentid),
            tran_id: pr.tranid || null,
            payment_date: pr.paymentdate || null,
            amount: Number(pr.amountfx || 0),
            status: pr.status || null,
            payment_option: pr.paymentoption || null,
          }) + "\n"
        );
      }

      invCount += h.length;
      lineCount += l.length;
      payCount += p.length;
    }

    var invName = "invoices.jsonl";
    var lnName = "invoice_lines.jsonl";
    var payName = "invoice_payments.jsonl";

    var fInvId = createTempThenRename(
      invName,
      invLines.join(""),
      file.Type.PLAINTEXT
    );
    var fLnId = createTempThenRename(
      lnName,
      lineLines.join(""),
      file.Type.PLAINTEXT
    );
    var fPayId = createTempThenRename(
      payName,
      payLines.join(""),
      file.Type.PLAINTEXT
    );

    var manifest = {
      generated_at: new Date().toISOString(),
      files: {
        invoices: { id: fInvId, name: invName, rows: invCount },
        invoice_lines: { id: fLnId, name: lnName, rows: lineCount },
        invoice_payments: { id: fPayId, name: payName, rows: payCount },
      },
    };
    createTempThenRename(
      "manifest_latest.json",
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
