/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/query",
  "N/url",
  "N/log",
  "N/search",
], function (serverWidget, query, url, log, search) {
  function safeMoney(v) {
    var n = Number(v || 0);
    if (isNaN(n)) return "";
    return n.toFixed(2);
  }

  function safeNum(v) {
    var n = Number(v || 0);
    if (isNaN(n)) return "";
    return String(n);
  }

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
          NVL(l.isclosed,'F')                    AS isclosed,\
          ABS(NVL(l.quantity,0))                 AS so_qty,\
          NVL(l.rate,0)                          AS so_rate,\
          ABS(NVL(l.quantityshiprecv,0))         AS qty_shiprecv,\
          ABS(NVL(l.quantitypicked,0))           AS qty_picked,\
          ABS(NVL(l.quantityonshipments,0))      AS qty_on_shipments\
        FROM transaction o\
        JOIN transactionline l ON o.id = l.transaction\
        LEFT JOIN customer c ON o.entity = c.id\
        LEFT JOIN item i ON l.item = i.id\
        WHERE o.type = 'SalesOrd'\
          AND l.mainline = 'F'\
      ), elig AS (\
        SELECT *\
        FROM base\
        WHERE\
          NVL(isclosed,'F') = 'F'\
          AND qty_picked = 0\
          AND qty_shiprecv = 0\
          AND qty_on_shipments = 0\
      )\
      SELECT *\
      FROM elig\
      ORDER BY so_id, so_line";

    var rows;
    try {
      rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    } catch (e) {
      log.error("SO base query failed", e);
      throw e;
    }

    var bySo = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var soId = String(r.so_id);
      if (!bySo[soId]) {
        bySo[soId] = {
          soId: soId,
          soTranid: r.so_tranid,
          customerId: r.customer_id,
          customerName: r.customer_name,
          lines: [],
        };
      }
      bySo[soId].lines.push({
        soLineId: Number(r.so_line || 0),
        itemId: Number(r.item_id || 0),
        itemSku: r.item_sku,
        itemName: r.item_name,
        soQty: Number(r.so_qty || 0),
        soRate: Number(r.so_rate || 0),
      });
    }

    var mismatches = [];
    var soKeys = Object.keys(bySo);

    for (var s = 0; s < soKeys.length; s++) {
      var soKey = soKeys[s];
      var soInfo = bySo[soKey];
      var soIdNum = parseInt(soKey, 10);
      if (!(soIdNum > 0)) continue;

      var invSearch;
      try {
        invSearch = search.create({
          type: search.Type.INVOICE,
          filters: [
            ["createdfrom", "anyof", soIdNum],
            "AND",
            ["mainline", "is", "F"],
          ],
          columns: ["internalid", "tranid", "item", "rate", "quantity"],
        });
      } catch (eSearchCreate) {
        log.error(
          "Failed to create invoice search for SO " + soKey,
          eSearchCreate
        );
        continue;
      }

      var invLines = [];
      try {
        var pagedData = invSearch.runPaged({ pageSize: 1000 });
        pagedData.pageRanges.forEach(function (pageRange) {
          var page = pagedData.fetch({ index: pageRange.index });
          page.data.forEach(function (res) {
            var invId = res.getValue({ name: "internalid" });
            var invTranid = res.getValue({ name: "tranid" });
            var itemId = res.getValue({ name: "item" });
            var rate = res.getValue({ name: "rate" });
            var qty = res.getValue({ name: "quantity" });

            invLines.push({
              invId: String(invId),
              invTranid: String(invTranid),
              itemId: Number(itemId || 0),
              invRate: Number(rate || 0),
              invQty: Number(qty || 0),
            });
          });
        });
      } catch (eRun) {
        log.error("Failed to run invoice search for SO " + soKey, eRun);
        continue;
      }

      if (!invLines.length) continue;

      for (var li = 0; li < soInfo.lines.length; li++) {
        var soLine = soInfo.lines[li];
        var soAmount = soLine.soRate * soLine.soQty;

        for (var j = 0; j < invLines.length; j++) {
          var il = invLines[j];
          if (!il.itemId || il.itemId !== soLine.itemId) continue;

          var invAmount = il.invRate * il.invQty;
          var rateDiff = il.invRate - soLine.soRate;
          var amtDiff = invAmount - soAmount;

          if (Math.abs(rateDiff) <= 0.0001 && Math.abs(amtDiff) <= 0.0001) {
            continue;
          }

          mismatches.push({
            soId: soInfo.soId,
            soTranid: soInfo.soTranid,
            customerName: soInfo.customerName,
            soLineId: soLine.soLineId,
            itemSku: soLine.itemSku,
            itemName: soLine.itemName,
            soQty: soLine.soQty,
            soRate: soLine.soRate,
            soAmount: soAmount,
            invId: il.invId,
            invTranid: il.invTranid,
            invQty: il.invQty,
            invRate: il.invRate,
            invAmount: invAmount,
            rateDiff: rateDiff,
            amountDiff: amtDiff,
          });
        }
      }
    }

    var distinctSOs = {};
    var distinctInvs = {};
    for (var m = 0; m < mismatches.length; m++) {
      distinctSOs[mismatches[m].soId] = true;
      distinctInvs[mismatches[m].invId] = true;
    }

    var form = serverWidget.createForm({
      title: "SO vs Invoice Mismatch Report (Unshipped Lines)",
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
      "<div>Lines with rate/amount mismatch: <b>" +
      mismatches.length +
      "</b></div>" +
      "<div>Distinct Sales Orders: <b>" +
      Object.keys(distinctSOs).length +
      "</b></div>" +
      "<div>Distinct Invoices: <b>" +
      Object.keys(distinctInvs).length +
      "</b></div>" +
      "<div>Filter: SO line not closed, picked = 0, shipped/received = 0, on shipments = 0, " +
      "and invoice line (same SO + item) has different rate or amount (rate × qty).</div>" +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "SO / Invoice Line Mismatches (Unshipped)",
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
      id: "col_inv_tranid",
      type: serverWidget.FieldType.TEXT,
      label: "Invoice #",
    });
    sub.addField({
      id: "col_inv_link",
      type: serverWidget.FieldType.URL,
      label: "Open Invoice",
    });
    sub.addField({
      id: "col_customer",
      type: serverWidget.FieldType.TEXT,
      label: "Customer",
    });
    sub.addField({
      id: "col_so_line",
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
      id: "col_so_qty",
      type: serverWidget.FieldType.TEXT,
      label: "SO Qty",
    });
    sub.addField({
      id: "col_inv_qty",
      type: serverWidget.FieldType.TEXT,
      label: "Inv Qty",
    });
    sub.addField({
      id: "col_so_rate",
      type: serverWidget.FieldType.TEXT,
      label: "SO Rate",
    });
    sub.addField({
      id: "col_inv_rate",
      type: serverWidget.FieldType.TEXT,
      label: "Inv Rate",
    });
    sub.addField({
      id: "col_rate_diff",
      type: serverWidget.FieldType.TEXT,
      label: "Rate Diff. (Inv - SO)",
    });
    sub.addField({
      id: "col_so_amount",
      type: serverWidget.FieldType.TEXT,
      label: "SO Amount (rate × qty)",
    });
    sub.addField({
      id: "col_inv_amount",
      type: serverWidget.FieldType.TEXT,
      label: "Inv Amount (rate × qty)",
    });
    sub.addField({
      id: "col_amount_diff",
      type: serverWidget.FieldType.TEXT,
      label: "Amount Diff. (Inv - SO)",
    });

    for (var i = 0; i < mismatches.length; i++) {
      var r = mismatches[i];

      var soUrl = r.soId
        ? url.resolveRecord({
            recordType: "salesorder",
            recordId: r.soId,
            isEditMode: false,
          })
        : "";
      var invUrl = r.invId
        ? url.resolveRecord({
            recordType: "invoice",
            recordId: r.invId,
            isEditMode: false,
          })
        : "";

      if (r.soTranid)
        sub.setSublistValue({
          id: "col_so_tranid",
          line: i,
          value: String(r.soTranid),
        });

      if (soUrl)
        sub.setSublistValue({
          id: "col_so_link",
          line: i,
          value: soUrl,
        });

      if (r.invTranid)
        sub.setSublistValue({
          id: "col_inv_tranid",
          line: i,
          value: String(r.invTranid),
        });

      if (invUrl)
        sub.setSublistValue({
          id: "col_inv_link",
          line: i,
          value: invUrl,
        });

      if (r.customerName)
        sub.setSublistValue({
          id: "col_customer",
          line: i,
          value: String(r.customerName),
        });

      sub.setSublistValue({
        id: "col_so_line",
        line: i,
        value: String(Number(r.soLineId || 0)),
      });

      if (r.itemSku)
        sub.setSublistValue({
          id: "col_item_sku",
          line: i,
          value: String(r.itemSku),
        });

      if (r.itemName)
        sub.setSublistValue({
          id: "col_item_name",
          line: i,
          value: String(r.itemName),
        });

      sub.setSublistValue({
        id: "col_so_qty",
        line: i,
        value: safeNum(r.soQty),
      });

      sub.setSublistValue({
        id: "col_inv_qty",
        line: i,
        value: safeNum(r.invQty),
      });

      sub.setSublistValue({
        id: "col_so_rate",
        line: i,
        value: safeMoney(r.soRate),
      });

      sub.setSublistValue({
        id: "col_inv_rate",
        line: i,
        value: safeMoney(r.invRate),
      });

      sub.setSublistValue({
        id: "col_rate_diff",
        line: i,
        value: safeMoney(r.rateDiff),
      });

      sub.setSublistValue({
        id: "col_so_amount",
        line: i,
        value: safeMoney(r.soAmount),
      });

      sub.setSublistValue({
        id: "col_inv_amount",
        line: i,
        value: safeMoney(r.invAmount),
      });

      sub.setSublistValue({
        id: "col_amount_diff",
        line: i,
        value: safeMoney(r.amountDiff),
      });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
