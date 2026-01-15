/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/query",
  "N/url",
  "N/runtime",
  "N/redirect",
  "N/file",
], function (serverWidget, query, url, runtime, redirect, file) {
  function csvEscape(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    if (s.indexOf('"') >= 0) s = s.replace(/"/g, '""');
    if (/[",\r\n]/.test(s)) s = '"' + s + '"';
    return s;
  }

  function htmlEscape(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function nowStamp() {
    var d = new Date();
    function pad(n) {
      return (n < 10 ? "0" : "") + n;
    }
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "_" +
      pad(d.getHours()) +
      "-" +
      pad(d.getMinutes()) +
      "-" +
      pad(d.getSeconds())
    );
  }

  function normalizeSku(s) {
    return String(s || "").trim();
  }

  function runReportRows() {
    var sql =
      "\
      WITH base AS (\
        SELECT\
          o.id                                   AS so_id,\
          o.tranid                               AS so_tranid,\
          o.entity                               AS customer_id,\
          COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,\
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
          ABS(NVL(l.quantitybackordered,0))      AS qty_backordered,\
          ABS(NVL(l.quantitypicked,0))           AS qty_picked,\
          NVL(l.custcol_hpl_itempaid,'F')        AS item_paid_flag\
        FROM transaction o\
        JOIN transactionline l ON o.id = l.transaction\
        JOIN item i ON l.item = i.id\
        LEFT JOIN customer c ON o.entity = c.id\
        WHERE o.type = 'SalesOrd'\
          AND l.mainline = 'F'\
      ), elig AS (\
        SELECT\
          so_id, so_tranid, customer_id, customer_name, so_line, item_id, item_sku, item_name,\
          itemtype, isserialitem, kitcomponent,\
          CASE WHEN itemtype = 'Assembly' AND isserialitem = 'T' THEN 'T' ELSE 'F' END AS is_serial_assembly,\
          GREATEST(0, qty - qty_shiprecv) AS remaining,\
          qty, qty_shiprecv, qty_committed, qty_backordered, qty_picked\
        FROM base\
        WHERE\
          isclosed = 'F'\
          AND (assemblycomponent = 'F' OR (assemblycomponent = 'T' AND isserialitem = 'T'))\
          AND qty_committed > 0\
          AND qty_backordered = 0\
          AND qty_picked = 0\
          AND GREATEST(0, qty - qty_shiprecv) > 0\
          AND item_paid_flag = 'T'\
          AND ( itemtype = 'Kit' OR isserialitem = 'T' OR kitcomponent = 'T' )\
      )\
      SELECT *\
      FROM elig\
      ORDER BY so_id, so_line";

    return query.runSuiteQL({ query: sql }).asMappedResults() || [];
  }

  function filterBySku(rows, sku) {
    sku = normalizeSku(sku);
    if (!sku) return rows;
    var target = sku.toLowerCase();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var s = normalizeSku(r.item_sku).toLowerCase();
      if (s === target) out.push(r);
    }
    return out;
  }

  function buildSkuOptions(allRows) {
    var map = {};
    for (var i = 0; i < allRows.length; i++) {
      var s = normalizeSku(allRows[i].item_sku);
      if (s) map[s] = true;
    }
    var skus = Object.keys(map);
    skus.sort(function (a, b) {
      a = a.toLowerCase();
      b = b.toLowerCase();
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    return skus;
  }

  function writeCsv(ctx, rows, selectedSku) {
    var serialHeader = "Serial Number" + "                              ";
    var header = ["SO #", "Customer", "SKU", "Item Name", "Qty", serialHeader];

    var lines = [];
    lines.push(header.map(csvEscape).join(","));

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var line = [
        r.so_tranid || "",
        r.customer_name || "",
        r.item_sku || "",
        r.item_name || "",
        Number(r.qty || 0),
        "",
      ];
      lines.push(line.map(csvEscape).join(","));
    }

    var filename =
      "skipped_lines_report_" +
      (selectedSku ? "sku_" + selectedSku + "_" : "") +
      nowStamp() +
      ".csv";

    var f = file.create({
      name: filename,
      fileType: file.Type.CSV,
      contents: "\uFEFF" + lines.join("\n"),
      encoding: file.Encoding.UTF8,
    });

    ctx.response.writeFile({ file: f, isInline: false });
  }

  function writeXls(ctx, rows, selectedSku) {
    var header = [
      "SO #",
      "Customer",
      "SKU",
      "Item Name",
      "Qty",
      "Serial Number",
    ];

    var filename =
      "skipped_lines_report_" +
      (selectedSku ? "sku_" + selectedSku + "_" : "") +
      nowStamp() +
      ".xls";

    var css =
      "table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;}" +
      "th,td{border:1px solid #000;padding:6px;vertical-align:top;}" +
      "th{font-weight:700;background:#f2f2f2;}" +
      "th.serial,td.serial{min-width:260px;}";

    var out = [];
    out.push(
      '<html><head><meta charset="UTF-8"><style>' +
        css +
        "</style></head><body>"
    );
    out.push("<table>");
    out.push(
      "<tr>" +
        header
          .map(function (h) {
            var cls = h === "Serial Number" ? ' class="serial"' : "";
            return "<th" + cls + ">" + htmlEscape(h) + "</th>";
          })
          .join("") +
        "</tr>"
    );

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push(
        "<tr>" +
          "<td>" +
          htmlEscape(r.so_tranid || "") +
          "</td>" +
          "<td>" +
          htmlEscape(r.customer_name || "") +
          "</td>" +
          "<td>" +
          htmlEscape(r.item_sku || "") +
          "</td>" +
          "<td>" +
          htmlEscape(r.item_name || "") +
          "</td>" +
          "<td>" +
          htmlEscape(Number(r.qty || 0)) +
          "</td>" +
          '<td class="serial"></td>' +
          "</tr>"
      );
    }

    out.push("</table></body></html>");

    var f = file.create({
      name: filename,
      fileType: file.Type.PLAINTEXT,
      contents: out.join(""),
      encoding: file.Encoding.UTF8,
    });

    ctx.response.writeFile({ file: f, isInline: false });
  }

  function onRequest(ctx) {
    if (ctx.request.method === "POST") {
      var chosen = normalizeSku(ctx.request.parameters.custpage_sku || "");
      var scriptObj = runtime.getCurrentScript();
      redirect.toSuitelet({
        scriptId: scriptObj.id,
        deploymentId: scriptObj.deploymentId,
        parameters: chosen ? { sku: chosen } : {},
      });
      return;
    }

    var params = ctx.request.parameters || {};
    var exportType = String(params.export || "").toLowerCase();
    var wantsCsv = exportType === "csv";
    var wantsXls = exportType === "xls";
    var selectedSku = normalizeSku(params.sku || "");

    var allRows = runReportRows();
    var rows = filterBySku(allRows, selectedSku);

    if (wantsCsv) {
      writeCsv(ctx, rows, selectedSku);
      return;
    }

    if (wantsXls) {
      writeXls(ctx, rows, selectedSku);
      return;
    }

    var soSet = {};
    var kitParents = 0,
      serialLines = 0,
      kitComponents = 0,
      serialAssemblies = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      soSet[r.so_id] = true;
      if (String(r.itemtype) === "Kit") kitParents++;
      if (String(r.isserialitem) === "T") serialLines++;
      if (String(r.kitcomponent) === "T") kitComponents++;
      if (String(r.is_serial_assembly) === "T") serialAssemblies++;
    }

    var form = serverWidget.createForm({
      title: "Skipped Lines Report (Kits, Kit Components & Serialized)",
    });

    var skuField = form.addField({
      id: "custpage_sku",
      type: serverWidget.FieldType.SELECT,
      label: "SKU",
    });

    skuField.addSelectOption({ value: "", text: "All SKUs" });

    var skuOptions = buildSkuOptions(allRows);
    for (var j = 0; j < skuOptions.length; j++) {
      var s = skuOptions[j];
      skuField.addSelectOption({ value: s, text: s });
    }
    skuField.defaultValue = selectedSku;

    form.addSubmitButton({ label: "Apply SKU Filter" });

    var scriptObj2 = runtime.getCurrentScript();
    var exportParamsCsv = { export: "csv" };
    if (selectedSku) exportParamsCsv.sku = selectedSku;

    var exportParamsXls = { export: "xls" };
    if (selectedSku) exportParamsXls.sku = selectedSku;

    var exportUrlCsv = url.resolveScript({
      scriptId: scriptObj2.id,
      deploymentId: scriptObj2.deploymentId,
      params: exportParamsCsv,
    });

    var exportUrlXls = url.resolveScript({
      scriptId: scriptObj2.id,
      deploymentId: scriptObj2.deploymentId,
      params: exportParamsXls,
    });

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    summary.defaultValue =
      '<div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin:8px 0 16px;">' +
      '<div style="padding:12px 14px;border-radius:10px;background:#112e51;color:#fff;font-size:14px;line-height:1.6;font-weight:600;box-shadow:0 4px 10px rgba(0,0,0,0.15);flex:1;">' +
      "<div>SKU Filter: <b>" +
      (selectedSku ? htmlEscape(selectedSku) : "All") +
      "</b></div>" +
      "<div>Total Lines: <b>" +
      rows.length +
      "</b></div>" +
      "<div>Distinct SOs: <b>" +
      Object.keys(soSet).length +
      "</b></div>" +
      "<div>Kit parents: <b>" +
      kitParents +
      "</b> &nbsp;|&nbsp; Kit components: <b>" +
      kitComponents +
      "</b> &nbsp;|&nbsp; Serialized lines: <b>" +
      serialLines +
      "</b> &nbsp;|&nbsp; Serialized assemblies: <b>" +
      serialAssemblies +
      "</b></div>" +
      "</div>" +
      '<div style="padding-top:2px;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">' +
      '<a target="_blank" rel="noopener noreferrer" href="' +
      exportUrlXls +
      '" ' +
      'style="display:inline-block;background:#0b5cab;color:#fff;text-decoration:none;' +
      'padding:10px 14px;border-radius:10px;font-weight:800;box-shadow:0 4px 10px rgba(0,0,0,0.15);">' +
      "Export Excel (Gridlines)" +
      "</a>" +
      '<a target="_blank" rel="noopener noreferrer" href="' +
      exportUrlCsv +
      '" ' +
      'style="display:inline-block;background:#2b6cb0;color:#fff;text-decoration:none;' +
      'padding:10px 14px;border-radius:10px;font-weight:700;box-shadow:0 4px 10px rgba(0,0,0,0.15);">' +
      "Export CSV" +
      "</a>" +
      "</div>" +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "Skipped Lines (paid + committed + no backorder + remaining)",
    });

    sub.addField({
      id: "col_so_tranid",
      type: serverWidget.FieldType.TEXT,
      label: "SO #",
    });
    sub.addField({
      id: "col_so_link",
      type: serverWidget.FieldType.URL,
      label: "Open SO",
    });
    sub.addField({
      id: "col_customer",
      type: serverWidget.FieldType.TEXT,
      label: "Customer",
    });
    sub.addField({
      id: "col_line",
      type: serverWidget.FieldType.INTEGER,
      label: "SO Line ID",
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
      id: "col_qty",
      type: serverWidget.FieldType.INTEGER,
      label: "Qty",
    });
    sub.addField({
      id: "col_qty_committed",
      type: serverWidget.FieldType.INTEGER,
      label: "Committed",
    });
    sub.addField({
      id: "col_qty_backordered",
      type: serverWidget.FieldType.INTEGER,
      label: "Backordered",
    });
    sub.addField({
      id: "col_remaining",
      type: serverWidget.FieldType.INTEGER,
      label: "Remaining",
    });

    for (var k = 0; k < rows.length; k++) {
      var rr = rows[k];

      var soUrl2 = url.resolveRecord({
        recordType: "salesorder",
        recordId: rr.so_id,
        isEditMode: false,
      });

      if (rr.so_tranid)
        sub.setSublistValue({
          id: "col_so_tranid",
          line: k,
          value: String(rr.so_tranid),
        });
      if (soUrl2)
        sub.setSublistValue({ id: "col_so_link", line: k, value: soUrl2 });

      if (rr.customer_name)
        sub.setSublistValue({
          id: "col_customer",
          line: k,
          value: String(rr.customer_name),
        });

      sub.setSublistValue({
        id: "col_line",
        line: k,
        value: String(Number(rr.so_line || 0)),
      });

      if (rr.item_sku)
        sub.setSublistValue({
          id: "col_item_sku",
          line: k,
          value: String(rr.item_sku),
        });
      if (rr.item_name)
        sub.setSublistValue({
          id: "col_item_name",
          line: k,
          value: String(rr.item_name),
        });

      sub.setSublistValue({
        id: "col_qty",
        line: k,
        value: String(Number(rr.qty || 0)),
      });
      sub.setSublistValue({
        id: "col_qty_committed",
        line: k,
        value: String(Number(rr.qty_committed || 0)),
      });
      sub.setSublistValue({
        id: "col_qty_backordered",
        line: k,
        value: String(Number(rr.qty_backordered || 0)),
      });
      sub.setSublistValue({
        id: "col_remaining",
        line: k,
        value: String(Number(rr.remaining || 0)),
      });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
