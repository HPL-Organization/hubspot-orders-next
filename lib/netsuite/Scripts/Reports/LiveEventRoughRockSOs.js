/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/url",
  "N/runtime",
  "N/file",
], function (serverWidget, search, url, runtime, file) {
  const SALES_CHANNEL_TEXT = "Live Events : Rough Rock";
  const SALES_CHANNEL_FIELD = "cseg_nsps_so_class";
  const SO_REFERENCE_FIELD = "custbody_hpl_so_reference";

  function escapeCsv(value) {
    if (value === null || value === undefined) return "";
    const str = String(value).replace(/"/g, '""');
    return '"' + str + '"';
  }

  function getResults() {
    const rows = [];

    const soSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: [
        ["mainline", "is", "T"],
        "AND",
        [
          "formulatext: {" + SALES_CHANNEL_FIELD + "}",
          "is",
          SALES_CHANNEL_TEXT,
        ],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "tranid" }),
        search.createColumn({ name: "trandate" }),
        search.createColumn({ name: "entity" }),
        search.createColumn({ name: SO_REFERENCE_FIELD }),
        search.createColumn({ name: SALES_CHANNEL_FIELD }),
      ],
    });

    const paged = soSearch.runPaged({ pageSize: 1000 });

    paged.pageRanges.forEach(function (range) {
      const page = paged.fetch({ index: range.index });
      page.data.forEach(function (result) {
        rows.push({
          internalid: result.getValue({ name: "internalid" }) || "",
          tranid: result.getValue({ name: "tranid" }) || "",
          trandate: result.getValue({ name: "trandate" }) || "",
          customer:
            result.getText({ name: "entity" }) ||
            result.getValue({ name: "entity" }) ||
            "",
          salesChannel: result.getText({ name: SALES_CHANNEL_FIELD }) || "",
          soReference: result.getValue({ name: SO_REFERENCE_FIELD }) || "",
        });
      });
    });

    return rows;
  }

  function buildCsv(rows) {
    const out = [];

    out.push(
      [
        "Internal ID",
        "SO Number",
        "Date",
        "Customer",
        "Sales Channel",
        "SO Reference",
      ]
        .map(escapeCsv)
        .join(","),
    );

    rows.forEach(function (row) {
      out.push(
        [
          row.internalid,
          row.tranid,
          row.trandate,
          row.customer,
          row.salesChannel,
          row.soReference,
        ]
          .map(escapeCsv)
          .join(","),
      );
    });

    return out.join("\n");
  }

  function onRequest(context) {
    const request = context.request;
    const response = context.response;

    const rows = getResults();

    if (request.parameters.export === "csv") {
      const csvFile = file.create({
        name: "live-events-rough-rock-sales-orders.csv",
        fileType: file.Type.CSV,
        contents: buildCsv(rows),
      });

      response.writeFile({
        file: csvFile,
        isInline: false,
      });
      return;
    }

    const form = serverWidget.createForm({
      title: "Sales Orders - Live Events : Rough Rock",
    });

    const exportUrl = url.resolveScript({
      scriptId: runtime.getCurrentScript().id,
      deploymentId: runtime.getCurrentScript().deploymentId,
      params: {
        export: "csv",
      },
    });

    const summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: "Summary",
    });

    summary.defaultValue =
      '<div style="padding:10px 0 16px 0;">' +
      '<div style="font-size:16px; margin-bottom:8px;"><b>Total Count:</b> ' +
      rows.length +
      "</div>" +
      '<div style="margin-bottom:12px;"><b>Sales Channel:</b> ' +
      SALES_CHANNEL_TEXT +
      "</div>" +
      '<a href="' +
      exportUrl +
      '" ' +
      'style="display:inline-block;padding:8px 14px;background:#2b6cb0;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Export CSV</a>' +
      "</div>";

    const sublist = form.addSublist({
      id: "custpage_results",
      type: serverWidget.SublistType.LIST,
      label: "Matching Sales Orders",
    });

    sublist.addField({
      id: "custpage_open",
      type: serverWidget.FieldType.TEXT,
      label: "Open SO",
    });

    sublist.addField({
      id: "custpage_sonumber",
      type: serverWidget.FieldType.TEXT,
      label: "SO Number",
    });

    sublist.addField({
      id: "custpage_date",
      type: serverWidget.FieldType.TEXT,
      label: "Date",
    });

    sublist.addField({
      id: "custpage_customer",
      type: serverWidget.FieldType.TEXT,
      label: "Customer",
    });

    sublist.addField({
      id: "custpage_saleschannel",
      type: serverWidget.FieldType.TEXT,
      label: "Sales Channel",
    });

    sublist.addField({
      id: "custpage_soref",
      type: serverWidget.FieldType.TEXT,
      label: "SO Reference",
    });

    rows.forEach(function (row, i) {
      const soUrl = url.resolveRecord({
        recordType: "salesorder",
        recordId: row.internalid,
        isEditMode: false,
      });

      sublist.setSublistValue({
        id: "custpage_open",
        line: i,
        value: '<a href="' + soUrl + '" target="_blank">Open SO</a>',
      });

      if (row.tranid) {
        sublist.setSublistValue({
          id: "custpage_sonumber",
          line: i,
          value: row.tranid,
        });
      }

      if (row.trandate) {
        sublist.setSublistValue({
          id: "custpage_date",
          line: i,
          value: row.trandate,
        });
      }

      if (row.customer) {
        sublist.setSublistValue({
          id: "custpage_customer",
          line: i,
          value: row.customer,
        });
      }

      if (row.salesChannel) {
        sublist.setSublistValue({
          id: "custpage_saleschannel",
          line: i,
          value: row.salesChannel,
        });
      }

      if (row.soReference) {
        sublist.setSublistValue({
          id: "custpage_soref",
          line: i,
          value: row.soReference,
        });
      }
    });

    response.writePage(form);
  }

  return {
    onRequest: onRequest,
  };
});
