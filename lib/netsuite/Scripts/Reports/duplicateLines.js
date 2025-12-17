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
  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    var sql =
      "\
      SELECT\
        o.id                                   AS so_id,\
        o.tranid                               AS so_tranid,\
        o.trandate                             AS so_trandate,\
        o.entity                               AS customer_id,\
        COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,\
        l.id                                   AS so_line,\
        l.item                                 AS item_id,\
        i.itemid                               AS item_sku,\
        COALESCE(i.displayname, i.itemid)      AS item_name,\
        ABS(NVL(l.quantity,0))                 AS qty,\
        NVL(l.rate,0)                          AS rate\
      FROM transaction o\
      JOIN transactionline l ON o.id = l.transaction\
      LEFT JOIN customer c ON o.entity = c.id\
      LEFT JOIN item i ON l.item = i.id\
      WHERE o.type = 'SalesOrd'\
        AND NVL(l.mainline,'F') = 'F'";

    var rows;
    try {
      rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    } catch (e) {
      log.error("SuiteQL error", e);
      ctx.response.write("Error running SuiteQL: " + e.message);
      return;
    }

    // Group by (so_id, item_id)
    var groups = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.item_id) continue; // skip non-item lines

      var key = r.so_id + "|" + r.item_id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    // Keep only groups where:
    //  - same item appears on SO more than once
    //  - at least one line has rate=0 and qty>0
    // And only include those free lines in the final output
    var filtered = [];
    var soSet = {};
    var groupSet = {};

    Object.keys(groups).forEach(function (key) {
      var lines = groups[key];
      if (lines.length <= 1) return;

      var freeLines = [];
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var qtyNum = Number(l.qty || 0); // already ABS from SQL
        var rateNum = Number(l.rate || 0);
        if (qtyNum > 0 && rateNum === 0) {
          freeLines.push(l);
        }
      }

      if (freeLines.length === 0) return;

      for (var j = 0; j < freeLines.length; j++) {
        filtered.push(freeLines[j]);
      }
      groupSet[key] = true;
      soSet[String(lines[0].so_id)] = true;
    });

    var form = serverWidget.createForm({
      title: "SO Items with Duplicate Lines & Free Qty (rate=0, qty>0)",
    });

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });
    summary.defaultValue =
      '<div style="margin:8px 0 16px;padding:12px 14px;border-radius:10px;' +
      "background:#112e51;color:#fff;font-size:14px;line-height:1.6;font-weight:600;" +
      'box-shadow:0 4px 10px rgba(0,0,0,0.15)">' +
      "<div>Distinct SOs with problem groups: <b>" +
      Object.keys(soSet).length +
      "</b></div>" +
      "<div>SO+Item groups (duplicate item & free qty line): <b>" +
      Object.keys(groupSet).length +
      "</b></div>" +
      "<div>Total free lines (rate=0, qty>0): <b>" +
      filtered.length +
      "</b></div>" +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "Free lines (rate=0, qty>0) on duplicate-item SOs",
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
      type: serverWidget.FieldType.FLOAT,
      label: "Qty",
    });
    sub.addField({
      id: "col_rate",
      type: serverWidget.FieldType.CURRENCY,
      label: "Rate",
    });

    for (var i = 0; i < filtered.length; i++) {
      var r = filtered[i];

      var soUrl = url.resolveRecord({
        recordType: "salesorder",
        recordId: r.so_id,
        isEditMode: false,
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
        id: "col_line",
        line: i,
        value: String(Number(r.so_line || 0)),
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

      var qtyNum = Math.abs(Number(r.qty || 0));
      var rateNum = Number(r.rate || 0);

      sub.setSublistValue({
        id: "col_qty",
        line: i,
        value: String(qtyNum),
      });
      sub.setSublistValue({
        id: "col_rate",
        line: i,
        value: String(rateNum),
      });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
