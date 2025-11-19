/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/query",
  "N/url",
  "N/log",
  "N/file",
  "N/runtime",
  "N/render",
], function (serverWidget, query, url, log, file, runtime, render) {
  function runQuery() {
    var sql =
      "\
      WITH base AS (\
        SELECT\
          o.id                                   AS so_id,\
          o.tranid                               AS so_tranid,\
          o.entity                               AS customer_id,\
          l.id                                   AS so_line,\
          l.item                                 AS item_id,\
          i.itemid                               AS item_sku,\
          COALESCE(i.displayname, i.itemid)      AS item_name,\
          l.itemtype                             AS itemtype,\
          NVL(i.isserialitem,'F')                AS isserialitem,\
          NVL(l.isclosed,'F')                    AS isclosed,\
          l.assemblycomponent                    AS assemblycomponent,\
          l.kitcomponent                         AS kitcomponent,\
          ABS(NVL(l.quantity,0))                 AS qty,\
          ABS(NVL(l.quantityshiprecv,0))         AS qty_shiprecv,\
          ABS(NVL(l.quantitycommitted,0))        AS qty_committed,\
          ABS(NVL(l.quantitypicked,0))           AS qty_picked,\
          ABS(NVL(l.quantityonshipments,0))      AS qty_on_shipments,\
          ABS(NVL(l.quantitybackordered,0))      AS qty_backordered,\
          NVL(l.custcol_hpl_itempaid,'F')        AS item_paid_flag\
        FROM transaction o\
        JOIN transactionline l ON o.id = l.transaction\
        JOIN item i ON l.item = i.id\
        WHERE o.type = 'SalesOrd'\
          AND l.mainline = 'F'\
      ), elig AS (\
        SELECT\
          so_id, so_tranid, so_line, item_sku, item_name, itemtype,\
          isserialitem, kitcomponent, assemblycomponent,\
          CASE WHEN itemtype = 'Assembly' AND isserialitem = 'T' THEN 'T' ELSE 'F' END AS is_serial_assembly,\
          ABS(NVL(qty,0)) AS qty,\
          GREATEST(0, ABS(NVL(qty,0)) - ABS(NVL(qty_shiprecv,0))) AS remaining,\
          qty_picked, qty_on_shipments\
        FROM base\
        WHERE\
          isclosed = 'F'\
          AND (assemblycomponent = 'F' OR (assemblycomponent = 'T' AND isserialitem = 'T'))\
          AND item_paid_flag = 'T'\
          AND qty_committed > 0\
          AND qty_backordered = 0\
          AND GREATEST(0, ABS(NVL(qty,0)) - ABS(NVL(qty_shiprecv,0))) > 0\
          AND qty_picked = 0\
          AND qty_on_shipments = 0\
          AND isserialitem = 'T'\
      )\
      SELECT *\
      FROM elig\
      ORDER BY so_id, so_line";
    return query.runSuiteQL({ query: sql }).asMappedResults() || [];
  }

  function aggBySku(rows) {
    var agg = {};
    for (var j = 0; j < rows.length; j++) {
      var rr = rows[j];
      var sku = String(rr.item_sku || "");
      if (!sku) continue;
      if (!agg[sku]) {
        agg[sku] = { sku: sku, name: String(rr.item_name || ""), totalQty: 0 };
      }
      agg[sku].totalQty += Number(rr.qty || 0);
    }
    return Object.keys(agg)
      .sort()
      .map(function (k) {
        return agg[k];
      });
  }

  function xmlEscape(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    var rows = runQuery();

    // -------- PDF export (alignment fix) --------
    if (String(ctx.request.parameters.exportpdf || "") === "1") {
      var aggListPdf = aggBySku(rows);

      var parts = [];
      parts.push('<?xml version="1.0"?>');
      parts.push(
        '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">'
      );
      parts.push("<pdf>");
      parts.push("<head>");
      parts.push('<style type="text/css">');
      parts.push(
        "body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; }"
      );
      parts.push("h1 { font-size: 18pt; margin-bottom: 14pt; }");
      parts.push("table { width: 100%; border-collapse: collapse; }");
      parts.push("th, td { text-align: left; }");
      parts.push(
        "th { font-weight: bold; background-color: #f0f0f0; padding: 8pt 10pt; border-bottom: 1pt solid #cccccc; }"
      );
      parts.push(
        "td { padding: 8pt 10pt; border-bottom: 0.5pt solid #e0e0e0; }"
      );
      parts.push(".qtycol { text-align: right; }");
      parts.push("</style>");

      parts.push("</head>");
      parts.push("<body>");
      parts.push(
        "<h1>Serialized Lines (Aggregated by SKU)</h1>" +
          '<table width="100%">' +
          "<tr>" +
          '<th width="25%">SKU</th>' +
          '<th width="55%">Item Name</th>' +
          '<th width="20%" class="qtycol">Quantity (Aggregated)</th>' +
          "</tr>"
      );

      for (var p = 0; p < aggListPdf.length; p++) {
        var row = aggListPdf[p];
        var skuVal = xmlEscape(row.sku);
        var nameVal = xmlEscape(row.name);
        var qtyVal = xmlEscape(String(row.totalQty || 0));
        var bgColor = p % 2 === 0 ? "#ffffff" : "#f7f7f7";

        parts.push("<tr>");
        parts.push(
          '<td width="25%" style="background-color:' +
            bgColor +
            ';">' +
            skuVal +
            "</td>"
        );
        parts.push(
          '<td width="55%" style="background-color:' +
            bgColor +
            ';">' +
            nameVal +
            "</td>"
        );
        parts.push(
          '<td width="20%" class="qtycol" style="background-color:' +
            bgColor +
            ';">' +
            qtyVal +
            "</td>"
        );
        parts.push("</tr>");
      }

      parts.push("</table></body></pdf>");

      var xml = parts.join("");
      var pdfFile = render.xmlToPdf({ xmlString: xml });
      pdfFile.name = "serialized_aggregated.pdf";

      ctx.response.writeFile({ file: pdfFile, isInline: false });
      return;
    }

    // -------- CSV export (unchanged) --------
    if (String(ctx.request.parameters.export || "") === "1") {
      var aggList = aggBySku(rows);
      var csv = "SKU,Item Name,Quantity (Aggregated)\n";
      for (var i = 0; i < aggList.length; i++) {
        var a = aggList[i];
        var sku = (a.sku || "").replace(/"/g, '""');
        var name = (a.name || "").replace(/"/g, '""');
        csv += '"' + sku + '","' + name + '",' + String(a.totalQty) + "\n";
      }
      var f = file.create({
        name: "serialized_aggregated.csv",
        fileType: file.Type.CSV,
        contents: csv,
      });
      ctx.response.writeFile({ file: f, isInline: false });
      return;
    }

    var soSet = {};
    var serialAssemblies = 0;
    for (var i2 = 0; i2 < rows.length; i2++) {
      var r2 = rows[i2];
      soSet[r2.so_id] = true;
      if (String(r2.is_serial_assembly) === "T") serialAssemblies++;
    }

    var aggListDisplay = aggBySku(rows);

    var form = serverWidget.createForm({
      title:
        "Serialized Lines (Aggregated by SKU) — Paid + Committed + No Backorder + Remaining",
    });

    var exportUrl = url.resolveScript({
      scriptId: runtime.getCurrentScript().id,
      deploymentId: runtime.getCurrentScript().deploymentId,
      params: { export: "1" },
    });

    var pdfUrl = url.resolveScript({
      scriptId: runtime.getCurrentScript().id,
      deploymentId: runtime.getCurrentScript().deploymentId,
      params: { exportpdf: "1" },
    });

    var toolbar = form.addField({
      id: "custpage_toolbar",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });
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
          <div>Total Serialized Lines: <b>' +
      rows.length +
      "</b></div>\
          <div>Distinct SOs: <b>" +
      Object.keys(soSet).length +
      "</b></div>\
          <div>Serialized assemblies (Assembly+Serialized): <b>" +
      serialAssemblies +
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
      id: "custpage_agg",
      type: serverWidget.SublistType.LIST,
      label: "Aggregated by SKU",
    });

    sub.addField({
      id: "col_item_sku",
      type: serverWidget.FieldType.TEXT,
      label: "SKU",
    });
    sub.addField({
      id: "col_item_name",
      type: serverWidget.FieldType.TEXT,
      label: "Item Name",
    });
    sub.addField({
      id: "col_total_qty",
      type: serverWidget.FieldType.INTEGER,
      label: "Quantity (Aggregated)",
    });

    for (var i3 = 0; i3 < aggListDisplay.length; i3++) {
      var a = aggListDisplay[i3];
      sub.setSublistValue({ id: "col_item_sku", line: i3, value: a.sku });
      if (a.name)
        sub.setSublistValue({ id: "col_item_name", line: i3, value: a.name });
      sub.setSublistValue({
        id: "col_total_qty",
        line: i3,
        value: String(a.totalQty),
      });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
