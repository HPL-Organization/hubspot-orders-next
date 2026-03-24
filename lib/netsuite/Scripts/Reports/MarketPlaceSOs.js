/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/url",
  "N/log",
  "N/runtime",
], function (serverWidget, search, url, log, runtime) {
  function runReport() {
    const soSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: [
        ["mainline", "is", "T"],
        "AND",
        ["cseg_nsps_so_class", "anyof", "@NONE@"], // placeholder, replaced below if needed
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "tranid" }),
        search.createColumn({ name: "trandate", sort: search.Sort.DESC }),
        search.createColumn({ name: "entity" }),
        search.createColumn({ name: "salesrep" }),
        search.createColumn({ name: "cseg_nsps_so_class" }),
        search.createColumn({ name: "custbody_hpl_so_reference" }),
        search.createColumn({ name: "total" }),
        search.createColumn({ name: "statusref" }),
      ],
    });

    // Replace filters with formula text match so it works by displayed text = Marketplace
    soSearch.filterExpression = [
      ["mainline", "is", "T"],
      "AND",
      ["formulatext: UPPER({cseg_nsps_so_class})", "contains", "MARKETPLACE"],
    ];

    const results = [];
    const paged = soSearch.runPaged({ pageSize: 1000 });

    paged.pageRanges.forEach(function (range) {
      const page = paged.fetch({ index: range.index });
      page.data.forEach(function (r) {
        results.push({
          internal_id: r.getValue({ name: "internalid" }),
          so_number: r.getValue({ name: "tranid" }),
          so_date: r.getValue({ name: "trandate" }),
          customer:
            r.getText({ name: "entity" }) || r.getValue({ name: "entity" }),
          sales_rep:
            r.getText({ name: "salesrep" }) || r.getValue({ name: "salesrep" }),
          sales_channel:
            r.getText({ name: "cseg_nsps_so_class" }) ||
            r.getValue({ name: "cseg_nsps_so_class" }),
          so_reference: r.getValue({ name: "custbody_hpl_so_reference" }),
          total: r.getValue({ name: "total" }),
          status:
            r.getText({ name: "statusref" }) ||
            r.getValue({ name: "statusref" }),
        });
      });
    });

    log.debug({ title: "Marketplace SO count", details: results.length });
    return results;
  }

  function csvEscape(value) {
    const s = value == null ? "" : String(value);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function buildCsv(results) {
    const headers = [
      "Internal ID",
      "SO #",
      "SO Date",
      "Customer",
      "Sales Rep",
      "Sales Channel",
      "SO Reference",
      "Total",
      "Status",
    ];

    const lines = [headers.map(csvEscape).join(",")];

    results.forEach(function (r) {
      lines.push(
        [
          r.internal_id,
          r.so_number,
          r.so_date,
          r.customer,
          r.sales_rep,
          r.sales_channel,
          r.so_reference,
          r.total,
          r.status,
        ]
          .map(csvEscape)
          .join(","),
      );
    });

    return lines.join("\n");
  }

  function buildForm(results) {
    const form = serverWidget.createForm({
      title: "Marketplace Sales Orders",
    });

    const currentScript = runtime.getCurrentScript();

    const csvUrl = url.resolveScript({
      scriptId: currentScript.id,
      deploymentId: currentScript.deploymentId,
      params: { csv: "T" },
    });

    form.addButton({
      id: "custpage_download_csv",
      label: "Download CSV",
      functionName: "window.open('" + csvUrl + "', '_blank')",
    });

    const summaryFld = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    summaryFld.defaultValue =
      '<div style="margin:8px 0 14px;padding:10px 12px;border-radius:8px;background:#f3f4f6;font-size:14px;font-weight:700;">' +
      "Total SOs: " +
      results.length +
      "</div>";

    const sublist = form.addSublist({
      id: "custpage_results",
      type: serverWidget.SublistType.LIST,
      label: "Results",
    });

    sublist.addField({
      id: "custpage_internal_id",
      type: serverWidget.FieldType.TEXT,
      label: "Internal ID",
    });

    const soLinkField = sublist.addField({
      id: "custpage_so_link",
      type: serverWidget.FieldType.URL,
      label: "OPEN SO",
    });
    soLinkField.linkText = "Open SO";

    sublist.addField({
      id: "custpage_so_number_text",
      type: serverWidget.FieldType.TEXT,
      label: "SO #",
    });

    sublist.addField({
      id: "custpage_so_date",
      type: serverWidget.FieldType.TEXT,
      label: "SO Date",
    });

    sublist.addField({
      id: "custpage_customer",
      type: serverWidget.FieldType.TEXT,
      label: "Customer",
    });

    sublist.addField({
      id: "custpage_sales_rep",
      type: serverWidget.FieldType.TEXT,
      label: "Sales Rep",
    });

    sublist.addField({
      id: "custpage_sales_channel",
      type: serverWidget.FieldType.TEXT,
      label: "Sales Channel",
    });

    sublist.addField({
      id: "custpage_so_reference_col",
      type: serverWidget.FieldType.TEXT,
      label: "SO Reference",
    });

    sublist.addField({
      id: "custpage_total",
      type: serverWidget.FieldType.TEXT,
      label: "Total",
    });

    sublist.addField({
      id: "custpage_status",
      type: serverWidget.FieldType.TEXT,
      label: "Status",
    });

    for (let i = 0; i < results.length; i++) {
      const r = results[i];

      const soUrl =
        r.internal_id != null && r.internal_id !== ""
          ? url.resolveRecord({
              recordType: "salesorder",
              recordId: Number(r.internal_id),
              isEditMode: false,
            })
          : "";

      if (r.internal_id != null && r.internal_id !== "") {
        sublist.setSublistValue({
          id: "custpage_internal_id",
          line: i,
          value: String(r.internal_id),
        });
      }

      if (soUrl) {
        sublist.setSublistValue({
          id: "custpage_so_link",
          line: i,
          value: soUrl,
        });
      }

      if (r.so_number) {
        sublist.setSublistValue({
          id: "custpage_so_number_text",
          line: i,
          value: String(r.so_number),
        });
      }

      if (r.so_date) {
        sublist.setSublistValue({
          id: "custpage_so_date",
          line: i,
          value: String(r.so_date),
        });
      }

      if (r.customer) {
        sublist.setSublistValue({
          id: "custpage_customer",
          line: i,
          value: String(r.customer),
        });
      }

      if (r.sales_rep) {
        sublist.setSublistValue({
          id: "custpage_sales_rep",
          line: i,
          value: String(r.sales_rep),
        });
      }

      if (r.sales_channel) {
        sublist.setSublistValue({
          id: "custpage_sales_channel",
          line: i,
          value: String(r.sales_channel),
        });
      }

      if (r.so_reference) {
        sublist.setSublistValue({
          id: "custpage_so_reference_col",
          line: i,
          value: String(r.so_reference),
        });
      }

      if (r.total != null && r.total !== "") {
        sublist.setSublistValue({
          id: "custpage_total",
          line: i,
          value: String(r.total),
        });
      }

      if (r.status) {
        sublist.setSublistValue({
          id: "custpage_status",
          line: i,
          value: String(r.status),
        });
      }
    }

    return form;
  }

  function onRequest(context) {
    const results = runReport();

    if (context.request.parameters.csv === "T") {
      const csv = buildCsv(results);
      context.response.addHeader({
        name: "Content-Type",
        value: "text/csv; charset=utf-8",
      });
      context.response.addHeader({
        name: "Content-Disposition",
        value: 'attachment; filename="marketplace_sales_orders.csv"',
      });
      context.response.write(csv);
      return;
    }

    const form = buildForm(results);
    context.response.writePage(form);
  }

  return { onRequest: onRequest };
});
