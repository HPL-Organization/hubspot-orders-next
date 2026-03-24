/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/url",
  "N/file",
  "N/runtime",
], function (serverWidget, search, url, file, runtime) {
  function escapeCsv(value) {
    if (value === null || value === undefined) return "";
    var str = String(value);
    if (str.indexOf('"') !== -1) str = str.replace(/"/g, '""');
    if (/[",\n]/.test(str)) str = '"' + str + '"';
    return str;
  }

  function getResults() {
    var results = [];

    var soSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: [
        ["mainline", "is", "T"],
        "AND",
        ["amountremaining", "equalto", "0.00"],
        "AND",
        ["custbody_hpl_paidreleased", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "tranid", sort: search.Sort.ASC }),
        search.createColumn({ name: "entity" }),
        search.createColumn({ name: "trandate" }),
        search.createColumn({ name: "statusref" }),
        search.createColumn({ name: "amount" }),
        search.createColumn({ name: "amountremaining" }),
        search.createColumn({ name: "internalid" }),
      ],
    });

    soSearch.run().each(function (result) {
      var internalId = result.getValue({ name: "internalid" });

      results.push({
        internalId: internalId,
        tranid: result.getValue({ name: "tranid" }) || "",
        customer: result.getText({ name: "entity" }) || "",
        trandate: result.getValue({ name: "trandate" }) || "",
        status:
          result.getText({ name: "statusref" }) ||
          result.getValue({ name: "statusref" }) ||
          "",
        amount: result.getValue({ name: "amount" }) || "0.00",
        amountremaining: result.getValue({ name: "amountremaining" }) || "0.00",
        soLink: url.resolveRecord({
          recordType: "salesorder",
          recordId: internalId,
          isEditMode: false,
        }),
      });

      return true;
    });

    return results;
  }

  function buildCsv(results) {
    var lines = [];
    lines.push(
      [
        "SO Number",
        "Customer",
        "Date",
        "Status",
        "Amount",
        "Amount Remaining",
        "SO Link",
      ].join(","),
    );

    results.forEach(function (row) {
      lines.push(
        [
          escapeCsv(row.tranid),
          escapeCsv(row.customer),
          escapeCsv(row.trandate),
          escapeCsv(row.status),
          escapeCsv(row.amount),
          escapeCsv(row.amountremaining),
          escapeCsv(row.soLink),
        ].join(","),
      );
    });

    return lines.join("\n");
  }

  function onRequest(context) {
    var request = context.request;
    var response = context.response;
    var action = request.parameters.action || "view";

    var results = getResults();

    if (action === "csv") {
      var csvContent = buildCsv(results);

      var csvFile = file.create({
        name: "paid_sales_orders_paidreleased_false.csv",
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
      title: "Paid Sales Orders Where Paid Released Is Not Enabled",
    });

    var scriptObj = runtime.getCurrentScript();

    var scriptUrl = url.resolveScript({
      scriptId: scriptObj.id,
      deploymentId: scriptObj.deploymentId,
      params: { action: "csv" },
    });

    form.addButton({
      id: "custpage_export_csv",
      label: "Export CSV",
      functionName: "window.location.href='" + scriptUrl + "'",
    });

    var countField = form.addField({
      id: "custpage_total_count",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });
    countField.defaultValue =
      '<div style="font-size:16px;font-weight:bold;padding:8px 0;">Total Count: ' +
      results.length +
      "</div>";

    var sublist = form.addSublist({
      id: "custpage_results",
      type: serverWidget.SublistType.LIST,
      label: "Results",
    });

    sublist.addField({
      id: "custpage_so_link",
      type: serverWidget.FieldType.URL,
      label: "Open SO",
    }).linkText = "Open";

    sublist.addField({
      id: "custpage_so_number",
      type: serverWidget.FieldType.TEXT,
      label: "SO Number",
    });

    sublist.addField({
      id: "custpage_customer",
      type: serverWidget.FieldType.TEXT,
      label: "Customer",
    });

    sublist.addField({
      id: "custpage_date",
      type: serverWidget.FieldType.TEXT,
      label: "Date",
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
      id: "custpage_amountremaining",
      type: serverWidget.FieldType.TEXT,
      label: "Amount Remaining",
    });

    for (var i = 0; i < results.length; i++) {
      var row = results[i];

      if (row.soLink) {
        sublist.setSublistValue({
          id: "custpage_so_link",
          line: i,
          value: row.soLink,
        });
      }

      if (row.tranid) {
        sublist.setSublistValue({
          id: "custpage_so_number",
          line: i,
          value: row.tranid,
        });
      }

      if (row.customer) {
        sublist.setSublistValue({
          id: "custpage_customer",
          line: i,
          value: row.customer,
        });
      }

      if (row.trandate) {
        sublist.setSublistValue({
          id: "custpage_date",
          line: i,
          value: row.trandate,
        });
      }

      if (row.status) {
        sublist.setSublistValue({
          id: "custpage_status",
          line: i,
          value: row.status,
        });
      }

      if (row.amount) {
        sublist.setSublistValue({
          id: "custpage_amount",
          line: i,
          value: String(row.amount),
        });
      }

      if (row.amountremaining) {
        sublist.setSublistValue({
          id: "custpage_amountremaining",
          line: i,
          value: String(row.amountremaining),
        });
      }
    }

    response.writePage(form);
  }

  return {
    onRequest: onRequest,
  };
});
