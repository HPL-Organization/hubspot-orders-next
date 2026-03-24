/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/file"], function (
  serverWidget,
  search,
  file,
) {
  function escapeCsv(value) {
    if (value === null || value === undefined) return "";
    var str = String(value);
    if (str.indexOf('"') !== -1) str = str.replace(/"/g, '""');
    if (
      str.indexOf(",") !== -1 ||
      str.indexOf("\n") !== -1 ||
      str.indexOf('"') !== -1
    ) {
      str = '"' + str + '"';
    }
    return str;
  }

  function getResults() {
    var rows = [];

    var soSearch = search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["type", "anyof", "SalesOrd"],
        "AND",
        ["mainline", "is", "T"],
        "AND",
        ["custbody_hpl_warranty", "is", "T"],
      ],
      columns: [
        search.createColumn({ name: "tranid", label: "SO Number" }),
        search.createColumn({ name: "trandate", label: "Date" }),
        search.createColumn({ name: "entity", label: "Customer" }),
        search.createColumn({ name: "statusref", label: "Status" }),
        search.createColumn({ name: "amount", label: "Amount" }),
        search.createColumn({
          name: "custbody_hpl_ordernote",
          label: "Order Note",
        }),
        search.createColumn({ name: "internalid", label: "Internal ID" }),
      ],
    });

    soSearch.run().each(function (result) {
      rows.push({
        internalid: result.getValue({ name: "internalid" }) || "",
        tranid: result.getValue({ name: "tranid" }) || "",
        trandate: result.getValue({ name: "trandate" }) || "",
        entity:
          result.getText({ name: "entity" }) ||
          result.getValue({ name: "entity" }) ||
          "",
        status:
          result.getText({ name: "statusref" }) ||
          result.getValue({ name: "statusref" }) ||
          "",
        amount: result.getValue({ name: "amount" }) || "",
        ordernote: result.getValue({ name: "custbody_hpl_ordernote" }) || "",
      });
      return true;
    });

    return rows;
  }

  function buildCsv(rows) {
    var lines = [];
    lines.push(
      [
        "Internal ID",
        "SO Number",
        "Date",
        "Customer",
        "Status",
        "Amount",
        "Order Note",
      ].join(","),
    );

    for (var i = 0; i < rows.length; i++) {
      lines.push(
        [
          escapeCsv(rows[i].internalid),
          escapeCsv(rows[i].tranid),
          escapeCsv(rows[i].trandate),
          escapeCsv(rows[i].entity),
          escapeCsv(rows[i].status),
          escapeCsv(rows[i].amount),
          escapeCsv(rows[i].ordernote),
        ].join(","),
      );
    }

    return lines.join("\n");
  }

  function onRequest(context) {
    var request = context.request;
    var response = context.response;

    var rows = getResults();

    if (request.parameters.exportcsv === "T") {
      var csvContent = buildCsv(rows);

      var csvFile = file.create({
        name: "Warranty_SO_Report.csv",
        fileType: file.Type.CSV,
        contents: csvContent,
      });

      response.writeFile({
        file: csvFile,
        isInline: false,
      });
      return;
    }

    var form = serverWidget.createForm({
      title: "Warranty Sales Orders Report",
    });

    var exportUrl =
      request.url +
      (request.url.indexOf("?") === -1 ? "?" : "&") +
      "exportcsv=T";

    form.addButton({
      id: "custpage_export_csv",
      label: "Export to CSV",
      functionName: "window.open('" + exportUrl + "', '_self')",
    });

    form.clientScriptModulePath = "";

    var sublist = form.addSublist({
      id: "custpage_results",
      type: serverWidget.SublistType.LIST,
      label: "Warranty Sales Orders",
    });

    sublist.addField({
      id: "custpage_internalid",
      type: serverWidget.FieldType.TEXT,
      label: "Internal ID",
    });

    sublist.addField({
      id: "custpage_tranid",
      type: serverWidget.FieldType.TEXT,
      label: "SO Number",
    });

    sublist.addField({
      id: "custpage_trandate",
      type: serverWidget.FieldType.TEXT,
      label: "Date",
    });

    sublist.addField({
      id: "custpage_entity",
      type: serverWidget.FieldType.TEXT,
      label: "Customer",
    });

    sublist.addField({
      id: "custpage_status",
      type: serverWidget.FieldType.TEXT,
      label: "Status",
    });

    sublist.addField({
      id: "custpage_amount",
      type: serverWidget.FieldType.TEXT,
      label: "Amount",
    });

    sublist.addField({
      id: "custpage_ordernote",
      type: serverWidget.FieldType.TEXTAREA,
      label: "Order Note",
    });

    for (var i = 0; i < rows.length; i++) {
      if (rows[i].internalid) {
        sublist.setSublistValue({
          id: "custpage_internalid",
          line: i,
          value: String(rows[i].internalid),
        });
      }

      if (rows[i].tranid) {
        sublist.setSublistValue({
          id: "custpage_tranid",
          line: i,
          value: String(rows[i].tranid),
        });
      }

      if (rows[i].trandate) {
        sublist.setSublistValue({
          id: "custpage_trandate",
          line: i,
          value: String(rows[i].trandate),
        });
      }

      if (rows[i].entity) {
        sublist.setSublistValue({
          id: "custpage_entity",
          line: i,
          value: String(rows[i].entity),
        });
      }

      if (rows[i].status) {
        sublist.setSublistValue({
          id: "custpage_status",
          line: i,
          value: String(rows[i].status),
        });
      }

      if (rows[i].amount) {
        sublist.setSublistValue({
          id: "custpage_amount",
          line: i,
          value: String(rows[i].amount),
        });
      }

      if (rows[i].ordernote) {
        sublist.setSublistValue({
          id: "custpage_ordernote",
          line: i,
          value: String(rows[i].ordernote),
        });
      }
    }

    response.writePage(form);
  }

  return {
    onRequest: onRequest,
  };
});
