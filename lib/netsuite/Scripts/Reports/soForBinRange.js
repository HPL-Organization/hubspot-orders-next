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
  // ---- Config defaults (change if you want) ----
  var DEFAULT_SKU = "Model CB8V-110W"; // item.itemid
  var DEFAULT_SERIAL_START = "10634";
  var DEFAULT_SERIAL_END = "10708";

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

  function normalizeSerial(s) {
    // keep only digits (safe + avoids SQL weirdness)
    var x = String(s || "")
      .trim()
      .replace(/[^\d]/g, "");
    return x;
  }

  function sqlStringLiteral(s) {
    return "'" + String(s || "").replace(/'/g, "''") + "'";
  }

  function runRows(params) {
    var sku = normalizeSku(params.sku) || DEFAULT_SKU;
    var serialStart =
      normalizeSerial(params.serialStart) || DEFAULT_SERIAL_START;
    var serialEnd = normalizeSerial(params.serialEnd) || DEFAULT_SERIAL_END;
    var mode = String(params.mode || "so").toLowerCase(); // "so" | "detail"

    var startNum = Number(serialStart);
    var endNum = Number(serialEnd);

    if (!isFinite(startNum) || !isFinite(endNum)) {
      startNum = Number(DEFAULT_SERIAL_START);
      endNum = Number(DEFAULT_SERIAL_END);
    }
    if (startNum > endNum) {
      var t = startNum;
      startNum = endNum;
      endNum = t;
    }

    var skuLit = sqlStringLiteral(sku);

    var sql = [
      "WITH base AS (",
      "  SELECT",
      "    so.id                                        AS so_id,",
      "    so.tranid                                    AS so_tranid,",
      "    COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,",
      "    f.id                                         AS if_id,",
      "    f.tranid                                     AS if_tranid,",
      "    f.trandate                                   AS if_date,",
      "    i.itemid                                     AS item_sku,",
      "    COALESCE(i.displayname, i.itemid)            AS item_name,",
      "    invn.inventorynumber                         AS serial_raw",
      "  FROM transaction f",
      "  JOIN transactionline fl ON f.id = fl.transaction",
      "  JOIN item i ON fl.item = i.id",
      "  JOIN inventoryassignment ia ON ia.transactionline = fl.id",
      "  JOIN inventorynumber invn ON invn.id = ia.inventorynumber",
      "  JOIN transaction so ON fl.createdfrom = so.id",
      "  LEFT JOIN customer c ON so.entity = c.id",
      "  WHERE f.type = 'ItemShip'",
      "    AND so.type = 'SalesOrd'",
      "    AND fl.mainline = 'F'",
      "    AND i.itemid = " + skuLit,
      "),",
      "filt AS (",
      "  SELECT",
      "    so_id, so_tranid, customer_name,",
      "    if_id, if_tranid, if_date,",
      "    item_sku, item_name,",
      "    serial_raw,",
      "    REGEXP_REPLACE(serial_raw, '[^0-9]', '') AS serial_digits,",
      "    CASE",
      "      WHEN LENGTH(REGEXP_REPLACE(serial_raw, '[^0-9]', '')) > 0",
      "        THEN TO_NUMBER(REGEXP_REPLACE(serial_raw, '[^0-9]', ''))",
      "      ELSE NULL",
      "    END AS serial_num",
      "  FROM base",
      "  WHERE serial_raw IS NOT NULL",
      "),",
      "rng AS (",
      "  SELECT *",
      "  FROM filt",
      "  WHERE serial_num BETWEEN " +
        String(startNum) +
        " AND " +
        String(endNum),
      "    AND serial_digits IS NOT NULL",
      "    AND LENGTH(serial_digits) > 0",
      "),",
      // Dedupe serials per SO (so T110634 and 110634 collapse into 110634)
      "serial_dedup AS (",
      "  SELECT",
      "    so_id, so_tranid, customer_name,",
      "    serial_digits,",
      "    MIN(serial_num) AS serial_num",
      "  FROM rng",
      "  GROUP BY so_id, so_tranid, customer_name, serial_digits",
      "),",
      // Dates per SO
      "so_dates AS (",
      "  SELECT",
      "    so_id, so_tranid, customer_name,",
      "    MIN(if_date) AS first_fulfillment_date,",
      "    MAX(if_date) AS last_fulfillment_date",
      "  FROM rng",
      "  GROUP BY so_id, so_tranid, customer_name",
      ")",
    ].join("\n");

    var finalSql;

    if (mode === "detail") {
      finalSql = [
        sql,
        "SELECT",
        "  so_id, so_tranid, customer_name,",
        "  if_id, if_tranid, TO_CHAR(if_date,'YYYY-MM-DD') AS if_date,",
        "  item_sku, item_name,",
        "  serial_raw AS serial_number",
        "FROM rng",
        "ORDER BY so_tranid, if_date, serial_num",
      ].join("\n");
    } else {
      finalSql = [
        sql,
        "SELECT",
        "  d.so_id,",
        "  d.so_tranid,",
        "  d.customer_name,",
        "  COUNT(s.serial_digits) AS serial_count,",
        "  TO_CHAR(d.first_fulfillment_date,'YYYY-MM-DD') AS first_fulfillment_date,",
        "  TO_CHAR(d.last_fulfillment_date,'YYYY-MM-DD') AS last_fulfillment_date,",
        "  LISTAGG(s.serial_digits, ', ') WITHIN GROUP (ORDER BY s.serial_num) AS serial_numbers",
        "FROM so_dates d",
        "JOIN serial_dedup s",
        "  ON s.so_id = d.so_id",
        "GROUP BY d.so_id, d.so_tranid, d.customer_name, d.first_fulfillment_date, d.last_fulfillment_date",
        "ORDER BY d.so_tranid",
      ].join("\n");
    }

    return query.runSuiteQL({ query: finalSql }).asMappedResults() || [];
  }

  function writeCsv(ctx, rows, params) {
    var mode = String(params.mode || "so").toLowerCase();

    var header =
      mode === "detail"
        ? [
            "SO #",
            "Customer",
            "Fulfillment #",
            "Fulfillment Date",
            "SKU",
            "Item Name",
            "Serial Number",
          ]
        : [
            "SO #",
            "Customer",
            "Serial Count",
            "First Fulfillment Date",
            "Last Fulfillment Date",
            "Serial Numbers",
          ];

    var lines = [];
    lines.push(header.map(csvEscape).join(","));

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var line =
        mode === "detail"
          ? [
              r.so_tranid || "",
              r.customer_name || "",
              r.if_tranid || "",
              r.if_date || "",
              r.item_sku || "",
              r.item_name || "",
              r.serial_number || "",
            ]
          : [
              r.so_tranid || "",
              r.customer_name || "",
              Number(r.serial_count || 0),
              r.first_fulfillment_date || "",
              r.last_fulfillment_date || "",
              r.serial_numbers || "",
            ];
      lines.push(line.map(csvEscape).join(","));
    }

    var filename =
      "serial_so_report_" +
      "sku_" +
      (normalizeSku(params.sku) || DEFAULT_SKU).replace(/[^\w\-]+/g, "_") +
      "_" +
      "serial_" +
      (normalizeSerial(params.serialStart) || DEFAULT_SERIAL_START) +
      "-" +
      (normalizeSerial(params.serialEnd) || DEFAULT_SERIAL_END) +
      "_" +
      (mode === "detail" ? "detail_" : "so_") +
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

  function writeXls(ctx, rows, params) {
    var mode = String(params.mode || "so").toLowerCase();

    var header =
      mode === "detail"
        ? [
            "SO #",
            "Customer",
            "Fulfillment #",
            "Fulfillment Date",
            "SKU",
            "Item Name",
            "Serial Number",
          ]
        : [
            "SO #",
            "Customer",
            "Serial Count",
            "First Fulfillment Date",
            "Last Fulfillment Date",
            "Serial Numbers",
          ];

    var filename =
      "serial_so_report_" +
      "sku_" +
      (normalizeSku(params.sku) || DEFAULT_SKU).replace(/[^\w\-]+/g, "_") +
      "_" +
      "serial_" +
      (normalizeSerial(params.serialStart) || DEFAULT_SERIAL_START) +
      "-" +
      (normalizeSerial(params.serialEnd) || DEFAULT_SERIAL_END) +
      "_" +
      (mode === "detail" ? "detail_" : "so_") +
      nowStamp() +
      ".xls";

    var css =
      "table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;}" +
      "th,td{border:1px solid #000;padding:6px;vertical-align:top;}" +
      "th{font-weight:700;background:#f2f2f2;}" +
      "th.serials,td.serials{min-width:340px;}" +
      "th.customer,td.customer{min-width:220px;}" +
      "th.so,td.so{min-width:90px;}";

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
            var cls =
              h === "Serial Numbers"
                ? ' class="serials"'
                : h === "Customer"
                ? ' class="customer"'
                : h === "SO #"
                ? ' class="so"'
                : "";
            return "<th" + cls + ">" + htmlEscape(h) + "</th>";
          })
          .join("") +
        "</tr>"
    );

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var cols =
        mode === "detail"
          ? [
              r.so_tranid || "",
              r.customer_name || "",
              r.if_tranid || "",
              r.if_date || "",
              r.item_sku || "",
              r.item_name || "",
              r.serial_number || "",
            ]
          : [
              r.so_tranid || "",
              r.customer_name || "",
              Number(r.serial_count || 0),
              r.first_fulfillment_date || "",
              r.last_fulfillment_date || "",
              r.serial_numbers || "",
            ];

      out.push(
        "<tr>" +
          cols
            .map(function (v, idx) {
              var h = header[idx];
              var cls =
                h === "Serial Numbers"
                  ? ' class="serials"'
                  : h === "Customer"
                  ? ' class="customer"'
                  : h === "SO #"
                  ? ' class="so"'
                  : "";
              return "<td" + cls + ">" + htmlEscape(v) + "</td>";
            })
            .join("") +
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
    var req = ctx.request;
    var params = req.parameters || {};

    if (req.method === "POST") {
      var scriptObj = runtime.getCurrentScript();

      var sku = normalizeSku(params.custpage_sku) || DEFAULT_SKU;
      var serialStart =
        normalizeSerial(params.custpage_serial_start) || DEFAULT_SERIAL_START;
      var serialEnd =
        normalizeSerial(params.custpage_serial_end) || DEFAULT_SERIAL_END;
      var mode = String(params.custpage_mode || "so").toLowerCase();

      redirect.toSuitelet({
        scriptId: scriptObj.id,
        deploymentId: scriptObj.deploymentId,
        parameters: {
          sku: sku,
          serialStart: serialStart,
          serialEnd: serialEnd,
          mode: mode,
        },
      });
      return;
    }

    var exportType = String(params.export || "").toLowerCase();
    var wantsCsv = exportType === "csv";
    var wantsXls = exportType === "xls";

    var sku = normalizeSku(params.sku) || DEFAULT_SKU;
    var serialStart =
      normalizeSerial(params.serialStart) || DEFAULT_SERIAL_START;
    var serialEnd = normalizeSerial(params.serialEnd) || DEFAULT_SERIAL_END;
    var mode = String(params.mode || "so").toLowerCase();

    var rows = runRows({
      sku: sku,
      serialStart: serialStart,
      serialEnd: serialEnd,
      mode: mode,
    });

    if (wantsCsv) {
      writeCsv(ctx, rows, {
        sku: sku,
        serialStart: serialStart,
        serialEnd: serialEnd,
        mode: mode,
      });
      return;
    }
    if (wantsXls) {
      writeXls(ctx, rows, {
        sku: sku,
        serialStart: serialStart,
        serialEnd: serialEnd,
        mode: mode,
      });
      return;
    }

    // Summary counts
    var distinctSO = {};
    var distinctSerial = {};
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].so_id) distinctSO[rows[i].so_id] = true;
      if (mode === "detail" && rows[i].serial_number)
        distinctSerial[rows[i].serial_number] = true;
      if (mode === "so" && rows[i].serial_numbers) {
        // in SO mode, serial_numbers is already aggregated; count can be derived from serial_count
      }
    }

    var form = serverWidget.createForm({
      title: "SO Report by Serial Range (Serialized Item)",
    });

    var skuField = form.addField({
      id: "custpage_sku",
      type: serverWidget.FieldType.TEXT,
      label: "SKU (itemid)",
    });
    skuField.defaultValue = sku;

    var startField = form.addField({
      id: "custpage_serial_start",
      type: serverWidget.FieldType.TEXT,
      label: "Serial Start",
    });
    startField.defaultValue = serialStart;

    var endField = form.addField({
      id: "custpage_serial_end",
      type: serverWidget.FieldType.TEXT,
      label: "Serial End",
    });
    endField.defaultValue = serialEnd;

    var modeField = form.addField({
      id: "custpage_mode",
      type: serverWidget.FieldType.SELECT,
      label: "View",
    });
    modeField.addSelectOption({
      value: "so",
      text: "SO Summary (1 row per SO)",
    });
    modeField.addSelectOption({
      value: "detail",
      text: "Serial Detail (1 row per serial)",
    });
    modeField.defaultValue = mode;

    form.addSubmitButton({ label: "Run Report" });

    // Export links
    var scriptObj2 = runtime.getCurrentScript();
    var exportParamsBase = {
      sku: sku,
      serialStart: serialStart,
      serialEnd: serialEnd,
      mode: mode,
    };

    var exportUrlCsv = url.resolveScript({
      scriptId: scriptObj2.id,
      deploymentId: scriptObj2.deploymentId,
      params: (function () {
        var p = {};
        for (var k in exportParamsBase) p[k] = exportParamsBase[k];
        p.export = "csv";
        return p;
      })(),
    });

    var exportUrlXls = url.resolveScript({
      scriptId: scriptObj2.id,
      deploymentId: scriptObj2.deploymentId,
      params: (function () {
        var p = {};
        for (var k in exportParamsBase) p[k] = exportParamsBase[k];
        p.export = "xls";
        return p;
      })(),
    });

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    summary.defaultValue =
      '<div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin:8px 0 16px;">' +
      '<div style="padding:12px 14px;border-radius:10px;background:#112e51;color:#fff;font-size:14px;line-height:1.6;font-weight:600;box-shadow:0 4px 10px rgba(0,0,0,0.15);flex:1;">' +
      "<div>SKU: <b>" +
      htmlEscape(sku) +
      "</b></div>" +
      "<div>Serial Range: <b>" +
      htmlEscape(serialStart) +
      "–" +
      htmlEscape(serialEnd) +
      "</b></div>" +
      "<div>View: <b>" +
      htmlEscape(mode === "detail" ? "Serial Detail" : "SO Summary") +
      "</b></div>" +
      "<div>Total Rows: <b>" +
      rows.length +
      "</b></div>" +
      "<div>Distinct SOs: <b>" +
      Object.keys(distinctSO).length +
      "</b></div>" +
      (mode === "detail"
        ? "<div>Distinct Serials: <b>" +
          Object.keys(distinctSerial).length +
          "</b></div>"
        : "") +
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

    if (mode === "detail") {
      var sub = form.addSublist({
        id: "custpage_lines",
        type: serverWidget.SublistType.LIST,
        label: "Serial Detail (Item Fulfillments → Serial → SO)",
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
        id: "col_if_tranid",
        type: serverWidget.FieldType.TEXT,
        label: "Fulfillment #",
      });
      sub.addField({
        id: "col_if_link",
        type: serverWidget.FieldType.URL,
        label: "Open Fulfillment",
      });
      sub.addField({
        id: "col_if_date",
        type: serverWidget.FieldType.TEXT,
        label: "Fulfillment Date",
      });
      sub.addField({
        id: "col_sku",
        type: serverWidget.FieldType.TEXT,
        label: "SKU",
      });
      sub.addField({
        id: "col_item",
        type: serverWidget.FieldType.TEXT,
        label: "Item Name",
      });
      sub.addField({
        id: "col_serial",
        type: serverWidget.FieldType.TEXT,
        label: "Serial Number",
      });

      for (var r = 0; r < rows.length; r++) {
        var rr = rows[r];

        var soUrl = url.resolveRecord({
          recordType: "salesorder",
          recordId: rr.so_id,
          isEditMode: false,
        });

        var ifUrl = url.resolveRecord({
          recordType: "itemfulfillment",
          recordId: rr.if_id,
          isEditMode: false,
        });

        if (rr.so_tranid)
          sub.setSublistValue({
            id: "col_so_tranid",
            line: r,
            value: String(rr.so_tranid),
          });
        if (soUrl)
          sub.setSublistValue({ id: "col_so_link", line: r, value: soUrl });

        if (rr.customer_name)
          sub.setSublistValue({
            id: "col_customer",
            line: r,
            value: String(rr.customer_name),
          });

        if (rr.if_tranid)
          sub.setSublistValue({
            id: "col_if_tranid",
            line: r,
            value: String(rr.if_tranid),
          });
        if (ifUrl)
          sub.setSublistValue({ id: "col_if_link", line: r, value: ifUrl });

        if (rr.if_date)
          sub.setSublistValue({
            id: "col_if_date",
            line: r,
            value: String(rr.if_date),
          });

        if (rr.item_sku)
          sub.setSublistValue({
            id: "col_sku",
            line: r,
            value: String(rr.item_sku),
          });

        if (rr.item_name)
          sub.setSublistValue({
            id: "col_item",
            line: r,
            value: String(rr.item_name),
          });

        if (rr.serial_number)
          sub.setSublistValue({
            id: "col_serial",
            line: r,
            value: String(rr.serial_number),
          });
      }
    } else {
      var sub2 = form.addSublist({
        id: "custpage_sos",
        type: serverWidget.SublistType.LIST,
        label: "SO Summary (SOs that used serials in range)",
      });

      sub2.addField({
        id: "col_so_tranid",
        type: serverWidget.FieldType.TEXT,
        label: "SO #",
      });
      sub2.addField({
        id: "col_so_link",
        type: serverWidget.FieldType.URL,
        label: "Open SO",
      });
      sub2.addField({
        id: "col_customer",
        type: serverWidget.FieldType.TEXT,
        label: "Customer",
      });
      sub2.addField({
        id: "col_serial_count",
        type: serverWidget.FieldType.INTEGER,
        label: "Serial Count",
      });
      sub2.addField({
        id: "col_first",
        type: serverWidget.FieldType.TEXT,
        label: "First Fulfillment Date",
      });
      sub2.addField({
        id: "col_last",
        type: serverWidget.FieldType.TEXT,
        label: "Last Fulfillment Date",
      });
      sub2.addField({
        id: "col_serials",
        type: serverWidget.FieldType.TEXTAREA,
        label: "Serial Numbers",
      });

      for (var s = 0; s < rows.length; s++) {
        var row = rows[s];

        var soUrl2 = url.resolveRecord({
          recordType: "salesorder",
          recordId: row.so_id,
          isEditMode: false,
        });

        if (row.so_tranid)
          sub2.setSublistValue({
            id: "col_so_tranid",
            line: s,
            value: String(row.so_tranid),
          });
        if (soUrl2)
          sub2.setSublistValue({ id: "col_so_link", line: s, value: soUrl2 });

        if (row.customer_name)
          sub2.setSublistValue({
            id: "col_customer",
            line: s,
            value: String(row.customer_name),
          });

        sub2.setSublistValue({
          id: "col_serial_count",
          line: s,
          value: String(Number(row.serial_count || 0)),
        });

        if (row.first_fulfillment_date)
          sub2.setSublistValue({
            id: "col_first",
            line: s,
            value: String(row.first_fulfillment_date),
          });

        if (row.last_fulfillment_date)
          sub2.setSublistValue({
            id: "col_last",
            line: s,
            value: String(row.last_fulfillment_date),
          });

        if (row.serial_numbers)
          sub2.setSublistValue({
            id: "col_serials",
            line: s,
            value: String(row.serial_numbers),
          });
      }
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
