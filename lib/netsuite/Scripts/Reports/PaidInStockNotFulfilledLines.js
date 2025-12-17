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
      NVL(o.shipcomplete,'F')                AS shipcomplete,\
      l.assemblycomponent                    AS assemblycomponent,\
      l.kitcomponent                         AS kitcomponent,\
      ABS(NVL(l.quantity,0))                 AS qty,\
      ABS(NVL(l.quantityshiprecv,0))         AS qty_shiprecv,\
      ABS(NVL(l.quantitycommitted,0))        AS qty_committed,\
      ABS(NVL(l.quantitybackordered,0))      AS qty_backordered,\
      ABS(NVL(l.quantitypicked,0))           AS qty_picked,\
      ABS(NVL(l.quantitypacked,0))           AS qty_packed,\
      NVL(l.custcol_hpl_itempaid,'F')        AS item_paid_flag\
    FROM transaction o\
    JOIN transactionline l ON o.id = l.transaction\
    JOIN item i ON l.item = i.id\
    LEFT JOIN customer c ON o.entity = c.id\
    WHERE o.type = 'SalesOrd'\
      AND l.mainline = 'F'\
  ), order_flags AS (\
    SELECT\
      so_id,\
      MAX(CASE WHEN qty_backordered > 0 THEN 1 ELSE 0 END) AS has_backorder\
    FROM base\
    GROUP BY so_id\
  ), elig AS (\
    SELECT\
      b.so_id,\
      b.so_tranid,\
      b.customer_id,\
      b.customer_name,\
      b.so_line,\
      b.item_id,\
      b.item_sku,\
      b.item_name,\
      b.itemtype,\
      b.isserialitem,\
      b.kitcomponent,\
      b.qty,\
      b.qty_shiprecv,\
      b.qty_committed,\
      b.qty_backordered,\
      b.qty_picked,\
      b.qty_packed,\
      GREATEST(0, b.qty - b.qty_shiprecv) AS remaining\
    FROM base b\
    JOIN order_flags f ON b.so_id = f.so_id\
    WHERE\
      b.isclosed = 'F'\
      AND b.assemblycomponent = 'F'\
      AND b.qty > 0\
      AND b.qty_backordered = 0\
      AND b.qty_picked = 0\
      AND b.qty_packed = 0\
      AND b.qty_shiprecv = 0\
      AND b.item_paid_flag = 'T'\
      AND NOT ( b.itemtype = 'Kit' OR b.isserialitem = 'T' OR b.kitcomponent = 'T' )\
      AND (\
        (b.itemtype = 'NonInvtPart' AND b.qty > 0)\
        OR (b.itemtype <> 'NonInvtPart' AND b.qty_committed > 0)\
      )\
      AND (\
        b.shipcomplete = 'F'\
        OR (b.shipcomplete = 'T' AND f.has_backorder = 0)\
      )\
  )\
  SELECT *\
  FROM elig\
  ORDER BY so_id, so_line";

    var rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];

    var soSet = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      soSet[r.so_id] = true;
    }

    var form = serverWidget.createForm({
      title:
        "Paid, In-Stock, Non-Kit / Non-Serialized SO Lines Not on Fulfillment",
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
      "<div>Total Lines (paid + in stock + not on fulfillment): <b>" +
      rows.length +
      "</b></div>" +
      "<div>Distinct SOs: <b>" +
      Object.keys(soSet).length +
      "</b></div>" +
      "<div>Definition: Non-kit / non-serialized lines with custcol_hpl_itempaid = 'T', committed > 0, backorder = 0, and no picked/packed/fulfilled quantity.</div>" +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label:
        "Paid, In-Stock, Non-Kit / Non-Serialized Lines Not on Any Fulfillment",
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
      id: "col_qty_committed",
      type: serverWidget.FieldType.FLOAT,
      label: "Committed",
    });
    sub.addField({
      id: "col_qty_backordered",
      type: serverWidget.FieldType.FLOAT,
      label: "Backordered",
    });
    sub.addField({
      id: "col_remaining",
      type: serverWidget.FieldType.FLOAT,
      label: "Remaining",
    });

    sub.addField({
      id: "col_qty_picked",
      type: serverWidget.FieldType.FLOAT,
      label: "Picked",
    });
    sub.addField({
      id: "col_qty_packed",
      type: serverWidget.FieldType.FLOAT,
      label: "Packed",
    });
    sub.addField({
      id: "col_qty_shiprecv",
      type: serverWidget.FieldType.FLOAT,
      label: "Fulfilled (Ship/Recv)",
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

      sub.setSublistValue({
        id: "col_qty_picked",
        line: i,
        value: String(Number(r.qty_picked || 0)),
      });
      sub.setSublistValue({
        id: "col_qty_packed",
        line: i,
        value: String(Number(r.qty_packed || 0)),
      });
      sub.setSublistValue({
        id: "col_qty_shiprecv",
        line: i,
        value: String(Number(r.qty_shiprecv || 0)),
      });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
