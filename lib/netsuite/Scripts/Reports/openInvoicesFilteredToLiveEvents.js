/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/query",
  "N/url",
  "N/log",
  "N/runtime",
  "N/render",
], function (serverWidget, query, url, log, runtime, render) {
  function runSuiteQL(sql, params) {
    return (
      query
        .runSuiteQL({ query: sql, params: params || [] })
        .asMappedResults() || []
    );
  }

  function findRows(customerId) {
    var whereCustomer = "";
    var params = [];

    if (customerId) {
      whereCustomer = " AND o.entity = ? ";
      params.push(Number(customerId));
    }

    var sql = `
      WITH so AS (
        SELECT
          o.id AS so_id,
          o.tranid AS so_number,
          o.trandate AS so_trandate,
          o.entity AS customer_id,
          COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,
          o.custbody_hpl_so_reference AS so_reference,
          BUILTIN.DF(o.cseg_nsps_so_class) AS sales_channel,
          SUM(CASE
                WHEN l.itemtype IN ('InvtPart','Assembly','Kit')
                 AND NVL(l.assemblycomponent,'F') = 'F'
                 AND NVL(l.kitcomponent,'F') = 'F'
                THEN ABS(NVL(l.quantity,0))
                ELSE 0
              END) AS inv_qty,
          SUM(CASE
                WHEN l.itemtype IN ('InvtPart','Assembly','Kit')
                 AND NVL(l.assemblycomponent,'F') = 'F'
                 AND NVL(l.kitcomponent,'F') = 'F'
                THEN ABS(NVL(l.quantitycommitted,0))
                ELSE 0
              END) AS inv_committed,
          SUM(CASE
                WHEN l.itemtype IN ('InvtPart','Assembly','Kit')
                 AND NVL(l.assemblycomponent,'F') = 'F'
                 AND NVL(l.kitcomponent,'F') = 'F'
                THEN ABS(NVL(l.quantitybackordered,0))
                ELSE 0
              END) AS inv_backordered
        FROM transaction o
        JOIN transactionline l ON l.transaction = o.id
        JOIN customer c ON c.id = o.entity
        WHERE o.type = 'SalesOrd'
          AND NVL(l.isclosed,'F') = 'F'
          ${whereCustomer}
        GROUP BY
          o.id, o.tranid, o.trandate, o.entity,
          COALESCE(c.companyname, c.fullname, c.altname),
          o.custbody_hpl_so_reference,
          BUILTIN.DF(o.cseg_nsps_so_class)
        HAVING
          SUM(CASE
                WHEN l.itemtype IN ('InvtPart','Assembly','Kit')
                 AND NVL(l.assemblycomponent,'F') = 'F'
                 AND NVL(l.kitcomponent,'F') = 'F'
                THEN ABS(NVL(l.quantitycommitted,0))
                ELSE 0
              END)
          >=
          SUM(CASE
                WHEN l.itemtype IN ('InvtPart','Assembly','Kit')
                 AND NVL(l.assemblycomponent,'F') = 'F'
                 AND NVL(l.kitcomponent,'F') = 'F'
                THEN ABS(NVL(l.quantity,0))
                ELSE 0
              END)
      ),
      so_inv AS (
        SELECT DISTINCT
          nt.previousdoc AS so_id,
          nt.nextdoc     AS invoice_id
        FROM nexttransactionlinelink nt
        WHERE nt.previoustype = 'SalesOrd'
          AND nt.nexttype     = 'CustInvc'
      ),
      inv AS (
        SELECT
          i.id AS invoice_id,
          i.tranid AS invoice_number,
          i.entity AS invoice_customer_id,
          (NVL(i.foreigntotal,0) - NVL(i.foreignamountpaid,0)) AS balance
        FROM transaction i
        WHERE i.type = 'CustInvc'
          AND (NVL(i.foreigntotal,0) - NVL(i.foreignamountpaid,0)) > 0
      ),
      overpayment AS (
        SELECT
          t.entity AS customer_id,
          SUM(t.foreignpaymentamountunused) AS credit_or_deposit_amount
        FROM transaction t
        WHERE t.type IN ('CustDep','CustCred')
          AND BUILTIN.CF(t.status) IN ('CustDep:B','CustCred:A')
          AND t.foreignpaymentamountunused > 0
        GROUP BY t.entity
      )
      SELECT
        inv.invoice_id,
        inv.invoice_number,
        so.so_id,
        so.so_number,
        so.so_trandate,
        so.customer_id,
        so.customer_name,
        so.so_reference,
        so.sales_channel,
        inv.balance,
        NVL(op.credit_or_deposit_amount, 0) AS credit_or_deposit_amount,
        so.inv_qty,
        so.inv_committed,
        so.inv_backordered
      FROM so
      JOIN so_inv ON so_inv.so_id = so.so_id
      JOIN inv    ON inv.invoice_id = so_inv.invoice_id
      LEFT JOIN overpayment op ON op.customer_id = so.customer_id
      WHERE (so.sales_channel LIKE 'Live Event%' OR so.sales_channel LIKE 'Live Events%')
      ORDER BY inv.invoice_id
    `;

    return runSuiteQL(sql, params);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeXml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeFileName(s) {
    return (
      String(s || "export")
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .slice(0, 80) || "export"
    );
  }

  function suiteletLink(extraParams) {
    var params = extraParams || {};
    return url.resolveScript({
      scriptId: runtime.getCurrentScript().id,
      deploymentId: runtime.getCurrentScript().deploymentId,
      returnExternalUrl: false,
      params: params,
    });
  }

  function money(v) {
    var n = Number(v || 0);
    if (!isFinite(n)) n = 0;
    return n.toFixed(2);
  }

  function csvEscape(v) {
    var s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toPdfXml(opts) {
    var rows = opts.rows || [];
    var customerName = opts.customerName || "";
    var customerId = opts.customerId || "";
    var totalRows = rows.length;

    var title = "Qualified Invoices (Live Event | Fully Committed)";
    var subtitle =
      (customerId
        ? "Customer: " + customerName + " (ID " + customerId + ")"
        : "Customer: All") +
      " | Rows: " +
      totalRows;

    var tableRows = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      tableRows +=
        "<tr>" +
        "<td>" +
        escapeXml(r.invoice_number) +
        "</td>" +
        "<td>" +
        escapeXml(r.so_number) +
        "</td>" +
        "<td>" +
        escapeXml(r.customer_name) +
        "</td>" +
        "<td align='right'>" +
        escapeXml(money(r.balance)) +
        "</td>" +
        "<td align='right'>" +
        escapeXml(money(r.credit_or_deposit_amount)) +
        "</td>" +
        "<td align='right'>" +
        escapeXml(String(Number(r.inv_qty || 0))) +
        "</td>" +
        "<td align='right'>" +
        escapeXml(String(Number(r.inv_committed || 0))) +
        "</td>" +
        "<td align='right'>" +
        escapeXml(String(Number(r.inv_backordered || 0))) +
        "</td>" +
        "</tr>";
    }

    if (!tableRows) {
      tableRows =
        "<tr><td colspan='8' align='center' padding='10'>No results.</td></tr>";
    }

    return (
      "<?xml version='1.0'?>\n" +
      "<!DOCTYPE pdf PUBLIC '-//big.faceless.org//report' 'report-1.1.dtd'>\n" +
      "<pdf>\n" +
      "  <head>\n" +
      "    <style type='text/css'>\n" +
      "      * { font-family: Helvetica, sans-serif; }\n" +
      "      .h1 { font-size: 16pt; font-weight: bold; }\n" +
      "      .sub { font-size: 10pt; color: #444; margin-top: 4px; }\n" +
      "      .meta { font-size: 9pt; color: #666; margin-top: 2px; }\n" +
      "      table { width: 100%; border-collapse: collapse; margin-top: 12px; }\n" +
      "      th { background-color: #f2f2f2; font-size: 9pt; padding: 6px; border: 1px solid #ddd; }\n" +
      "      td { font-size: 9pt; padding: 6px; border: 1px solid #ddd; }\n" +
      "    </style>\n" +
      "  </head>\n" +
      "  <body>\n" +
      "    <div class='h1'>" +
      escapeXml(title) +
      "</div>\n" +
      "    <div class='sub'>" +
      escapeXml(subtitle) +
      "</div>\n" +
      "    <div class='meta'>Generated: " +
      escapeXml(new Date().toISOString()) +
      "</div>\n" +
      "    <table>\n" +
      "      <thead>\n" +
      "        <tr>\n" +
      "          <th>Invoice #</th>\n" +
      "          <th>SO #</th>\n" +
      "          <th>Customer</th>\n" +
      "          <th align='right'>Balance</th>\n" +
      "          <th align='right'>Credit/Deposit</th>\n" +
      "          <th align='right'>Inv Qty</th>\n" +
      "          <th align='right'>Committed</th>\n" +
      "          <th align='right'>Backordered</th>\n" +
      "        </tr>\n" +
      "      </thead>\n" +
      "      <tbody>\n" +
      tableRows +
      "      </tbody>\n" +
      "    </table>\n" +
      "  </body>\n" +
      "</pdf>"
    );
  }

  function downloadPdf(ctx, customerId) {
    var rows = findRows(customerId);
    var customerName = "";
    if (customerId && rows.length && rows[0].customer_name)
      customerName = rows[0].customer_name;
    if (customerId && !customerName) customerName = "Customer #" + customerId;

    var xml = toPdfXml({
      rows: rows,
      customerId: customerId,
      customerName: customerName,
    });

    var pdfFile = render.xmlToPdf({ xmlString: xml });
    var fname =
      "open_invoices_live_event_" + safeFileName(customerId || "all") + ".pdf";
    pdfFile.name = fname;

    ctx.response.writeFile({
      file: pdfFile,
      isInline: false,
    });
  }

  function downloadCsv(ctx, customerId) {
    var rows = findRows(customerId);
    var header = [
      "Invoice #",
      "SO #",
      "SO Date",
      "Customer",
      "SO Reference",
      "Sales Channel",
      "Balance",
      "Credit/Deposit",
      "Inv Qty",
      "Inv Committed",
      "Inv Backordered",
    ].join(",");

    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push(
        [
          csvEscape(r.invoice_number || ""),
          csvEscape(r.so_number || ""),
          csvEscape(r.so_trandate || ""),
          csvEscape(r.customer_name || ""),
          csvEscape(r.so_reference || ""),
          csvEscape(r.sales_channel || ""),
          csvEscape(money(r.balance)),
          csvEscape(money(r.credit_or_deposit_amount)),
          csvEscape(String(Number(r.inv_qty || 0))),
          csvEscape(String(Number(r.inv_committed || 0))),
          csvEscape(String(Number(r.inv_backordered || 0))),
        ].join(",")
      );
    }

    var csv = [header].concat(lines).join("\n");
    var fname =
      "open_invoices_live_event_" + safeFileName(customerId || "all") + ".csv";

    ctx.response.setHeader({
      name: "Content-Type",
      value: "text/csv; charset=utf-8",
    });
    ctx.response.setHeader({
      name: "Content-Disposition",
      value: 'attachment; filename="' + fname + '"',
    });
    ctx.response.write(csv);
  }

  function buildTop3Customers(rows) {
    var byCustomer = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var id = String(r.customer_id || "");
      if (!id) continue;
      if (!byCustomer[id]) {
        byCustomer[id] = {
          name: r.customer_name || "Customer #" + id,
          count: 0,
        };
      }
      byCustomer[id].count++;
    }

    var list = Object.keys(byCustomer).map(function (id) {
      return {
        customer_id: id,
        name: byCustomer[id].name,
        count: byCustomer[id].count,
      };
    });

    list.sort(function (a, b) {
      return b.count - a.count || String(a.name).localeCompare(String(b.name));
    });

    return {
      totalDistinctCustomers: Object.keys(byCustomer).length,
      top3: list.slice(0, 3),
    };
  }

  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    var action = String(ctx.request.parameters.action || "")
      .trim()
      .toLowerCase();

    var customerId = String(
      ctx.request.parameters.custpage_customer || ""
    ).trim();

    if (action === "pdf") {
      downloadPdf(ctx, customerId);
      return;
    }

    if (action === "csv") {
      downloadCsv(ctx, customerId);
      return;
    }

    var form = serverWidget.createForm({
      title:
        "Open Invoices (Balance Due) | Live Event* | Inventory Fully Committed (Non-Inv allowed)",
    });

    var customerFld = form.addField({
      id: "custpage_customer",
      type: serverWidget.FieldType.SELECT,
      label: "Customer",
      source: "customer",
    });
    customerFld.isMandatory = false;
    if (customerId) customerFld.defaultValue = customerId;

    form.addSubmitButton({ label: "Filter" });

    var rows = findRows(customerId);
    log.debug({ title: "Rows", details: rows.length });

    var stats = buildTop3Customers(rows);

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    var top3Html = "";
    if (stats.top3.length) {
      top3Html +=
        '<div style="margin-top:8px;font-size:13px;font-weight:600;">Top 3 Customers (by rows)</div>';
      top3Html +=
        '<ol style="margin:6px 0 0 18px;padding:0;font-size:13px;line-height:1.5;font-weight:500;">';
      for (var t = 0; t < stats.top3.length; t++) {
        top3Html +=
          "<li>" +
          escapeHtml(stats.top3[t].name) +
          ' <span style="opacity:.85;font-weight:700;">(' +
          Number(stats.top3[t].count) +
          " rows)</span></li>";
      }
      top3Html += "</ol>";
    } else {
      top3Html +=
        '<div style="margin-top:8px;font-size:13px;font-weight:600;opacity:.9;">Top 3 Customers: N/A</div>';
    }

    var pdfUrl = suiteletLink({
      action: "pdf",
      custpage_customer: customerId || "",
    });

    var csvUrl = suiteletLink({
      action: "csv",
      custpage_customer: customerId || "",
    });

    summary.defaultValue =
      '<div style="margin:6px 0 14px;padding:12px 14px;border-radius:10px;' +
      "background:#111827;color:#fff;font-size:16px;line-height:1.4;font-weight:700;" +
      'box-shadow:0 4px 10px rgba(0,0,0,0.15)">' +
      "<div>Total Rows: " +
      rows.length +
      "</div>" +
      '<div style="margin-top:4px;font-size:14px;font-weight:700;opacity:.95;">Total Customers: ' +
      Number(stats.totalDistinctCustomers) +
      "</div>" +
      top3Html +
      '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">' +
      (pdfUrl
        ? '<a href="' +
          escapeHtml(pdfUrl) +
          '" style="display:inline-block;padding:10px 12px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-size:13px;font-weight:800;">Export PDF</a>'
        : "") +
      (csvUrl
        ? '<a href="' +
          escapeHtml(csvUrl) +
          '" style="display:inline-block;padding:10px 12px;border-radius:10px;background:#10b981;color:#fff;text-decoration:none;font-size:13px;font-weight:800;">Export CSV</a>'
        : "") +
      "</div>" +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_list",
      type: serverWidget.SublistType.LIST,
      label: "Qualified Invoices",
    });

    sub.addField({
      id: "col_invoice_number",
      type: serverWidget.FieldType.TEXT,
      label: "INVOICE #",
    });
    sub.addField({
      id: "col_so_number",
      type: serverWidget.FieldType.TEXT,
      label: "SO #",
    });
    sub.addField({
      id: "col_so_trandate",
      type: serverWidget.FieldType.TEXT,
      label: "SO DATE",
    });
    sub.addField({
      id: "col_customer_name",
      type: serverWidget.FieldType.TEXT,
      label: "CUSTOMER",
    });
    sub.addField({
      id: "col_so_reference",
      type: serverWidget.FieldType.TEXT,
      label: "SO REFERENCE",
    });
    sub.addField({
      id: "col_sales_channel",
      type: serverWidget.FieldType.TEXT,
      label: "SALES CHANNEL",
    });
    sub.addField({
      id: "col_balance",
      type: serverWidget.FieldType.CURRENCY,
      label: "BALANCE",
    });
    sub.addField({
      id: "col_credit",
      type: serverWidget.FieldType.CURRENCY,
      label: "CREDIT/DEPOSIT",
    });
    sub.addField({
      id: "col_inv_qty",
      type: serverWidget.FieldType.INTEGER,
      label: "INV QTY",
    });
    sub.addField({
      id: "col_inv_committed",
      type: serverWidget.FieldType.INTEGER,
      label: "INV COMMITTED",
    });
    sub.addField({
      id: "col_inv_backordered",
      type: serverWidget.FieldType.INTEGER,
      label: "INV BACKORDERED",
    });
    sub.addField({
      id: "col_invoice_url",
      type: serverWidget.FieldType.URL,
      label: "OPEN INVOICE",
    });
    sub.addField({
      id: "col_so_url",
      type: serverWidget.FieldType.URL,
      label: "OPEN SO",
    });
    sub.addField({
      id: "col_customer_url",
      type: serverWidget.FieldType.URL,
      label: "OPEN CUSTOMER",
    });

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];

      var invUrl = url.resolveRecord({
        recordType: "invoice",
        recordId: r.invoice_id,
        isEditMode: false,
      });
      var soUrl = url.resolveRecord({
        recordType: "salesorder",
        recordId: r.so_id,
        isEditMode: false,
      });
      var cuUrl = url.resolveRecord({
        recordType: "customer",
        recordId: r.customer_id,
        isEditMode: false,
      });

      if (r.invoice_number)
        sub.setSublistValue({
          id: "col_invoice_number",
          line: i,
          value: String(r.invoice_number),
        });
      if (r.so_number)
        sub.setSublistValue({
          id: "col_so_number",
          line: i,
          value: String(r.so_number),
        });
      if (r.so_trandate)
        sub.setSublistValue({
          id: "col_so_trandate",
          line: i,
          value: String(r.so_trandate),
        });
      if (r.customer_name)
        sub.setSublistValue({
          id: "col_customer_name",
          line: i,
          value: String(r.customer_name),
        });
      if (r.so_reference)
        sub.setSublistValue({
          id: "col_so_reference",
          line: i,
          value: String(r.so_reference),
        });
      if (r.sales_channel)
        sub.setSublistValue({
          id: "col_sales_channel",
          line: i,
          value: String(r.sales_channel),
        });

      sub.setSublistValue({
        id: "col_balance",
        line: i,
        value: String(Number(r.balance || 0)),
      });
      sub.setSublistValue({
        id: "col_credit",
        line: i,
        value: String(Number(r.credit_or_deposit_amount || 0)),
      });
      sub.setSublistValue({
        id: "col_inv_qty",
        line: i,
        value: String(Number(r.inv_qty || 0)),
      });
      sub.setSublistValue({
        id: "col_inv_committed",
        line: i,
        value: String(Number(r.inv_committed || 0)),
      });
      sub.setSublistValue({
        id: "col_inv_backordered",
        line: i,
        value: String(Number(r.inv_backordered || 0)),
      });

      if (invUrl)
        sub.setSublistValue({
          id: "col_invoice_url",
          line: i,
          value: invUrl,
        });
      if (soUrl)
        sub.setSublistValue({ id: "col_so_url", line: i, value: soUrl });
      if (cuUrl)
        sub.setSublistValue({
          id: "col_customer_url",
          line: i,
          value: cuUrl,
        });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
