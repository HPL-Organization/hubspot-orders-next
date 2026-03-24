/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/query", "N/url", "N/log"], function (
  serverWidget,
  query,
  url,
  log,
) {
  function toNumStr(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return String(n);
  }

  function escCsv(v) {
    if (v == null) return "";
    var s = String(v);
    if (/[",\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCsv(rows) {
    var headers = [
      "SO ID",
      "ORDER #",
      "ORDER DATE",
      "CUSTOMER ID",
      "CUSTOMER",
      "QUALIFYING LINES",
      "TOTAL QTY",
      "TOTAL COMMITTED",
      "TOTAL BACKORDERED",
      "HAS IF",
      "IF COUNT",
    ];

    var lines = [headers.join(",")];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push(
        [
          escCsv(r.so_id),
          escCsv(r.so_number),
          escCsv(r.order_date),
          escCsv(r.customer_id),
          escCsv(r.customer_name),
          escCsv(r.qualifying_line_count),
          escCsv(r.total_qty),
          escCsv(r.total_qty_committed),
          escCsv(r.total_qty_backordered),
          escCsv(Number(r.if_count || 0) > 0 ? "Yes" : "No"),
          escCsv(r.if_count || 0),
        ].join(","),
      );
    }

    return lines.join("\n");
  }

  function getRows() {
    var sql = `
      WITH excluded_sos AS (
        SELECT DISTINCT o.id AS so_id
        FROM transaction o
        JOIN transactionline l
          ON o.id = l.transaction
        LEFT JOIN item i
          ON l.item = i.id
        WHERE o.type = 'SalesOrd'
          AND NVL(l.isclosed, 'F') = 'F'
          AND l.mainline = 'F'
          AND l.assemblycomponent = 'F'
          AND l.kitcomponent = 'F'
          AND (
            l.itemtype = 'Kit'
            OR NVL(i.isserialitem, 'F') = 'T'
          )
      ),

      order_lines AS (
        SELECT
          o.id AS so_id,
          o.tranid AS so_number,
          o.trandate AS order_date,
          o.foreigntotal AS so_amount,
          o.entity AS customer_id,
          COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,
          ABS(NVL(l.quantity, 0)) AS qty,
          ABS(NVL(l.quantitycommitted, 0)) AS qty_committed,
          ABS(NVL(l.quantitybackordered, 0)) AS qty_backordered
        FROM transaction o
        JOIN transactionline l
          ON o.id = l.transaction
        JOIN customer c
          ON o.entity = c.id
        LEFT JOIN item i
          ON l.item = i.id
        WHERE o.type = 'SalesOrd'
          AND NVL(l.isclosed, 'F') = 'F'
          AND l.mainline = 'F'
          AND l.assemblycomponent = 'F'
          AND l.kitcomponent = 'F'
          AND l.itemtype IN ('InvtPart', 'Assembly')
          AND o.id NOT IN (SELECT so_id FROM excluded_sos)
      ),

      qualified_orders AS (
        SELECT
          so_id,
          MAX(so_number) AS so_number,
          MAX(order_date) AS order_date,
          MAX(so_amount) AS so_amount,
          MAX(customer_id) AS customer_id,
          MAX(customer_name) AS customer_name,
          COUNT(*) AS qualifying_line_count,
          SUM(qty) AS total_qty,
          SUM(qty_committed) AS total_qty_committed,
          SUM(qty_backordered) AS total_qty_backordered
        FROM order_lines
        GROUP BY so_id
        HAVING SUM(qty_committed) >= SUM(qty)
           AND SUM(qty_backordered) = 0
      ),

      invoice_paid AS (
        SELECT
          l.previousdoc AS so_id,
          SUM(NVL(i.foreignamountpaid, 0)) AS total_paid
        FROM previoustransactionlink l
        JOIN transaction i
          ON i.id = l.nextdoc
        WHERE i.type = 'CustInvc'
        GROUP BY l.previousdoc
      ),

      if_counts AS (
        SELECT
          l.previousdoc AS so_id,
          COUNT(DISTINCT t.id) AS if_count
        FROM previoustransactionlink l
        JOIN transaction t
          ON t.id = l.nextdoc
        WHERE t.type = 'ItemShip'
        GROUP BY l.previousdoc
      )

      SELECT
        qo.so_id,
        qo.so_number,
        qo.order_date,
        qo.customer_id,
        qo.customer_name,
        qo.qualifying_line_count,
        qo.total_qty,
        qo.total_qty_committed,
        qo.total_qty_backordered,
        NVL(ic.if_count, 0) AS if_count
      FROM qualified_orders qo
      LEFT JOIN invoice_paid ip
        ON ip.so_id = qo.so_id
      LEFT JOIN if_counts ic
        ON ic.so_id = qo.so_id
      WHERE NVL(ip.total_paid, 0) >= qo.so_amount
      ORDER BY qo.so_id
    `;

    return query.runSuiteQL({ query: sql }).asMappedResults() || [];
  }

  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    var action = ctx.request.parameters.action || "getList";
    var rows = getRows();

    if (action === "getCsv") {
      var csv = buildCsv(rows);
      ctx.response.addHeader({
        name: "Content-Type",
        value: "text/csv; charset=UTF-8",
      });
      ctx.response.addHeader({
        name: "Content-Disposition",
        value:
          'attachment; filename="paid_fully_committed_no_kit_no_serialized.csv"',
      });
      ctx.response.write(csv);
      return;
    }

    log.debug({ title: "Rows", details: rows.length });

    var form = serverWidget.createForm({
      title:
        "Paid & Fully Committed Sales Orders (1 Row Per SO, No Kit / No Serialized)",
    });

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    var exportUrl = url.resolveScript({
      scriptId: ctx.runtimeScriptId || ctx.request.parameters.script || "",
      deploymentId:
        ctx.runtimeDeploymentId || ctx.request.parameters.deploy || "",
      params: { action: "getCsv" },
    });

    if (!exportUrl) {
      exportUrl = "?action=getCsv";
    }

    summary.defaultValue =
      '<div style="margin:6px 0 14px;padding:12px 14px;border-radius:10px;' +
      "background:#111827;color:#fff;font-size:16px;line-height:1.4;font-weight:700;" +
      'box-shadow:0 4px 10px rgba(0,0,0,0.15)">' +
      "Total Sales Orders: " +
      rows.length +
      "</div>" +
      '<div style="margin:0 0 14px;">' +
      '<a href="?action=getCsv" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Export CSV</a>' +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_sos",
      type: serverWidget.SublistType.LIST,
      label: "Qualified Sales Orders",
    });

    sub.addField({
      id: "col_so_number",
      type: serverWidget.FieldType.TEXT,
      label: "ORDER #",
    });
    sub.addField({
      id: "col_order_date",
      type: serverWidget.FieldType.DATE,
      label: "ORDER DATE",
    });
    sub.addField({
      id: "col_customer_name",
      type: serverWidget.FieldType.TEXT,
      label: "CUSTOMER",
    });
    sub.addField({
      id: "col_line_count",
      type: serverWidget.FieldType.INTEGER,
      label: "QUALIFYING LINES",
    });
    sub.addField({
      id: "col_total_qty",
      type: serverWidget.FieldType.FLOAT,
      label: "TOTAL QTY",
    });
    sub.addField({
      id: "col_total_committed",
      type: serverWidget.FieldType.FLOAT,
      label: "TOTAL COMMITTED",
    });
    sub.addField({
      id: "col_total_backordered",
      type: serverWidget.FieldType.FLOAT,
      label: "TOTAL BACKORDERED",
    });
    sub.addField({
      id: "col_has_if",
      type: serverWidget.FieldType.TEXT,
      label: "HAS IF",
    });
    sub.addField({
      id: "col_if_count",
      type: serverWidget.FieldType.INTEGER,
      label: "IF COUNT",
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

      if (r.so_number) {
        sub.setSublistValue({
          id: "col_so_number",
          line: i,
          value: String(r.so_number),
        });
      }

      if (r.order_date) {
        sub.setSublistValue({
          id: "col_order_date",
          line: i,
          value: String(r.order_date),
        });
      }

      if (r.customer_name) {
        sub.setSublistValue({
          id: "col_customer_name",
          line: i,
          value: String(r.customer_name),
        });
      }

      if (r.qualifying_line_count != null) {
        sub.setSublistValue({
          id: "col_line_count",
          line: i,
          value: String(parseInt(r.qualifying_line_count, 10) || 0),
        });
      }

      sub.setSublistValue({
        id: "col_total_qty",
        line: i,
        value: toNumStr(r.total_qty),
      });

      sub.setSublistValue({
        id: "col_total_committed",
        line: i,
        value: toNumStr(r.total_qty_committed),
      });

      sub.setSublistValue({
        id: "col_total_backordered",
        line: i,
        value: toNumStr(r.total_qty_backordered),
      });

      sub.setSublistValue({
        id: "col_has_if",
        line: i,
        value: Number(r.if_count || 0) > 0 ? "Yes" : "No",
      });

      sub.setSublistValue({
        id: "col_if_count",
        line: i,
        value: String(parseInt(r.if_count, 10) || 0),
      });

      if (soUrl) {
        sub.setSublistValue({
          id: "col_so_url",
          line: i,
          value: soUrl,
        });
      }

      if (custUrl) {
        sub.setSublistValue({
          id: "col_customer_url",
          line: i,
          value: custUrl,
        });
      }
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
