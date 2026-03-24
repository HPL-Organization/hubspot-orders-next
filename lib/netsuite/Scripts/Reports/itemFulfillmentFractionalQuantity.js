/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/query", "N/url", "N/log"], function (
  serverWidget,
  query,
  url,
  log
) {
  function csvEscape(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    if (s.indexOf('"') !== -1) s = s.replace(/"/g, '""');
    if (s.search(/["\,\n\r]/) !== -1) s = '"' + s + '"';
    return s;
  }

  function toCsv(rows) {
    var headers = [
      "IF Internal ID",
      "IF #",
      "IF Date",
      "IF Status",
      "SO Internal ID",
      "SO #",
      "Customer",
      "IF Line ID",
      "SKU",
      "Item Name",
      "Qty",
    ];

    var out = [];
    out.push(headers.join(","));

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push(
        [
          csvEscape(r.if_id),
          csvEscape(r.if_tranid),
          csvEscape(r.if_date),
          csvEscape(r.if_status_text),
          csvEscape(r.so_id),
          csvEscape(r.so_tranid),
          csvEscape(r.customer_name),
          csvEscape(r.if_line_id),
          csvEscape(r.item_sku),
          csvEscape(r.item_name),
          csvEscape(r.qty_abs),
        ].join(",")
      );
    }

    return out.join("\n");
  }

  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    var params = ctx.request.parameters || {};
    var wantCsv =
      String(params.csv || "").toLowerCase() === "1" ||
      String(params.csv || "").toLowerCase() === "t" ||
      String(params.csv || "").toLowerCase() === "true";

    var sql =
      "\
      WITH base AS (\
        SELECT\
          f.id                                        AS if_id,\
          f.tranid                                    AS if_tranid,\
          f.trandate                                  AS if_date,\
          f.status                                    AS if_status,\
          BUILTIN.DF(f.status)                        AS if_status_text,\
          f.entity                                    AS customer_id,\
          COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,\
          tlm.createdfrom                             AS so_id,\
          so.tranid                                   AS so_tranid,\
          l.id                                        AS if_line_id,\
          l.item                                      AS item_id,\
          i.itemid                                    AS item_sku,\
          COALESCE(i.displayname, i.itemid)           AS item_name,\
          ABS(NVL(l.quantity,0))                      AS qty_abs\
        FROM transaction f\
        JOIN transactionline tlm\
          ON tlm.transaction = f.id\
         AND tlm.mainline = 'T'\
        JOIN transactionline l\
          ON l.transaction = f.id\
         AND l.mainline = 'F'\
        LEFT JOIN transaction so\
          ON so.id = tlm.createdfrom\
        LEFT JOIN item i\
          ON i.id = l.item\
        LEFT JOIN customer c\
          ON f.entity = c.id\
        WHERE f.type = 'ItemShip'\
          AND BUILTIN.DF(f.status) LIKE '%Picked%'\
          AND NVL(l.taxline,'F') = 'F'\
          AND NVL(l.isclosed,'F') = 'F'\
          AND l.item IS NOT NULL\
      ), elig AS (\
        SELECT *\
        FROM base\
        WHERE qty_abs <> 0\
          AND qty_abs <> TRUNC(qty_abs)\
      )\
      SELECT *\
      FROM elig\
      ORDER BY if_id, if_line_id";

    var rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];

    if (wantCsv) {
      var csv = toCsv(rows);
      ctx.response.setHeader({
        name: "Content-Type",
        value: "text/csv; charset=utf-8",
      });
      ctx.response.setHeader({
        name: "Content-Disposition",
        value:
          'attachment; filename="picked_item_fulfillments_fractional_qty.csv"',
      });
      ctx.response.write(csv);
      return;
    }

    var ifSet = {};
    var soSet = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      ifSet[r.if_id] = true;
      if (r.so_id) soSet[r.so_id] = true;
    }

    var form = serverWidget.createForm({
      title: "Picked Item Fulfillments: Fractional Qty Lines",
    });

    var csvUrl =
      (function () {
        var u = ctx.request.url || "";
        if (!u) return "";
        if (u.indexOf("?") === -1) return u + "?csv=1";
        return u + "&csv=1";
      })() || "";

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    summary.defaultValue =
      '<div style="margin:8px 0 16px;padding:12px 14px;border-radius:10px;' +
      "background:#112e51;color:#fff;font-size:14px;line-height:1.6;font-weight:600;" +
      'box-shadow:0 4px 10px rgba(0,0,0,0.15)">' +
      "<div>Fractional-qty lines: <b>" +
      rows.length +
      "</b></div>" +
      "<div>Distinct Item Fulfillments: <b>" +
      Object.keys(ifSet).length +
      "</b></div>" +
      "<div>Distinct Sales Orders: <b>" +
      Object.keys(soSet).length +
      "</b></div>" +
      (csvUrl
        ? '<div style="margin-top:10px;"><a style="color:#fff;text-decoration:underline;" href="' +
          csvUrl +
          '">Download CSV</a></div>'
        : "") +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "Picked IF Lines with Non-Whole Qty",
    });

    sub.addField({
      id: "col_if_tranid",
      type: serverWidget.FieldType.TEXT,
      label: "IF #",
    });
    sub.addField({
      id: "col_if_link",
      type: serverWidget.FieldType.URL,
      label: "Open IF",
    });
    sub.addField({
      id: "col_if_date",
      type: serverWidget.FieldType.DATE,
      label: "Date",
    });
    sub.addField({
      id: "col_if_status",
      type: serverWidget.FieldType.TEXT,
      label: "Status",
    });

    sub.addField({
      id: "col_so_tranid",
      type: serverWidget.FieldType.TEXT,
      label: "Created From (SO #)",
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
      id: "col_if_line",
      type: serverWidget.FieldType.INTEGER,
      label: "IF Line ID",
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
      type: serverWidget.FieldType.TEXT,
      label: "Qty",
    });

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];

      var ifUrl = url.resolveRecord({
        recordType: "itemfulfillment",
        recordId: r.if_id,
        isEditMode: false,
      });

      var soUrl = r.so_id
        ? url.resolveRecord({
            recordType: "salesorder",
            recordId: r.so_id,
            isEditMode: false,
          })
        : "";

      if (r.if_tranid)
        sub.setSublistValue({
          id: "col_if_tranid",
          line: i,
          value: String(r.if_tranid),
        });
      if (ifUrl)
        sub.setSublistValue({ id: "col_if_link", line: i, value: ifUrl });

      if (r.if_date)
        sub.setSublistValue({
          id: "col_if_date",
          line: i,
          value: String(r.if_date),
        });

      if (r.if_status_text)
        sub.setSublistValue({
          id: "col_if_status",
          line: i,
          value: String(r.if_status_text),
        });

      if (r.so_tranid)
        sub.setSublistValue({
          id: "col_so_tranid",
          line: i,
          value: String(r.so_tranid),
        });
      if (soUrl)
        sub.setSublistValue({ id: "col_so_link", line: i, value: soUrl });

      if (r.customer_name)
        sub.setSublistValue({
          id: "col_customer",
          line: i,
          value: String(r.customer_name),
        });

      sub.setSublistValue({
        id: "col_if_line",
        line: i,
        value: String(Number(r.if_line_id || 0)),
      });

      if (r.item_sku)
        sub.setSublistValue({
          id: "col_item_sku",
          line: i,
          value: String(r.item_sku),
        });
      if (r.item_name)
        sub.setSublistValue({
          id: "col_item_name",
          line: i,
          value: String(r.item_name),
        });

      sub.setSublistValue({
        id: "col_qty",
        line: i,
        value: String(r.qty_abs),
      });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
