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

    var sql = `
      WITH lines AS (
        SELECT
          o.id                                   AS so_id,
          o.tranid                               AS so_number,
          o.entity                               AS customer_id,
          COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,
          l.id                                   AS line_id,
          l.item                                 AS item_id,
          i.itemid                               AS item_sku,
          COALESCE(i.displayname, i.itemid)      AS item_name,
          l.location                             AS location_id,
          loc.name                               AS location_name,
          ABS(NVL(l.quantity, 0))                AS qty,
          ABS(NVL(l.quantitycommitted, 0))       AS qty_committed,
          ABS(NVL(l.quantitybackordered, 0))     AS qty_backordered,
          NVL(l.custcol_hpl_itempaid, 'F')       AS item_paid_flag
        FROM transaction o
        JOIN transactionline l       ON o.id = l.transaction
        JOIN customer c              ON o.entity = c.id
        LEFT JOIN item i             ON l.item = i.id
        LEFT JOIN location loc       ON l.location = loc.id
        WHERE o.type = 'SalesOrd'
          AND NVL(l.isclosed,'F') = 'F'
          AND l.itemtype IN ('InvtPart','Assembly','Kit')
          AND l.assemblycomponent = 'F'
          AND l.kitcomponent = 'F'
      ),
      ord AS (
        SELECT
          so_id,
          COUNT(*) AS total_lines,
          SUM(CASE WHEN item_paid_flag = 'T' THEN 1 ELSE 0 END) AS paid_lines,
          SUM(CASE WHEN item_paid_flag = 'F' THEN 1 ELSE 0 END) AS unpaid_lines,
          SUM(CASE WHEN item_paid_flag = 'T' AND qty_committed > 0 AND qty_backordered = 0 THEN 1 ELSE 0 END) AS paid_committed_lines
        FROM lines
        GROUP BY so_id
      )
      SELECT
        l.so_id,
        l.so_number,
        l.customer_id,
        l.customer_name,
        l.line_id,
        l.item_sku,
        l.item_name,
        l.location_id,
        l.location_name,
        l.qty,
        l.qty_committed,
        l.qty_backordered,
        o.total_lines,
        o.paid_lines,
        o.unpaid_lines,
        o.paid_committed_lines
      FROM lines l
      JOIN ord o ON o.so_id = l.so_id
      WHERE
        l.item_paid_flag = 'T'
        AND l.qty_committed > 0
        AND l.qty_backordered = 0
        AND o.paid_lines < o.total_lines         -- not fully paid: truly partial
        AND o.paid_committed_lines >= 1          -- at least one paid+committed line exists
      ORDER BY l.so_id, l.line_id
    `;

    var rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    log.debug({ title: "Rows", details: rows.length });

    var form = serverWidget.createForm({
      title: "Partially Paid SOs with Shippable (Paid + In-Stock) Lines",
    });

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });
    summary.defaultValue =
      '<div style="margin:6px 0 14px;padding:12px 14px;border-radius:10px;' +
      "background:#0b3d2e;color:#fff;font-size:16px;line-height:1.4;font-weight:700;" +
      'box-shadow:0 4px 10px rgba(0,0,0,0.15)">' +
      "Qualified Lines: " +
      rows.length +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "Lines Eligible to Ship (Paid + Committed, No Backorder)",
    });

    sub.addField({
      id: "col_so_number",
      type: serverWidget.FieldType.TEXT,
      label: "ORDER #",
    });
    sub.addField({
      id: "col_customer_name",
      type: serverWidget.FieldType.TEXT,
      label: "CUSTOMER",
    });
    sub.addField({
      id: "col_item_sku",
      type: serverWidget.FieldType.TEXT,
      label: "SKU",
    });
    sub.addField({
      id: "col_item_name",
      type: serverWidget.FieldType.TEXT,
      label: "ITEM NAME",
    });
    sub.addField({
      id: "col_location_name",
      type: serverWidget.FieldType.TEXT,
      label: "LOCATION",
    });
    sub.addField({
      id: "col_qty",
      type: serverWidget.FieldType.INTEGER,
      label: "QTY",
    });
    sub.addField({
      id: "col_qty_committed",
      type: serverWidget.FieldType.INTEGER,
      label: "COMMITTED",
    });
    sub.addField({
      id: "col_qty_backordered",
      type: serverWidget.FieldType.INTEGER,
      label: "BACKORDERED",
    });

    sub.addField({
      id: "col_total_lines",
      type: serverWidget.FieldType.INTEGER,
      label: "TOTAL LINES",
    });
    sub.addField({
      id: "col_paid_lines",
      type: serverWidget.FieldType.INTEGER,
      label: "PAID LINES",
    });
    sub.addField({
      id: "col_unpaid_lines",
      type: serverWidget.FieldType.INTEGER,
      label: "UNPAID LINES",
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

      var soUrl = url.resolveRecord({
        recordType: "salesorder",
        recordId: r.so_id,
        isEditMode: false,
      });
      var custUrl = url.resolveRecord({
        recordType: "customer",
        recordId: r.customer_id,
        isEditMode: false,
      });

      if (r.so_number)
        sub.setSublistValue({
          id: "col_so_number",
          line: i,
          value: String(r.so_number),
        });
      if (r.customer_name)
        sub.setSublistValue({
          id: "col_customer_name",
          line: i,
          value: String(r.customer_name),
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
      if (r.location_name)
        sub.setSublistValue({
          id: "col_location_name",
          line: i,
          value: String(r.location_name),
        });

      sub.setSublistValue({
        id: "col_qty",
        line: i,
        value: String(Number(r.qty || 0)),
      });
      sub.setSublistValue({
        id: "col_qty_committed",
        line: i,
        value: String(Number(r.qty_committed || 0)),
      });
      sub.setSublistValue({
        id: "col_qty_backordered",
        line: i,
        value: String(Number(r.qty_backordered || 0)),
      });

      sub.setSublistValue({
        id: "col_total_lines",
        line: i,
        value: String(Number(r.total_lines || 0)),
      });
      sub.setSublistValue({
        id: "col_paid_lines",
        line: i,
        value: String(Number(r.paid_lines || 0)),
      });
      sub.setSublistValue({
        id: "col_unpaid_lines",
        line: i,
        value: String(Number(r.unpaid_lines || 0)),
      });

      if (soUrl)
        sub.setSublistValue({ id: "col_so_url", line: i, value: soUrl });
      if (custUrl)
        sub.setSublistValue({
          id: "col_customer_url",
          line: i,
          value: custUrl,
        });
    }

    ctx.response.writePage(form);
  }
  return { onRequest: onRequest };
});
