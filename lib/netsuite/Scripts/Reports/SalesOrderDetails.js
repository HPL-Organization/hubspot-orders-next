/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/url", "N/runtime"], (
  ui,
  search,
  url,
  runtime
) => {
  const TITLE = "SO → Invoices (Totals & Paid)";

  function addSearchUI(form, q) {
    form.addFieldGroup({ id: "custpage_grp", label: "Search" });
    const f = form.addField({
      id: "custpage_q",
      label: "Search (Customer / Email / SO # / Invoice # / Deal)",
      type: ui.FieldType.TEXT,
      container: "custpage_grp",
    });
    if (q) f.defaultValue = q;
    form.addSubmitButton({ label: "Search" });
  }

  function buildSearch(q) {
    const filtersExpr = [
      ["mainline", "is", "T"],
      "and",
      ["createdfrom", "noneof", "@NONE@"],
    ];

    if (q) {
      const expr =
        "NVL({tranid},'')||' '||NVL({createdfrom.tranid},'')||' '||NVL({customer.email},'')||' '||NVL({entity},'')||' '||NVL({createdfrom.custbody_hpl_hs_deal_name},'')";
      filtersExpr.push("and", [`formulatext: ${expr}`, "contains", q]);
    }

    return search.create({
      type: search.Type.INVOICE,
      filters: filtersExpr,
      columns: [
        search.createColumn({ name: "tranid" }),
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "amount" }),
        search.createColumn({ name: "amountpaid" }),
        search.createColumn({ name: "entity" }),
        search.createColumn({ name: "internalid", join: "customer" }),
        search.createColumn({ name: "email", join: "customer" }),
        search.createColumn({ name: "tranid", join: "createdFrom" }),
        search.createColumn({ name: "internalid", join: "createdFrom" }),
        search.createColumn({
          name: "custbody_hpl_hs_deal_name",
          join: "createdFrom",
        }),
      ],
    });
  }

  function fetchRows(q) {
    const s = buildSearch(q);
    const rows = [];
    const paged = s.runPaged({ pageSize: 1000 });
    paged.pageRanges.forEach((pr) => {
      const page = paged.fetch({ index: pr.index });
      page.data.forEach((r) => {
        rows.push({
          customer_name: String(r.getText({ name: "entity" }) || ""),
          customer_email: String(
            r.getValue({ name: "email", join: "customer" }) || ""
          ),
          customer_id: String(
            r.getValue({ name: "internalid", join: "customer" }) || ""
          ),
          so_number: String(
            r.getValue({ name: "tranid", join: "createdFrom" }) || ""
          ),
          so_id: String(
            r.getValue({ name: "internalid", join: "createdFrom" }) || ""
          ),
          deal_name: String(
            r.getValue({
              name: "custbody_hpl_hs_deal_name",
              join: "createdFrom",
            }) || ""
          ),
          invoice_number: String(r.getValue({ name: "tranid" }) || ""),
          invoice_id: String(r.getValue({ name: "internalid" }) || ""),
          invoice_amount: Number(r.getValue({ name: "amount" }) || 0),
          amount_paid: Number(r.getValue({ name: "amountpaid" }) || 0),
        });
      });
    });
    return rows;
  }

  function toCsv(rows) {
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "Customer Name",
      "Customer Email",
      "Sales Order #",
      "Deal Name",
      "Invoice #",
      "Invoice Amount",
      "Amount Paid",
    ].join(",");
    const body = rows
      .map((r) =>
        [
          esc(r.customer_name),
          esc(r.customer_email),
          esc(r.so_number),
          esc(r.deal_name),
          esc(r.invoice_number),
          Number(r.invoice_amount || 0).toFixed(2),
          Number(r.amount_paid || 0).toFixed(2),
        ].join(",")
      )
      .join("\n");
    return `${header}\n${body}`;
  }

  function renderForm(ctx, rows, q) {
    const form = ui.createForm({ title: TITLE });
    addSearchUI(form, q);

    const count = form.addField({
      id: "custpage_count",
      label: "Total Rows",
      type: ui.FieldType.INTEGER,
    });
    count.updateDisplayType({ displayType: ui.FieldDisplayType.INLINE });
    count.defaultValue = String(rows.length);

    const list = form.addSublist({
      id: "custpage_list",
      type: ui.SublistType.LIST,
      label: "Results",
    });
    list.addField({
      id: "customer_name",
      label: "Customer Name",
      type: ui.FieldType.TEXT,
    });
    list.addField({
      id: "customer_email",
      label: "Customer Email",
      type: ui.FieldType.TEXT,
    });
    const fCustLink = list.addField({
      id: "customer_link",
      label: "Open Customer",
      type: ui.FieldType.URL,
    });
    fCustLink.linkText = "Open";
    list.addField({
      id: "so_number",
      label: "Sales Order #",
      type: ui.FieldType.TEXT,
    });
    const fSoLink = list.addField({
      id: "so_link",
      label: "Open SO",
      type: ui.FieldType.URL,
    });
    fSoLink.linkText = "Open";
    list.addField({
      id: "deal_name",
      label: "Deal Name",
      type: ui.FieldType.TEXT,
    });
    list.addField({
      id: "invoice_number",
      label: "Invoice #",
      type: ui.FieldType.TEXT,
    });
    const fInvLink = list.addField({
      id: "invoice_link",
      label: "Open Invoice",
      type: ui.FieldType.URL,
    });
    fInvLink.linkText = "Open";
    list.addField({
      id: "invoice_amount",
      label: "Invoice Amount",
      type: ui.FieldType.CURRENCY,
    });
    list.addField({
      id: "amount_paid",
      label: "Amount Paid",
      type: ui.FieldType.CURRENCY,
    });

    rows.slice(0, 1000).forEach((r, i) => {
      const custUrl = r.customer_id
        ? url.resolveRecord({
            recordType: "customer",
            recordId: r.customer_id,
            isEditMode: false,
          })
        : "";
      const soUrl = r.so_id
        ? url.resolveRecord({
            recordType: "salesorder",
            recordId: r.so_id,
            isEditMode: false,
          })
        : "";
      const invUrl = r.invoice_id
        ? url.resolveRecord({
            recordType: "invoice",
            recordId: r.invoice_id,
            isEditMode: false,
          })
        : "";

      if (r.customer_name)
        list.setSublistValue({
          id: "customer_name",
          line: i,
          value: r.customer_name,
        });
      if (r.customer_email)
        list.setSublistValue({
          id: "customer_email",
          line: i,
          value: r.customer_email,
        });
      if (custUrl)
        list.setSublistValue({ id: "customer_link", line: i, value: custUrl });

      if (r.so_number)
        list.setSublistValue({ id: "so_number", line: i, value: r.so_number });
      if (soUrl) list.setSublistValue({ id: "so_link", line: i, value: soUrl });

      if (r.deal_name)
        list.setSublistValue({ id: "deal_name", line: i, value: r.deal_name });
      if (r.invoice_number)
        list.setSublistValue({
          id: "invoice_number",
          line: i,
          value: r.invoice_number,
        });
      if (invUrl)
        list.setSublistValue({ id: "invoice_link", line: i, value: invUrl });

      list.setSublistValue({
        id: "invoice_amount",
        line: i,
        value: Number(r.invoice_amount || 0).toFixed(2),
      });
      list.setSublistValue({
        id: "amount_paid",
        line: i,
        value: Number(r.amount_paid || 0).toFixed(2),
      });
    });

    ctx.response.writePage(form);
  }

  function writeCsv(ctx, rows) {
    ctx.response.setHeader({
      name: "Content-Type",
      value: "text/csv; charset=utf-8",
    });
    ctx.response.setHeader({
      name: "Content-Disposition",
      value: 'attachment; filename="so_invoices_totals_paid.csv"',
    });
    ctx.response.write(toCsv(rows));
  }

  function onRequest(ctx) {
    const params = ctx.request.parameters || {};
    const q = (params.custpage_q || "").toString().trim();
    const action = params.action || "view";
    const rows = fetchRows(q);
    if (action === "csv") return writeCsv(ctx, rows);
    return renderForm(ctx, rows, q);
  }

  return { onRequest };
});
