/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/search", "N/file"], function (search, file) {
  function onRequest(context) {
    var rows = [];

    var soSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: [
        ["mainline", "is", "F"],
        "AND",
        ["item.itemid", "is", "Model RT3L 2-3lb-110"],
        "AND",
        ["quantityfulfilled", "lessthan", "quantity"],
      ],
      columns: [
        search.createColumn({ name: "tranid", summary: "GROUP" }),
        search.createColumn({ name: "salesrep", summary: "GROUP" }),
        search.createColumn({ name: "trandate", summary: "GROUP" }),
        search.createColumn({ name: "entity", summary: "GROUP" }),
        search.createColumn({ name: "internalid", summary: "GROUP" }),
      ],
    });

    rows.push(["SO", "Sales Rep", "Order Date", "Customer Name"].join(","));

    soSearch.run().each(function (result) {
      var soNum = result.getValue({ name: "tranid", summary: "GROUP" }) || "";
      var salesRep =
        result.getText({ name: "salesrep", summary: "GROUP" }) || "";
      var orderDate =
        result.getValue({ name: "trandate", summary: "GROUP" }) || "";
      var customerName =
        result.getText({ name: "entity", summary: "GROUP" }) || "";

      rows.push(
        [
          csvEscape(soNum),
          csvEscape(salesRep),
          csvEscape(orderDate),
          csvEscape(customerName),
        ].join(","),
      );

      return true;
    });

    var csvFile = file.create({
      name: "so_rt3l_2-3lb-110_not_fully_fulfilled.csv",
      fileType: file.Type.CSV,
      contents: rows.join("\n"),
    });

    context.response.writeFile({
      file: csvFile,
      isInline: false,
    });
  }

  function csvEscape(value) {
    value = value == null ? "" : String(value);
    if (value.indexOf('"') !== -1) value = value.replace(/"/g, '""');
    if (
      value.indexOf(",") !== -1 ||
      value.indexOf('"') !== -1 ||
      value.indexOf("\n") !== -1
    ) {
      value = '"' + value + '"';
    }
    return value;
  }

  return {
    onRequest: onRequest,
  };
});
