/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/file",
  "N/url",
  "N/runtime",
], function (serverWidget, search, file, url, runtime) {
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

  function getMatchingSoIdsBySku(skuFilter) {
    var soIds = {};
    if (!skuFilter) return soIds;

    var lineSearch = search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["type", "anyof", "SalesOrd"],
        "AND",
        ["mainline", "is", "F"],
        "AND",
        ["taxline", "is", "F"],
        "AND",
        ["shipping", "is", "F"],
        "AND",
        ["cogs", "is", "F"],
        "AND",
        ["custbody_hpl_warranty", "is", "T"],
        "AND",
        ["item.itemid", "contains", skuFilter],
      ],
      columns: [search.createColumn({ name: "internalid" })],
    });

    lineSearch.run().each(function (result) {
      var internalId = result.getValue({ name: "internalid" });
      if (internalId) {
        soIds[internalId] = true;
      }
      return true;
    });

    return soIds;
  }

  function getResults(skuFilter) {
    var rows = [];
    var matchingSoIds = getMatchingSoIdsBySku(skuFilter);
    var filters = [
      ["type", "anyof", "SalesOrd"],
      "AND",
      ["mainline", "is", "T"],
      "AND",
      ["custbody_hpl_warranty", "is", "T"],
    ];

    if (skuFilter) {
      var idList = Object.keys(matchingSoIds);
      if (!idList.length) {
        return rows;
      }

      filters.push("AND");
      filters.push(["internalid", "anyof"].concat(idList));
    }

    var soSearch = search.create({
      type: search.Type.TRANSACTION,
      filters: filters,
      columns: [
        search.createColumn({ name: "internalid", label: "Internal ID" }),
        search.createColumn({ name: "tranid", label: "SO Number" }),
        search.createColumn({ name: "trandate", label: "Date" }),
        search.createColumn({ name: "entity", label: "Customer" }),
        search.createColumn({ name: "statusref", label: "Status" }),
        search.createColumn({ name: "amount", label: "Amount" }),
        search.createColumn({
          name: "custbody_hpl_ordernote",
          label: "Order Note",
        }),
      ],
    });

    soSearch.run().each(function (result) {
      var internalId = result.getValue({ name: "internalid" }) || "";

      rows.push({
        internalid: internalId,
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
        soUrl: internalId
          ? url.resolveRecord({
              recordType: "salesorder",
              recordId: internalId,
              isEditMode: false,
            })
          : "",
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
        "SO Link",
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
          escapeCsv(rows[i].soUrl),
        ].join(","),
      );
    }

    return lines.join("\n");
  }

  function onRequest(context) {
    var request = context.request;
    var response = context.response;
    var skuFilter = (
      request.parameters.custpage_sku ||
      request.parameters.sku ||
      ""
    ).trim();
    var rows = getResults(skuFilter);

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

    var skuField = form.addField({
      id: "custpage_sku",
      type: serverWidget.FieldType.TEXT,
      label: "SKU Filter",
    });
    skuField.defaultValue = skuFilter;

    form.addSubmitButton({
      label: "Filter",
    });

    var scriptObj = runtime.getCurrentScript();

    var exportUrl = url.resolveScript({
      scriptId: scriptObj.id,
      deploymentId: scriptObj.deploymentId,
      params: {
        exportcsv: "T",
        sku: skuFilter,
      },
    });

    var headerField = form.addField({
      id: "custpage_header_html",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    headerField.defaultValue =
      '<div style="display:flex;align-items:center;gap:16px;padding:8px 0 12px 0;">' +
      '<div style="font-size:16px;font-weight:bold;">Total Warranty SOs: ' +
      rows.length +
      "</div>" +
      '<a href="' +
      exportUrl +
      '" ' +
      'style="display:inline-block;padding:6px 12px;background:#3a7dbd;color:#fff;text-decoration:none;border-radius:3px;font-weight:bold;">' +
      "Export to CSV</a>" +
      "</div>";

    var sublist = form.addSublist({
      id: "custpage_results",
      type: serverWidget.SublistType.LIST,
      label: "Warranty Sales Orders",
    });

    sublist.addField({
      id: "custpage_view",
      type: serverWidget.FieldType.URL,
      label: "Open SO",
    }).linkText = "Open";

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
      if (rows[i].soUrl) {
        sublist.setSublistValue({
          id: "custpage_view",
          line: i,
          value: rows[i].soUrl,
        });
      }
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
