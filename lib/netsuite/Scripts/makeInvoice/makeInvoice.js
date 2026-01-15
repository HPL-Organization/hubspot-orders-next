/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/query", "N/error", "N/format"], function (
  record,
  query,
  error,
  format
) {
  function toNum(x) {
    var n = Number(x);
    return isFinite(n) ? n : null;
  }

  function looksLikeNoBillableLines(msg) {
    msg = String(msg || "").toLowerCase();
    return (
      msg.indexOf("line item") !== -1 ||
      (msg.indexOf("select") !== -1 &&
        msg.indexOf("line") !== -1 &&
        msg.indexOf("bill") !== -1) ||
      msg.indexOf("no line") !== -1 ||
      msg.indexOf("cannot be billed") !== -1
    );
  }

  function parseDateOverride(val) {
    if (!val) return null;

    if (val instanceof Date) return val;

    if (typeof val === "number") {
      var dnum = new Date(val);
      return isFinite(dnum.getTime()) ? dnum : null;
    }

    if (typeof val === "string") {
      var s = val.trim();
      if (!s) return null;

      // ISO: YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        var iso = new Date(s + "T00:00:00");
        return isFinite(iso.getTime()) ? iso : null;
      }

      // Account date format (e.g. 12/20/2025) — respects company preferences
      try {
        var d = format.parse({ value: s, type: format.Type.DATE });
        return d instanceof Date && isFinite(d.getTime()) ? d : null;
      } catch (e) {
        return null;
      }
    }

    return null;
  }

  function applyBodyOverrides(invRec, overrides) {
    if (!overrides || typeof overrides !== "object") return;

    Object.keys(overrides).forEach(function (fieldId) {
      var val = overrides[fieldId];

      try {
        var fid = String(fieldId || "").toLowerCase();

        if (fid === "trandate") {
          var d = parseDateOverride(val);
          if (d) {
            invRec.setValue({ fieldId: "trandate", value: d });
          }
          return;
        }

        invRec.setValue({ fieldId: fieldId, value: val });
      } catch (e) {
        // ignore unknown/unsettable fields to keep it resilient
      }
    });
  }

  function getBackorderFlagForSO(soId) {
    var rows =
      query
        .runSuiteQL({
          query:
            "SELECT MAX(CASE WHEN NVL(ABS(TL.quantitybackordered),0) > 0 THEN 1 ELSE 0 END) AS hasBackorder " +
            "FROM transactionline TL " +
            "WHERE TL.transaction = ? AND TL.mainline = 'F'",
          params: [Number(soId)],
        })
        .asMappedResults() || [];

    if (!rows.length) return false;
    return Number(rows[0].hasbackorder || 0) > 0;
  }

  function fetchInvoiceHeader(invoiceId) {
    var h =
      query
        .runSuiteQL({
          query:
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
            "WHERE T.type='CustInvc' AND T.id = ? " +
            "GROUP BY T.id, T.tranid, T.trandate, T.entity, T.custbody_hpl_so_reference, T.foreigntotal",
          params: [Number(invoiceId)],
        })
        .asMappedResults() || [];

    if (!h.length) return null;

    var row = h[0];
    var totalFx = Number(row.totalfx || 0);
    var taxFx = Number(row.taxtotalfx || 0);
    var remainingFx = Number(row.amountremainingfx || 0);
    var paidFx = Math.max(0, totalFx - remainingFx);

    return {
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
    };
  }

  function fetchInvoiceLines(invoiceId) {
    var l =
      query
        .runSuiteQL({
          query:
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
            "  TL.custcol_comment AS lineComment " +
            "FROM transactionline TL " +
            "JOIN item I ON I.id = TL.item " +
            "WHERE TL.transaction = ? " +
            "  AND TL.mainline='F' " +
            "  AND NVL(TL.accountinglinetype,'') <> 'Tax'",
          params: [Number(invoiceId)],
        })
        .asMappedResults() || [];

    var out = [];
    for (var j = 0; j < l.length; j++) {
      var r = l[j];
      out.push({
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
      });
    }
    return out;
  }

  function fetchInvoicePayments(invoiceId) {
    var p =
      query
        .runSuiteQL({
          query:
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
            "WHERE (P.type IN ('CustPymt','CustCred','DepAppl')) AND TL.createdfrom = ? " +
            "GROUP BY TL.createdfrom, P.id, P.tranid, P.trandate, BUILTIN.DF(P.status), BUILTIN.DF(P.paymentoption)",
          params: [Number(invoiceId)],
        })
        .asMappedResults() || [];

    var out = [];
    for (var k = 0; k < p.length; k++) {
      var pr = p[k];
      out.push({
        invoice_id: Number(pr.invoiceid),
        payment_id: Number(pr.paymentid),
        tran_id: pr.tranid || null,
        payment_date: pr.paymentdate || null,
        amount: Number(pr.amountfx || 0),
        status: pr.status || null,
        payment_option: pr.paymentoption || null,
      });
    }
    return out;
  }

  function post(body) {
    var salesOrderInternalId = body && body.salesOrderInternalId;
    var overrides = body && body.overrides;

    if (!salesOrderInternalId) {
      throw error.create({
        name: "MISSING_SO_ID",
        message: "Missing salesOrderInternalId",
        notifyOff: true,
      });
    }

    var soId = Number(salesOrderInternalId);
    if (!soId) {
      throw error.create({
        name: "INVALID_SO_ID",
        message: "salesOrderInternalId must be a number",
        notifyOff: true,
      });
    }

    var invoiceId;
    try {
      var invRec = record.transform({
        fromType: record.Type.SALES_ORDER,
        fromId: soId,
        toType: record.Type.INVOICE,
        isDynamic: true,
      });

      applyBodyOverrides(invRec, overrides);

      invoiceId = invRec.save({
        enableSourcing: true,
        ignoreMandatoryFields: false,
      });
    } catch (e) {
      var msg = String((e && e.message) || e || "");
      if (looksLikeNoBillableLines(msg)) {
        return {
          ok: false,
          status: 409,
          error:
            "No billable lines on the Sales Order (everything billed or lines closed).",
          details: msg,
        };
      }
      return {
        ok: false,
        status: 500,
        error: "Failed to transform Sales Order to Invoice",
        details: msg,
      };
    }

    var header = fetchInvoiceHeader(invoiceId);
    if (!header) {
      return {
        ok: false,
        status: 502,
        error: "Invoice created but could not read back header",
        invoiceInternalId: invoiceId,
      };
    }

    var soIdFromHeader = header.created_from_so_id || soId;
    var isBackordered = getBackorderFlagForSO(soIdFromHeader);

    return {
      ok: true,
      invoiceInternalId: invoiceId,
      invoice: Object.assign({}, header, { isBackordered: isBackordered }),
      invoice_lines: fetchInvoiceLines(invoiceId),
      invoice_payments: fetchInvoicePayments(invoiceId),
    };
  }

  return {
    post: post,
  };
});
