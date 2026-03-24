/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/query",
  "N/url",
  "N/file",
  "N/runtime",
  "N/render",
  "N/redirect",
], function (serverWidget, query, url, file, runtime, render, redirect) {
  function runQuery(dateStr, scFilter) {
    var scWhere = "";
    if (String(scFilter || "") === "live_event") {
      // first 2 words "Live Event" => starts with "Live Event"
      scWhere =
        " AND UPPER(BUILTIN.DF(o.cseg_nsps_so_class)) LIKE 'LIVE EVENT%'";
    }

    var sql =
      "\
        WITH invs AS (\
          SELECT\
            invl.createdfrom AS so_id,\
            LISTAGG(inv.id, ',') WITHIN GROUP (ORDER BY inv.id) AS invoice_ids,\
            LISTAGG(inv.tranid, '||') WITHIN GROUP (ORDER BY inv.id) AS invoice_tranids\
          FROM transaction inv\
          JOIN transactionline invl\
            ON invl.transaction = inv.id\
           AND invl.mainline = 'T'\
          WHERE inv.type = 'CustInvc'\
            AND invl.createdfrom IS NOT NULL\
          GROUP BY invl.createdfrom\
        )\
        SELECT\
          o.id AS so_id,\
          o.tranid AS so_tranid,\
          o.trandate AS so_date,\
          o.foreigntotal AS so_amount_total,\
          COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,\
          BUILTIN.DF(o.cseg_nsps_so_class) AS sales_channel,\
          invs.invoice_ids AS invoice_ids,\
          invs.invoice_tranids AS invoice_tranids\
        FROM transaction o\
        JOIN customer c ON c.id = o.entity\
        LEFT JOIN invs ON invs.so_id = o.id\
        WHERE o.type = 'SalesOrd'\
          AND o.trandate = TO_DATE('" +
      String(dateStr) +
      "', 'YYYY-MM-DD')" +
      scWhere +
      "\
        ORDER BY o.tranid";

    return query.runSuiteQL({ query: sql }).asMappedResults() || [];
  }

  function runInvoicesForSo(soId) {
    var sql =
      "\
        SELECT\
          inv.id AS invoice_id,\
          inv.tranid AS invoice_tranid,\
          inv.trandate AS invoice_date\
        FROM transaction inv\
        JOIN transactionline invl\
          ON invl.transaction = inv.id\
         AND invl.mainline = 'T'\
        WHERE inv.type = 'CustInvc'\
          AND invl.createdfrom = " +
      Number(soId) +
      "\
        ORDER BY inv.id";

    return query.runSuiteQL({ query: sql }).asMappedResults() || [];
  }

  function xmlEscape(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function csvEscape(str) {
    var s = String(str || "");
    s = s.replace(/"/g, '""');
    return '"' + s + '"';
  }

  function buildRecordUrl(recordType, id) {
    if (!id) return "";
    try {
      return url.resolveRecord({
        recordType: recordType,
        recordId: Number(id),
        isEditMode: false,
      });
    } catch (e) {
      return "";
    }
  }

  function getAppDomain() {
    try {
      return url.resolveDomain({ hostType: url.HostType.APPLICATION });
    } catch (e) {
      return "";
    }
  }

  function toAbsoluteUrl(maybeRelative) {
    var p = String(maybeRelative || "").trim();
    if (!p) return "";
    if (/^https?:\/\//i.test(p)) return p;
    var d = getAppDomain();
    if (!d) return p;
    if (p.charAt(0) !== "/") p = "/" + p;
    return "https://" + d + p;
  }

  function parseInvArrays(row) {
    var idsRaw = String(row.invoice_ids || "").trim();
    var tidsRaw = String(row.invoice_tranids || "").trim();
    if (!idsRaw) return [];

    var ids = idsRaw.split(",").filter(function (x) {
      return String(x || "").trim();
    });
    var tids = tidsRaw ? tidsRaw.split("||") : [];

    var out = [];
    for (var i = 0; i < ids.length; i++) {
      out.push({
        id: String(ids[i]).trim(),
        tranid: String(tids[i] || "").trim(),
      });
    }
    return out;
  }

  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    var DEFAULT_DATE = "2026-01-31";
    var dateStr = String(ctx.request.parameters.date || DEFAULT_DATE).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) dateStr = DEFAULT_DATE;

    var scFilter = String(ctx.request.parameters.sc || "").trim(); // "" | "live_event"

    var cur = runtime.getCurrentScript();

    // --------- "OPEN INVOICE(S)" HANDLER ----------
    if (String(ctx.request.parameters.openinvs || "") === "1") {
      var soId = Number(ctx.request.parameters.soid || 0);
      if (!soId) {
        ctx.response.write("Missing soid");
        return;
      }

      var invRows = runInvoicesForSo(soId);

      if (invRows.length === 1) {
        redirect.toRecord({
          type: "invoice",
          id: Number(invRows[0].invoice_id),
          isEditMode: false,
        });
        return;
      }

      var formInv = serverWidget.createForm({
        title: "Invoices created from SO #" + soId,
      });

      var subInv = formInv.addSublist({
        id: "custpage_invlist",
        type: serverWidget.SublistType.LIST,
        label: "Invoices",
      });

      subInv.addField({
        id: "col_inv_num",
        type: serverWidget.FieldType.TEXT,
        label: "Invoice #",
      });
      var fUrl = subInv.addField({
        id: "col_inv_url",
        type: serverWidget.FieldType.URL,
        label: "Open Invoice",
      });
      fUrl.linkText = "Open";

      for (var ii = 0; ii < invRows.length; ii++) {
        var ir = invRows[ii];
        var invUrl = buildRecordUrl("invoice", ir.invoice_id);

        subInv.setSublistValue({
          id: "col_inv_num",
          line: ii,
          value: String(ir.invoice_tranid || "#" + ir.invoice_id),
        });

        if (invUrl) {
          subInv.setSublistValue({
            id: "col_inv_url",
            line: ii,
            value: invUrl,
          });
        }
      }

      ctx.response.writePage(formInv);
      return;
    }

    // --------- MAIN REPORT ----------
    var rows = runQuery(dateStr, scFilter);

    var totalSos = rows.length;
    var sosWithInv = 0;
    var totalInv = 0;

    for (var i = 0; i < rows.length; i++) {
      var invArr = parseInvArrays(rows[i]);
      if (invArr.length > 0) sosWithInv++;
      totalInv += invArr.length;
    }

    var exportUrl = url.resolveScript({
      scriptId: cur.id,
      deploymentId: cur.deploymentId,
      params: { export: "1", date: dateStr, sc: scFilter },
    });

    var pdfUrl = url.resolveScript({
      scriptId: cur.id,
      deploymentId: cur.deploymentId,
      params: { exportpdf: "1", date: dateStr, sc: scFilter },
    });

    // ---------- PDF ----------
    if (String(ctx.request.parameters.exportpdf || "") === "1") {
      var parts = [];
      parts.push('<?xml version="1.0"?>');
      parts.push(
        '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">',
      );
      parts.push('<pdf><head><style type="text/css">');
      parts.push(
        "body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; }",
      );
      parts.push("h1 { font-size: 18pt; margin-bottom: 10pt; }");
      parts.push(
        ".meta { margin-bottom: 12pt; font-size: 10pt; color: #333; }",
      );
      parts.push("table { width: 100%; border-collapse: collapse; }");
      parts.push("th, td { text-align: left; }");
      parts.push(
        "th { font-weight: bold; background-color: #f0f0f0; padding: 8pt 10pt; border-bottom: 1pt solid #cccccc; }",
      );
      parts.push(
        "td { padding: 8pt 10pt; border-bottom: 0.5pt solid #e0e0e0; vertical-align: top; }",
      );
      parts.push("a { color: #0f6ab4; text-decoration: underline; }");
      parts.push("</style></head><body>");

      parts.push("<h1>Sales Orders on " + xmlEscape(dateStr) + "</h1>");
      parts.push(
        '<div class="meta">' +
          "Total SOs: <b>" +
          xmlEscape(totalSos) +
          "</b> &nbsp;&nbsp; SOs with invoice(s): <b>" +
          xmlEscape(sosWithInv) +
          "</b> &nbsp;&nbsp; Total invoices linked: <b>" +
          xmlEscape(totalInv) +
          "</b>" +
          "</div>",
      );

      parts.push(
        '<div class="meta">Sales Channel Filter: <b>' +
          xmlEscape(
            scFilter === "live_event" ? 'Starts with "Live Event"' : "All",
          ) +
          "</b></div>",
      );

      parts.push("<table>");
      parts.push("<tr>");
      parts.push('<th width="12%">SO Date</th>');
      parts.push('<th width="16%">SO</th>');
      parts.push('<th width="14%">SO Total</th>');
      parts.push('<th width="22%">Customer</th>');
      parts.push('<th width="18%">Sales Channel</th>');
      parts.push('<th width="18%">Invoices</th>');
      parts.push("</tr>");

      for (var p = 0; p < rows.length; p++) {
        var r = rows[p];
        var invArr2 = parseInvArrays(r);

        var soRel = buildRecordUrl("salesorder", r.so_id);
        var soAbs = toAbsoluteUrl(soRel);
        var soLabelPdf = String(r.so_tranid || "#" + r.so_id);
        var soCellPdf = soAbs
          ? '<a href="' +
            xmlEscape(soAbs) +
            '">' +
            xmlEscape(soLabelPdf) +
            "</a>"
          : xmlEscape(soLabelPdf);

        var invCellPdf = "";
        if (invArr2.length === 0) {
          invCellPdf = xmlEscape("(no invoice)");
        } else {
          invCellPdf = invArr2
            .map(function (x) {
              var invRel = buildRecordUrl("invoice", x.id);
              var invAbs = toAbsoluteUrl(invRel);
              var invLabel = x.tranid ? x.tranid : "#" + x.id;
              return invAbs
                ? '<a href="' +
                    xmlEscape(invAbs) +
                    '">' +
                    xmlEscape(invLabel) +
                    "</a>"
                : xmlEscape(invLabel);
            })
            .join(", ");
        }

        var bgColor = p % 2 === 0 ? "#ffffff" : "#f7f7f7";

        parts.push("<tr>");
        parts.push(
          '<td width="12%" style="background-color:' +
            bgColor +
            ';">' +
            xmlEscape(r.so_date || "") +
            "</td>",
        );
        parts.push(
          '<td width="16%" style="background-color:' +
            bgColor +
            ';">' +
            soCellPdf +
            "</td>",
        );
        parts.push(
          '<td width="14%" style="background-color:' +
            bgColor +
            ';">' +
            xmlEscape(r.so_amount_total || "") +
            "</td>",
        );
        parts.push(
          '<td width="22%" style="background-color:' +
            bgColor +
            ';">' +
            xmlEscape(r.customer_name || "") +
            "</td>",
        );
        parts.push(
          '<td width="18%" style="background-color:' +
            bgColor +
            ';">' +
            xmlEscape(r.sales_channel || "") +
            "</td>",
        );
        parts.push(
          '<td width="18%" style="background-color:' +
            bgColor +
            ';">' +
            invCellPdf +
            "</td>",
        );
        parts.push("</tr>");
      }

      parts.push("</table></body></pdf>");

      var xml = parts.join("");
      var pdfFile = render.xmlToPdf({ xmlString: xml });
      pdfFile.name = "so_report_" + dateStr + ".pdf";
      ctx.response.writeFile({ file: pdfFile, isInline: false });
      return;
    }

    // ---------- CSV ----------
    if (String(ctx.request.parameters.export || "") === "1") {
      var csv =
        "SO Date,SO Number,SO Total,SO URL,Customer,Sales Channel,Invoice Numbers,Invoice URLs\n";

      for (var c1 = 0; c1 < rows.length; c1++) {
        var rr = rows[c1];
        var soUrl = buildRecordUrl("salesorder", rr.so_id);

        var invArr3 = parseInvArrays(rr);
        var invNums = invArr3
          .map(function (x) {
            return x.tranid ? x.tranid : "#" + x.id;
          })
          .join(" | ");

        var invUrls = invArr3
          .map(function (x) {
            return buildRecordUrl("invoice", x.id);
          })
          .filter(function (u) {
            return !!u;
          })
          .join(" | ");

        csv +=
          csvEscape(rr.so_date || "") +
          "," +
          csvEscape(rr.so_tranid || "") +
          "," +
          csvEscape(rr.so_amount_total || "") +
          "," +
          csvEscape(soUrl) +
          "," +
          csvEscape(rr.customer_name || "") +
          "," +
          csvEscape(rr.sales_channel || "") +
          "," +
          csvEscape(invNums) +
          "," +
          csvEscape(invUrls) +
          "\n";
      }

      var f = file.create({
        name:
          "so_report_" + dateStr + (scFilter ? "_" + scFilter : "") + ".csv",
        fileType: file.Type.CSV,
        contents: csv,
      });
      ctx.response.writeFile({ file: f, isInline: false });
      return;
    }

    // ---------- UI ----------
    var form = serverWidget.createForm({
      title: "Sales Orders on " + dateStr + " — Customer + Invoice Link(s)",
    });

    // Date picker
    var fDate = form.addField({
      id: "custpage_date",
      type: serverWidget.FieldType.DATE,
      label: "Date",
    });
    (function setDefaultDate() {
      var parts = String(dateStr).split("-");
      var y = Number(parts[0]),
        m = Number(parts[1]),
        d = Number(parts[2]);
      if (y && m && d) fDate.defaultValue = new Date(y, m - 1, d);
    })();

    // Sales Channel filter
    var fSc = form.addField({
      id: "custpage_sc_filter",
      type: serverWidget.FieldType.SELECT,
      label: "Sales Channel Filter",
    });
    fSc.addSelectOption({ value: "", text: "All" });
    fSc.addSelectOption({
      value: "live_event",
      text: 'Starts with "Live Event"',
    });
    fSc.defaultValue = scFilter;

    // Run button
    form.addButton({
      id: "custpage_run",
      label: "Run",
      functionName: "runReport",
    });

    // Client script (inline) — ✅ NO require(), uses DOM ids that NetSuite renders
    var cs = form.addField({
      id: "custpage_cs",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    var baseUrl = url.resolveScript({
      scriptId: cur.id,
      deploymentId: cur.deploymentId,
    });

    cs.defaultValue =
      '<script type="text/javascript">' +
      "(function(){" +
      "  function pad2(n){ n=String(n||''); return n.length===1?('0'+n):n; }" +
      "  function toYMD(v){" +
      "    if(!v) return '';" +
      "    v = String(v).trim();" +
      "    if(/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return v;" +
      "    var d = new Date(v);" +
      "    if(!isNaN(d.getTime())) return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());" +
      "    var m = v.match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);" +
      "    if(m) return m[3]+'-'+pad2(m[1])+'-'+pad2(m[2]);" +
      "    return '';" +
      "  }" +
      "  function getFieldValue(fieldId){" +
      "    var el = document.getElementById(fieldId);" +
      "    if(el && typeof el.value !== 'undefined') return el.value;" +
      "    var inpt = document.getElementById('inpt_' + fieldId);" +
      "    if(inpt && typeof inpt.value !== 'undefined') return inpt.value;" +
      "    var sel = document.querySelector('select[name=\"inpt_' + fieldId + '\"]');" +
      "    if(sel && typeof sel.value !== 'undefined') return sel.value;" +
      "    var any = document.querySelector('[name=\"' + fieldId + '\"]');" +
      "    if(any && typeof any.value !== 'undefined') return any.value;" +
      "    return '';" +
      "  }" +
      "  window.runReport = function(){" +
      "    var base = " +
      JSON.stringify(baseUrl) +
      ";" +
      "    var dateRaw = getFieldValue('custpage_date');" +
      "    var ymd = toYMD(dateRaw);" +
      "    var sc = getFieldValue('custpage_sc_filter');" +
      "    var qs = [];" +
      "    if(ymd) qs.push('date=' + encodeURIComponent(ymd));" +
      "    if(sc) qs.push('sc=' + encodeURIComponent(sc));" +
      "    window.location.href = base + (qs.length ? ((base.indexOf('?')>=0?'&':'?') + qs.join('&')) : '');" +
      "  };" +
      "})();" +
      "</script>";

    // Toolbar summary + downloads
    var toolbar = form.addField({
      id: "custpage_toolbar",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    var scLabel =
      scFilter === "live_event" ? 'Starts with "Live Event"' : "All";

    toolbar.defaultValue =
      '<style>\
          .c-toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:10px 0 18px;}\
          .c-summary{flex:1;padding:12px 16px;border-radius:10px;background:#112e51;color:#fff;\
                     font-size:14px;line-height:1.6;font-weight:600;box-shadow:0 4px 10px rgba(0,0,0,.15);}\
          .c-btn{display:inline-block;padding:12px 18px;border-radius:10px;background:#0f6ab4;\
                 color:#fff !important;text-decoration:none;font-weight:700;border:1px solid #0c5a98;\
                 box-shadow:0 2px 6px rgba(0,0,0,.12);}\
          .c-btn:hover{background:#0c5a98;}\
          .c-btn:active{transform:translateY(1px);}\
        </style>\
        <div class="c-toolbar">\
          <div class="c-summary">\
            <div>Date: <b>' +
      xmlEscape(dateStr) +
      "</b> &nbsp; | &nbsp; Sales Channel Filter: <b>" +
      xmlEscape(scLabel) +
      "</b></div>\
            <div>Total SOs: <b>" +
      totalSos +
      "</b> &nbsp; | &nbsp; SOs with invoice(s): <b>" +
      sosWithInv +
      "</b> &nbsp; | &nbsp; Total invoices linked: <b>" +
      totalInv +
      '</b></div>\
          </div>\
          <div style="display:flex;gap:10px;">\
            <a class="c-btn" href="' +
      exportUrl +
      '">Download CSV</a>\
            <a class="c-btn" href="' +
      pdfUrl +
      '">Download PDF</a>\
          </div>\
        </div>';

    var sub = form.addSublist({
      id: "custpage_sos",
      type: serverWidget.SublistType.LIST,
      label: "Sales Orders",
    });

    sub.addField({
      id: "col_so_date",
      type: serverWidget.FieldType.TEXT,
      label: "SO Date",
    });
    sub.addField({
      id: "col_so_num",
      type: serverWidget.FieldType.TEXT,
      label: "SO #",
    });

    sub.addField({
      id: "col_so_total",
      type: serverWidget.FieldType.TEXT,
      label: "SO Total",
    });

    var soUrlField = sub.addField({
      id: "col_so_url",
      type: serverWidget.FieldType.URL,
      label: "OPEN SO",
    });
    soUrlField.linkText = "Open";

    sub.addField({
      id: "col_customer",
      type: serverWidget.FieldType.TEXT,
      label: "Customer",
    });

    sub.addField({
      id: "col_sales_channel",
      type: serverWidget.FieldType.TEXT,
      label: "Sales Channel",
    });

    sub.addField({
      id: "col_inv_nums",
      type: serverWidget.FieldType.TEXT,
      label: "Invoice #s",
    });

    var invUrlField = sub.addField({
      id: "col_inv_url",
      type: serverWidget.FieldType.URL,
      label: "OPEN INVOICE(S)",
    });
    invUrlField.linkText = "Open";

    for (var l = 0; l < rows.length; l++) {
      var row = rows[l];

      var soUrl2 = buildRecordUrl("salesorder", row.so_id);
      var invArr4 = parseInvArrays(row);

      var invNumsText = "";
      if (invArr4.length === 0) {
        invNumsText = "(no invoice)";
      } else {
        invNumsText = invArr4
          .map(function (inv) {
            return inv.tranid ? inv.tranid : "#" + inv.id;
          })
          .join(", ");
      }

      var invOpenUrl = "";
      if (invArr4.length === 1) {
        invOpenUrl = buildRecordUrl("invoice", invArr4[0].id);
      } else if (invArr4.length > 1) {
        invOpenUrl = url.resolveScript({
          scriptId: cur.id,
          deploymentId: cur.deploymentId,
          params: {
            openinvs: "1",
            soid: String(row.so_id),
            date: dateStr,
            sc: scFilter,
          },
        });
      }

      if (row.so_date)
        sub.setSublistValue({
          id: "col_so_date",
          line: l,
          value: String(row.so_date),
        });
      if (row.so_tranid)
        sub.setSublistValue({
          id: "col_so_num",
          line: l,
          value: String(row.so_tranid),
        });
      if (row.so_amount_total !== null && row.so_amount_total !== undefined)
        sub.setSublistValue({
          id: "col_so_total",
          line: l,
          value: String(row.so_amount_total),
        });
      if (soUrl2)
        sub.setSublistValue({ id: "col_so_url", line: l, value: soUrl2 });
      if (row.customer_name)
        sub.setSublistValue({
          id: "col_customer",
          line: l,
          value: String(row.customer_name),
        });
      if (row.sales_channel)
        sub.setSublistValue({
          id: "col_sales_channel",
          line: l,
          value: String(row.sales_channel),
        });

      sub.setSublistValue({ id: "col_inv_nums", line: l, value: invNumsText });
      if (invOpenUrl)
        sub.setSublistValue({ id: "col_inv_url", line: l, value: invOpenUrl });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
