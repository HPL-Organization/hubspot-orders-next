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
          ABS(NVL(l.quantitypicked,0))           AS qty_picked,\
          ABS(NVL(l.quantityonshipments,0))      AS qty_on_shipments,\
          ABS(NVL(l.quantitybackordered,0))      AS qty_backordered,\
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
          itemtype, isserialitem, kitcomponent, assemblycomponent,\
          CASE WHEN itemtype = 'Assembly' AND isserialitem = 'T' THEN 'T' ELSE 'F' END AS is_serial_assembly,\
          GREATEST(0, qty - qty_shiprecv) AS remaining,\
          qty, qty_shiprecv, qty_committed, qty_backordered, qty_picked, qty_on_shipments\
        FROM base\
        WHERE\
          isclosed = 'F'\
          AND (assemblycomponent = 'F' OR (assemblycomponent = 'T' AND isserialitem = 'T'))\
          AND item_paid_flag = 'T'\
          AND qty_committed > 0\
          AND qty_backordered = 0\
          AND GREATEST(0, qty - qty_shiprecv) > 0\
          AND qty_picked = 0\
          AND qty_on_shipments = 0\
          AND isserialitem = 'T'\
      )\
      SELECT *\
      FROM elig\
      ORDER BY so_id, so_line";

    var rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];

    var soSet = {};
    var serialLines = rows.length;
    var serialAssemblies = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      soSet[r.so_id] = true;
      if (String(r.is_serial_assembly) === "T") serialAssemblies++;
    }

    var form = serverWidget.createForm({
      title:
        "Serialized Lines Report (Paid + Committed + No Backorder + Remaining)",
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
      "<div>Total Serialized Lines: <b>" +
      serialLines +
      "</b></div>" +
      "<div>Distinct SOs: <b>" +
      Object.keys(soSet).length +
      "</b></div>" +
      "<div>Serialized assemblies (Assembly+Serialized): <b>" +
      serialAssemblies +
      "</b></div>" +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "Serialized Lines (paid + committed + no backorder + remaining)",
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

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];

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
        id: "col_remaining",
        line: i,
        value: String(Number(r.remaining || 0)),
      });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
