/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/query", "N/log", "N/url"], function (
  serverWidget,
  query,
  log,
  url,
) {
  function safe(v) {
    return String(v == null ? "" : v);
  }

  function sqlText(v) {
    return safe(v).replace(/'/g, "''").trim();
  }

  function runReport(filters) {
    const soRef = sqlText(filters.soRef);
    const tranId = sqlText(filters.tranId);

    let outerWhere = `
      WHERE
        base.so_trandate <= CURRENT_DATE
        AND (
          base.sales_channel LIKE 'Live Event%'
          OR base.sales_channel LIKE 'Live Events%'
        )
    `;

    if (soRef) {
      outerWhere += `
        AND UPPER(NVL(base.so_reference, '')) LIKE UPPER('%${soRef}%')
      `;
    }

    if (tranId) {
      outerWhere += `
        AND UPPER(NVL(base.so_number, '')) LIKE UPPER('%${tranId}%')
      `;
    }

    const sql = `
      WITH base AS (
        SELECT
          T.id AS internal_id,
          T.tranid AS so_number,
          T.trandate AS so_trandate,
          BUILTIN.DF(T.entity) AS customer,
          BUILTIN.DF(T.cseg_nsps_so_class) AS sales_channel,
          T.custbody_hpl_so_reference AS so_reference,
          T.foreigntotal AS total,
          BUILTIN.DF(T.status) AS status
        FROM Transaction T
        JOIN TransactionLine TL
          ON TL.transaction = T.id
        WHERE
          T.type = 'SalesOrd'
          AND TL.mainline = 'T'
      )
      SELECT
        base.internal_id,
        base.so_number,
        TO_CHAR(base.so_trandate, 'MM/DD/YYYY') AS so_date,
        base.customer,
        base.sales_channel,
        base.so_reference,
        base.total,
        base.status
      FROM base
      ${outerWhere}
      ORDER BY base.so_trandate DESC, base.internal_id DESC
    `;

    log.debug({ title: "SuiteQL", details: sql });
    return query.runSuiteQL({ query: sql }).asMappedResults();
  }

  function buildForm(params, results) {
    const form = serverWidget.createForm({
      title: "Live Event Sales Orders",
    });

    const soRefFld = form.addField({
      id: "custpage_so_reference",
      type: serverWidget.FieldType.TEXT,
      label: "SO Reference",
    });
    soRefFld.defaultValue = params.soRef || "";

    const soNumFld = form.addField({
      id: "custpage_so_number_filter",
      type: serverWidget.FieldType.TEXT,
      label: "SO Number",
    });
    soNumFld.defaultValue = params.tranId || "";

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

    form.addSubmitButton({ label: "Search" });

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
        r.internal_id != null
          ? url.resolveRecord({
              recordType: "salesorder",
              recordId: Number(r.internal_id),
              isEditMode: false,
            })
          : "";

      if (r.internal_id != null) {
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

      if (r.total != null) {
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
    const req = context.request;

    const params = {
      soRef: req.parameters.custpage_so_reference || "",
      tranId: req.parameters.custpage_so_number_filter || "",
    };

    const results = runReport(params);
    const form = buildForm(params, results);
    context.response.writePage(form);
  }

  return { onRequest: onRequest };
});
