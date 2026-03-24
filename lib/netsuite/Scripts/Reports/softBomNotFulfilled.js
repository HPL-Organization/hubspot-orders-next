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
  const COL_GROUPKEY = "custcol_hpl_softbom_groupkey";
  const COL_IS_CHILD = "custcol_hpl_softbom_child";
  const COL_PARENT_ITEM = "custcol_hpl_softbom_parent";
  const COL_PAID = "custcol_hpl_itempaid";

  const SERIAL_MODE_DEFAULT = "all"; // serial | nonserial | all

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

  function normalizeMode(v) {
    v = String(v || "")
      .toLowerCase()
      .trim();
    if (v === "serial" || v === "nonserial" || v === "all") return v;
    return SERIAL_MODE_DEFAULT;
  }

  function serialFilterSql(mode) {
    if (mode === "serial") return " AND isserialitem = 'T' ";
    if (mode === "nonserial") return " AND isserialitem = 'F' ";
    return "";
  }

  function runSoftBomReportRows(serialMode) {
    serialMode = normalizeMode(serialMode);
    var serialClause = serialFilterSql(serialMode);

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
            ABS(NVL(l.quantity,0))                 AS qty,\
            ABS(NVL(l.quantityshiprecv,0))         AS qty_shiprecv,\
            ABS(NVL(l.quantitycommitted,0))        AS qty_committed,\
            ABS(NVL(l.quantitybackordered,0))      AS qty_backordered,\
            ABS(NVL(l.quantitypicked,0))           AS qty_picked,\
            NVL(l." +
      COL_PAID +
      ",'F')              AS item_paid_flag,\
            l." +
      COL_GROUPKEY +
      "                 AS groupkey,\
            NVL(l." +
      COL_IS_CHILD +
      ",'F')             AS is_child,\
            l." +
      COL_PARENT_ITEM +
      "              AS parent_item_id\
          FROM transaction o\
          JOIN transactionline l ON o.id = l.transaction\
          JOIN item i ON l.item = i.id\
          LEFT JOIN customer c ON o.entity = c.id\
          WHERE o.type = 'SalesOrd'\
            AND l.mainline = 'F'\
            AND l." +
      COL_GROUPKEY +
      " IS NOT NULL\
        ), ready_children AS (\
          SELECT\
            so_id,\
            groupkey,\
            COUNT(*) AS ready_child_lines,\
            SUM(GREATEST(0, qty - qty_shiprecv)) AS ready_child_remaining,\
            LISTAGG(item_sku, ', ') WITHIN GROUP (ORDER BY item_sku) AS ready_child_skus\
          FROM base\
          WHERE\
            is_child = 'T'\
            AND isclosed = 'F'\
            " +
      serialClause +
      "\
            AND qty_committed > 0\
            AND qty_backordered = 0\
            AND qty_picked = 0\
            AND GREATEST(0, qty - qty_shiprecv) > 0\
            AND item_paid_flag = 'T'\
          GROUP BY so_id, groupkey\
        ), headers AS (\
          SELECT\
            b.so_id,\
            b.so_tranid,\
            b.customer_name,\
            b.so_line AS header_so_line,\
            b.item_id AS header_item_id,\
            b.item_sku AS header_sku,\
            b.item_name AS header_name,\
            b.itemtype AS header_itemtype,\
            b.qty AS header_qty,\
            GREATEST(0, b.qty - b.qty_shiprecv) AS header_remaining,\
            b.groupkey\
          FROM base b\
          WHERE\
            b.is_child = 'F'\
            AND b.isclosed = 'F'\
        )\
        SELECT\
          h.so_id,\
          h.so_tranid,\
          h.customer_name,\
          h.header_so_line,\
          h.header_sku,\
          h.header_name,\
          h.header_itemtype,\
          h.header_qty,\
          h.header_remaining,\
          rc.ready_child_lines,\
          rc.ready_child_remaining,\
          rc.ready_child_skus\
        FROM headers h\
        JOIN ready_children rc\
          ON rc.so_id = h.so_id\
         AND rc.groupkey = h.groupkey\
        WHERE h.header_remaining > 0\
        ORDER BY h.so_id, h.header_so_line";

    return query.runSuiteQL({ query: sql }).asMappedResults() || [];
  }

  function filterBySku(rows, sku) {
    sku = normalizeSku(sku);
    if (!sku) return rows;
    var target = sku.toLowerCase();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var s = normalizeSku(r.header_sku).toLowerCase();
      if (s === target) out.push(r);
    }
    return out;
  }

  function buildSkuOptions(allRows) {
    var map = {};
    for (var i = 0; i < allRows.length; i++) {
      var s = normalizeSku(allRows[i].header_sku);
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

  function modeLabel(mode) {
    mode = normalizeMode(mode);
    if (mode === "serial") return "Serialized only";
    if (mode === "nonserial") return "Non-serialized only";
    return "All";
  }

  function writeCsv(ctx, rows, selectedSku, serialMode) {
    var header = [
      "SO #",
      "Customer",
      "Header SKU",
      "Header Name",
      "Header Type",
      "Ready Child Lines",
      "Ready Child SKUs",
    ];

    var lines = [];
    lines.push(header.map(csvEscape).join(","));

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push(
        [
          r.so_tranid || "",
          r.customer_name || "",
          r.header_sku || "",
          r.header_name || "",
          r.header_itemtype || "",
          Number(r.ready_child_lines || 0),
          r.ready_child_skus || "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    var filename =
      "soft_bom_headers_ready_children_" +
      "child_" +
      normalizeMode(serialMode) +
      "_" +
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

  function writeXls(ctx, rows, selectedSku, serialMode) {
    var header = [
      "SO #",
      "Customer",
      "Header SKU",
      "Header Name",
      "Header Type",
      "Ready Child Lines",
      "Ready Child SKUs",
    ];

    var filename =
      "soft_bom_headers_ready_children_" +
      "child_" +
      normalizeMode(serialMode) +
      "_" +
      (selectedSku ? "sku_" + selectedSku + "_" : "") +
      nowStamp() +
      ".xls";

    var css =
      "table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;}" +
      "th,td{border:1px solid #000;padding:6px;vertical-align:top;}" +
      "th{font-weight:700;background:#f2f2f2;}";

    var out = [];
    out.push(
      '<html><head><meta charset="UTF-8"><style>' +
        css +
        "</style></head><body><table>"
    );
    out.push(
      "<tr>" +
        header.map((h) => "<th>" + htmlEscape(h) + "</th>").join("") +
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
          htmlEscape(r.header_sku || "") +
          "</td>" +
          "<td>" +
          htmlEscape(r.header_name || "") +
          "</td>" +
          "<td>" +
          htmlEscape(r.header_itemtype || "") +
          "</td>" +
          "<td>" +
          htmlEscape(Number(r.ready_child_lines || 0)) +
          "</td>" +
          "<td>" +
          htmlEscape(r.ready_child_skus || "") +
          "</td>" +
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
      var serialMode = normalizeMode(
        ctx.request.parameters.custpage_serialmode || SERIAL_MODE_DEFAULT
      );

      var scriptObj = runtime.getCurrentScript();
      var params = {};
      if (chosen) params.sku = chosen;
      if (serialMode) params.serialmode = serialMode;

      redirect.toSuitelet({
        scriptId: scriptObj.id,
        deploymentId: scriptObj.deploymentId,
        parameters: params,
      });
      return;
    }

    var params = ctx.request.parameters || {};
    var exportType = String(params.export || "").toLowerCase();
    var wantsCsv = exportType === "csv";
    var wantsXls = exportType === "xls";
    var selectedSku = normalizeSku(params.sku || "");
    var serialMode = normalizeMode(params.serialmode || SERIAL_MODE_DEFAULT);

    var allRows = runSoftBomReportRows(serialMode);
    var rows = filterBySku(allRows, selectedSku);

    if (wantsCsv) return writeCsv(ctx, rows, selectedSku, serialMode);
    if (wantsXls) return writeXls(ctx, rows, selectedSku, serialMode);

    var soSet = {};
    var totalReadyLines = 0;
    var totalReadyRemaining = 0;

    for (var i = 0; i < rows.length; i++) {
      soSet[rows[i].so_id] = true;
      totalReadyLines += Number(rows[i].ready_child_lines || 0);
      totalReadyRemaining += Number(rows[i].ready_child_remaining || 0);
    }

    var form = serverWidget.createForm({
      title: "Soft BOM Headers (Ready Child Lines) — " + modeLabel(serialMode),
    });

    var skuField = form.addField({
      id: "custpage_sku",
      type: serverWidget.FieldType.SELECT,
      label: "Header SKU",
    });
    skuField.addSelectOption({ value: "", text: "All Header SKUs" });

    var skuOptions = buildSkuOptions(allRows);
    for (var j = 0; j < skuOptions.length; j++) {
      skuField.addSelectOption({ value: skuOptions[j], text: skuOptions[j] });
    }
    skuField.defaultValue = selectedSku;

    var modeField = form.addField({
      id: "custpage_serialmode",
      type: serverWidget.FieldType.SELECT,
      label: "Child Items",
    });
    modeField.addSelectOption({ value: "serial", text: "Serialized only" });
    modeField.addSelectOption({
      value: "nonserial",
      text: "Non-serialized only",
    });
    modeField.addSelectOption({ value: "all", text: "All" });
    modeField.defaultValue = serialMode;

    form.addSubmitButton({ label: "Apply Filters" });

    var scriptObj2 = runtime.getCurrentScript();

    var exportParamsCsv = { export: "csv", serialmode: serialMode };
    if (selectedSku) exportParamsCsv.sku = selectedSku;

    var exportParamsXls = { export: "xls", serialmode: serialMode };
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
      "<div>Header SKU Filter: <b>" +
      (selectedSku ? htmlEscape(selectedSku) : "All") +
      "</b></div>" +
      "<div>Child Items: <b>" +
      htmlEscape(modeLabel(serialMode)) +
      "</b></div>" +
      "<div>Total Header Lines: <b>" +
      rows.length +
      "</b></div>" +
      "<div>Distinct SOs: <b>" +
      Object.keys(soSet).length +
      "</b></div>" +
      "<div>Total READY child lines: <b>" +
      totalReadyLines +
      "</b> &nbsp;|&nbsp; Total READY child remaining: <b>" +
      totalReadyRemaining +
      "</b></div>" +
      "</div>" +
      '<div style="padding-top:2px;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">' +
      '<a target="_blank" rel="noopener noreferrer" href="' +
      exportUrlXls +
      '" style="display:inline-block;background:#0b5cab;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:800;box-shadow:0 4px 10px rgba(0,0,0,0.15);">Export Excel</a>' +
      '<a target="_blank" rel="noopener noreferrer" href="' +
      exportUrlCsv +
      '" style="display:inline-block;background:#2b6cb0;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;box-shadow:0 4px 10px rgba(0,0,0,0.15);">Export CSV</a>' +
      "</div></div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "Soft BOM Header Lines",
    });

    sub.addField({
      id: "col_so",
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
      label: "Header SO Line ID",
    });
    sub.addField({
      id: "col_sku",
      type: serverWidget.FieldType.TEXT,
      label: "Header SKU",
    });
    sub.addField({
      id: "col_name",
      type: serverWidget.FieldType.TEXT,
      label: "Header Name",
    });
    sub.addField({
      id: "col_type",
      type: serverWidget.FieldType.TEXT,
      label: "Header Type",
    });

    sub.addField({
      id: "col_ready_lines",
      type: serverWidget.FieldType.INTEGER,
      label: "Ready Child Lines",
    });

    sub.addField({
      id: "col_ready_skus",
      type: serverWidget.FieldType.TEXT,
      label: "Ready Child SKUs",
    });

    for (var k = 0; k < rows.length; k++) {
      var rr = rows[k];
      var soUrl = url.resolveRecord({
        recordType: "salesorder",
        recordId: rr.so_id,
        isEditMode: false,
      });

      if (rr.so_tranid)
        sub.setSublistValue({
          id: "col_so",
          line: k,
          value: String(rr.so_tranid),
        });
      if (soUrl)
        sub.setSublistValue({ id: "col_so_link", line: k, value: soUrl });
      if (rr.customer_name)
        sub.setSublistValue({
          id: "col_customer",
          line: k,
          value: String(rr.customer_name),
        });

      sub.setSublistValue({
        id: "col_line",
        line: k,
        value: String(Number(rr.header_so_line || 0)),
      });

      if (rr.header_sku)
        sub.setSublistValue({
          id: "col_sku",
          line: k,
          value: String(rr.header_sku),
        });
      if (rr.header_name)
        sub.setSublistValue({
          id: "col_name",
          line: k,
          value: String(rr.header_name),
        });
      if (rr.header_itemtype)
        sub.setSublistValue({
          id: "col_type",
          line: k,
          value: String(rr.header_itemtype),
        });

      sub.setSublistValue({
        id: "col_ready_lines",
        line: k,
        value: String(Number(rr.ready_child_lines || 0)),
      });

      if (rr.ready_child_skus)
        sub.setSublistValue({
          id: "col_ready_skus",
          line: k,
          value: String(rr.ready_child_skus),
        });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
