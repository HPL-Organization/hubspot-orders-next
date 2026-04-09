/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/url",
  "N/file",
  "N/log",
  "N/runtime",
], function (serverWidget, search, url, file, log, runtime) {
  function escapeCsv(value) {
    var str = value == null ? "" : String(value);
    if (/[",\n\r]/.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function toNumber(value) {
    var num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  function getBackorderRows() {
    var rows = [];

    var soSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: [
        ["mainline", "is", "F"],
        "AND",
        ["taxline", "is", "F"],
        "AND",
        ["shipping", "is", "F"],
        "AND",
        ["cogs", "is", "F"],
        "AND",
        ["closed", "is", "F"],
        "AND",
        ["status", "noneof", ["SalesOrd:C", "SalesOrd:H"]],
      ],
      columns: [
        search.createColumn({ name: "trandate", sort: search.Sort.ASC }),
        search.createColumn({ name: "tranid" }),
        search.createColumn({ name: "entity" }),
        search.createColumn({ name: "item" }),
        search.createColumn({ name: "line" }),
        search.createColumn({ name: "quantity" }),
        search.createColumn({ name: "quantitycommitted" }),
        search.createColumn({ name: "quantityshiprecv" }),
        search.createColumn({ name: "rate" }),
      ],
    });

    var paged = soSearch.runPaged({ pageSize: 1000 });

    paged.pageRanges.forEach(function (pageRange) {
      var page = paged.fetch({ index: pageRange.index });

      page.data.forEach(function (result) {
        var qtyOrdered = Math.abs(
          toNumber(result.getValue({ name: "quantity" })),
        );
        var qtyCommitted = Math.abs(
          toNumber(result.getValue({ name: "quantitycommitted" })),
        );
        var qtyFulfilled = Math.abs(
          toNumber(result.getValue({ name: "quantityshiprecv" })),
        );
        var rate = Math.abs(toNumber(result.getValue({ name: "rate" })));

        var qtyBackordered = qtyOrdered - qtyCommitted - qtyFulfilled;
        if (qtyBackordered < 0) qtyBackordered = 0;

        if (qtyBackordered <= 0) {
          return;
        }

        var backorderAmount = qtyBackordered * rate;

        rows.push({
          trandate: result.getValue({ name: "trandate" }) || "",
          tranid: result.getValue({ name: "tranid" }) || "",
          customer:
            result.getText({ name: "entity" }) ||
            result.getValue({ name: "entity" }) ||
            "",
          item:
            result.getText({ name: "item" }) ||
            result.getValue({ name: "item" }) ||
            "",
          line: result.getValue({ name: "line" }) || "",
          qtyOrdered: qtyOrdered,
          qtyCommitted: qtyCommitted,
          qtyFulfilled: qtyFulfilled,
          qtyBackordered: qtyBackordered,
          rate: rate,
          backorderAmount: backorderAmount,
        });
      });
    });

    return rows;
  }

  function buildCsv(rows) {
    var csv = [];
    csv.push(
      [
        "Date",
        "SO Number",
        "Customer",
        "Item",
        "Line",
        "Qty Ordered",
        "Qty Committed",
        "Qty Fulfilled",
        "Qty Backordered",
        "Rate",
        "Backorder Amount",
      ].join(","),
    );

    rows.forEach(function (row) {
      csv.push(
        [
          escapeCsv(row.trandate),
          escapeCsv(row.tranid),
          escapeCsv(row.customer),
          escapeCsv(row.item),
          escapeCsv(row.line),
          escapeCsv(row.qtyOrdered),
          escapeCsv(row.qtyCommitted),
          escapeCsv(row.qtyFulfilled),
          escapeCsv(row.qtyBackordered),
          escapeCsv(row.rate.toFixed(2)),
          escapeCsv(row.backorderAmount.toFixed(2)),
        ].join(","),
      );
    });

    return csv.join("\n");
  }

  function onRequest(context) {
    try {
      var request = context.request;
      var response = context.response;
      var action = request.parameters.action || "view";
      var rows = getBackorderRows();

      if (action === "csv") {
        response.writeFile({
          file: file.create({
            name: "so_backorder_report.csv",
            fileType: file.Type.CSV,
            contents: buildCsv(rows),
          }),
          isInline: false,
        });
        return;
      }

      var form = serverWidget.createForm({
        title: "Backordered Sales Order Lines Report",
      });

      var csvUrl = url.resolveScript({
        scriptId: runtime.getCurrentScript().id,
        deploymentId: runtime.getCurrentScript().deploymentId,
        params: { action: "csv" },
      });

      form.addButton({
        id: "custpage_download_csv",
        label: "Download CSV",
        functionName: 'window.location.href="' + csvUrl + '"',
      });

      var totalQty = 0;
      var totalAmt = 0;

      rows.forEach(function (r) {
        totalQty += r.qtyBackordered;
        totalAmt += r.backorderAmount;
      });

      var info = form.addField({
        id: "custpage_info",
        type: serverWidget.FieldType.INLINEHTML,
        label: "Info",
      });

      info.defaultValue =
        "<div style='padding:10px 0;font-size:14px;'>" +
        "<b>Total Backordered Lines:</b> " +
        rows.length +
        "&nbsp;&nbsp;&nbsp;<b>Total Qty Backordered:</b> " +
        totalQty +
        "&nbsp;&nbsp;&nbsp;<b>Total Backorder Amount:</b> $" +
        totalAmt.toFixed(2) +
        "</div>";

      var sublist = form.addSublist({
        id: "custpage_results",
        type: serverWidget.SublistType.LIST,
        label: "Backordered SO Lines",
      });

      [
        ["custpage_trandate", "Date"],
        ["custpage_tranid", "SO Number"],
        ["custpage_customer", "Customer"],
        ["custpage_item", "Item"],
        ["custpage_line", "Line"],
        ["custpage_qtyordered", "Qty Ordered"],
        ["custpage_qtycommitted", "Qty Committed"],
        ["custpage_qtyfulfilled", "Qty Fulfilled"],
        ["custpage_qtybackordered", "Qty Backordered"],
        ["custpage_rate", "Rate"],
        ["custpage_backorderamount", "Backorder Amount"],
      ].forEach(function (f) {
        sublist.addField({
          id: f[0],
          type: serverWidget.FieldType.TEXT,
          label: f[1],
        });
      });

      rows.forEach(function (row, i) {
        if (row.trandate)
          sublist.setSublistValue({
            id: "custpage_trandate",
            line: i,
            value: String(row.trandate),
          });
        if (row.tranid)
          sublist.setSublistValue({
            id: "custpage_tranid",
            line: i,
            value: String(row.tranid),
          });
        if (row.customer)
          sublist.setSublistValue({
            id: "custpage_customer",
            line: i,
            value: String(row.customer),
          });
        if (row.item)
          sublist.setSublistValue({
            id: "custpage_item",
            line: i,
            value: String(row.item),
          });
        if (row.line !== "")
          sublist.setSublistValue({
            id: "custpage_line",
            line: i,
            value: String(row.line),
          });

        sublist.setSublistValue({
          id: "custpage_qtyordered",
          line: i,
          value: String(row.qtyOrdered),
        });
        sublist.setSublistValue({
          id: "custpage_qtycommitted",
          line: i,
          value: String(row.qtyCommitted),
        });
        sublist.setSublistValue({
          id: "custpage_qtyfulfilled",
          line: i,
          value: String(row.qtyFulfilled),
        });
        sublist.setSublistValue({
          id: "custpage_qtybackordered",
          line: i,
          value: String(row.qtyBackordered),
        });
        sublist.setSublistValue({
          id: "custpage_rate",
          line: i,
          value: row.rate.toFixed(2),
        });
        sublist.setSublistValue({
          id: "custpage_backorderamount",
          line: i,
          value: row.backorderAmount.toFixed(2),
        });
      });

      response.writePage(form);
    } catch (e) {
      log.error({
        title: "Backorder Report Error",
        details: e,
      });
      context.response.write("Error: " + (e.message || e.toString()));
    }
  }

  return { onRequest: onRequest };
});
