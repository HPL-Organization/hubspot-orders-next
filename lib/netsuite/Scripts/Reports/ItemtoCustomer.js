/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/query", "N/url", "N/runtime", "N/redirect"], (
  ui,
  query,
  url,
  runtime,
  redirect
) => {
  const PAGE_SIZE = 200;

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  function pageLink(itemq, page, extra) {
    const params = { itemq: itemq || "", page: String(page || 1) };
    if (extra) Object.keys(extra).forEach((k) => (params[k] = extra[k]));
    return url.resolveScript({
      scriptId: runtime.getCurrentScript().id,
      deploymentId: runtime.getCurrentScript().deploymentId,
      returnExternalUrl: false,
      params,
    });
  }

  function resolveSoUrl(id) {
    if (!id) return "";
    return (
      url.resolveRecord({
        recordType: "salesorder",
        recordId: id,
        isEditMode: false,
      }) || ""
    );
  }

  function resolveCustomerUrl(id) {
    if (!id) return "";
    return (
      url.resolveRecord({
        recordType: "customer",
        recordId: id,
        isEditMode: false,
      }) || ""
    );
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function safeFileName(s) {
    return (
      String(s || "export")
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .slice(0, 80) || "export"
    );
  }

  function buildSql({ itemq, page }) {
    const likeParam = `%${itemq}%`;
    const start = ((page || 1) - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const sql = `
      WITH base AS (
        SELECT
          l.item AS item_id,
          COALESCE(i.displayname, i.itemid) AS item_name,
          o.id AS so_id,
          o.tranid AS so_number,
          TO_CHAR(o.trandate, 'YYYY-MM-DD') AS so_date,
          ABS(NVL(l.quantity,0)) AS qty,
          o.entity AS customer_id,
          COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,
          c.email AS customer_email
        FROM transaction o
        JOIN transactionline l ON o.id = l.transaction
        JOIN customer c ON o.entity = c.id
        LEFT JOIN item i ON l.item = i.id
        WHERE o.type = 'SalesOrd'
          AND NVL(l.isclosed, 'F') = 'F'
          AND l.item IS NOT NULL
          AND i.itemid LIKE ?
      ),
      distinct_customers AS (
        SELECT DISTINCT customer_id FROM base
      ),
      counts AS (
        SELECT
          (SELECT COUNT(*) FROM base) AS total_rows,
          (SELECT COUNT(*) FROM distinct_customers) AS unique_customers
      ),
      numbered AS (
        SELECT
          b.*,
          ROW_NUMBER() OVER (ORDER BY b.item_name, b.so_date DESC, b.so_number) AS rn
        FROM base b
      )
      SELECT
        n.item_name,
        n.so_id,
        n.so_number,
        n.so_date,
        n.qty,
        n.customer_id,
        n.customer_name,
        n.customer_email,
        c.total_rows,
        c.unique_customers
      FROM numbered n
      CROSS JOIN counts c
      WHERE n.rn > ? AND n.rn <= ?
      ORDER BY n.rn
    `;
    return { sql, params: [likeParam, start, end] };
  }

  function buildCountSql({ itemq }) {
    const likeParam = `%${itemq}%`;
    const sql = `
      SELECT COUNT(*) AS total_rows
      FROM transaction o
      JOIN transactionline l ON o.id = l.transaction
      LEFT JOIN item i ON l.item = i.id
      WHERE o.type = 'SalesOrd'
        AND NVL(l.isclosed, 'F') = 'F'
        AND l.item IS NOT NULL
        AND i.itemid LIKE ?
    `;
    return { sql, params: [likeParam] };
  }

  function buildCsvSql({ itemq }) {
    const likeParam = `%${itemq}%`;
    const sql = `
    WITH base AS (
      SELECT
        o.entity AS customer_id,
        COALESCE(c.companyname, c.fullname, c.altname) AS customer_name,
        c.email AS customer_email,
        ABS(NVL(l.quantity,0)) AS qty
      FROM transaction o
      JOIN transactionline l ON o.id = l.transaction
      JOIN customer c ON o.entity = c.id
      LEFT JOIN item i ON l.item = i.id
      WHERE o.type = 'SalesOrd'
        AND NVL(l.isclosed, 'F') = 'F'
        AND l.item IS NOT NULL
        AND i.itemid LIKE ?
    )
    SELECT
      customer_name,
      customer_email,
      SUM(qty) AS total_qty
    FROM base
    GROUP BY customer_name, customer_email
    ORDER BY customer_name
  `;
    return { sql, params: [likeParam] };
  }

  function runQuery({ itemq, page }) {
    const q = buildSql({ itemq, page });
    const rs = query
      .runSuiteQL({ query: q.sql, params: q.params })
      .asMappedResults();
    let rows = rs.map((r) => ({
      item_name: r.item_name,
      so_id: r.so_id && Number(r.so_id),
      so_number: r.so_number,
      so_date: r.so_date,
      qty: r.qty == null ? null : Number(r.qty),
      customer_id: r.customer_id && Number(r.customer_id),
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      total_rows: r.total_rows && Number(r.total_rows),
      unique_customers: r.unique_customers && Number(r.unique_customers),
    }));
    let totalRows = 0;
    let uniqueCustomers = 0;
    if (rows.length) {
      totalRows = rows[0].total_rows || 0;
      uniqueCustomers = rows[0].unique_customers || 0;
    } else {
      const cntQ = buildCountSql({ itemq });
      const cnt = query
        .runSuiteQL({ query: cntQ.sql, params: cntQ.params })
        .asMappedResults();
      totalRows = cnt && cnt[0] ? Number(cnt[0].total_rows || 0) : 0;
      const sqlDistinct = `
        SELECT COUNT(DISTINCT o.entity) AS unique_customers
        FROM transaction o
        JOIN transactionline l ON o.id = l.transaction
        LEFT JOIN item i ON l.item = i.id
        WHERE o.type = 'SalesOrd'
          AND NVL(l.isclosed, 'F') = 'F'
          AND l.item IS NOT NULL
          AND i.itemid LIKE ?
      `;
      const d = query
        .runSuiteQL({ query: sqlDistinct, params: [`%${itemq}%`] })
        .asMappedResults();
      uniqueCustomers = d && d[0] ? Number(d[0].unique_customers || 0) : 0;
    }
    const hasNext = totalRows > page * PAGE_SIZE;
    return { rows, totalRows, uniqueCustomers, hasNext };
  }

  function downloadCsv({ response, itemq }) {
    const q = buildCsvSql({ itemq });
    const rs = query
      .runSuiteQL({ query: q.sql, params: q.params })
      .asMappedResults();
    const header = "Name,Email,Quantity";
    const lines = rs.map(
      (r) =>
        `${csvEscape(r.customer_name || "")},${csvEscape(
          r.customer_email || ""
        )},${Number(r.total_qty || 0)}`
    );
    const csv = [header].concat(lines).join("\n");
    const fname = `customers_${safeFileName(itemq)}.csv`;
    response.setHeader({
      name: "Content-Type",
      value: "text/csv; charset=utf-8",
    });
    response.setHeader({
      name: "Content-Disposition",
      value: `attachment; filename="${fname}"`,
    });
    response.write(csv);
  }

  function renderForm({
    response,
    rows,
    totalRows,
    uniqueCustomers,
    itemq,
    page,
    hasNext,
  }) {
    const form = ui.createForm({
      title: "Item → Sales Orders → Customer Emails",
    });

    const gSearch = form.addFieldGroup({ id: "grp_search", label: "Search" });
    const gInfo = form.addFieldGroup({
      id: "grp_info",
      label: "Summary & Results",
    });
    gInfo.isSingleColumn = true;

    const fldQ = form.addField({
      id: "custpage_itemq",
      label: "SEARCH ITEM (NAME/SKU; SUPPORTS PARTIAL)",
      type: ui.FieldType.TEXT,
      container: "grp_search",
    });
    if (itemq) fldQ.defaultValue = itemq;

    const fldPage = form.addField({
      id: "custpage_page",
      label: "Page",
      type: ui.FieldType.INTEGER,
      container: "grp_search",
    });
    fldPage.updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN });
    fldPage.defaultValue = String(page || 1);

    form.addSubmitButton({ label: "Search" });

    const summary = form.addField({
      id: "custpage_summary",
      label: " ",
      type: ui.FieldType.INLINEHTML,
      container: "grp_info",
    });
    const csvUrl = itemq ? pageLink(itemq, page, { action: "csv" }) : "";
    const summaryHtml = itemq
      ? `
        <style>
          .bar{margin:8px 0 10px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
          .badge{padding:10px 14px;border-radius:10px;border:1px solid #e5e7eb;background:#f3f4f6}
          .badge.blue{background:#eef7ff;border-color:#bfdbfe}
          .badge.green{background:#e8f5e9;border-color:#c8e6c9}
          .push{margin-left:auto;display:flex;gap:8px}
          .btn{text-decoration:none;padding:8px 10px;border:1px solid #ddd;border-radius:8px;background:#fff}
          .btn.primary{border-color:#2563eb;background:#2563eb;color:#fff}
        </style>
        <div class="bar">
          <div class="badge"><b>Query:</b> ${esc(itemq)}</div>
          <div class="badge blue"><b>Total Rows:</b> ${esc(totalRows)}</div>
          <div class="badge green"><b>Unique Customers:</b> ${esc(
            uniqueCustomers
          )}</div>
          <div class="push">
            ${
              csvUrl
                ? `<a class="btn primary" href="${esc(
                    csvUrl
                  )}">Download CSV</a>`
                : ""
            }
            ${
              page > 1
                ? `<a class="btn" href="${esc(
                    pageLink(itemq, page - 1)
                  )}">◀ Prev</a>`
                : ""
            }
            ${
              hasNext
                ? `<a class="btn" href="${esc(
                    pageLink(itemq, page + 1)
                  )}">Next ▶</a>`
                : ""
            }
          </div>
        </div>
      `
      : `<div style="color:#6b7280;padding:8px 0;">Enter a SKU or name and press Search.</div>`;
    summary.defaultValue = summaryHtml;

    const html = form.addField({
      id: "custpage_tbl",
      label: " ",
      type: ui.FieldType.INLINEHTML,
      container: "grp_info",
    });

    let rowsHtml = "";
    if (itemq) {
      rowsHtml = rows
        .map((r) => {
          const soUrl = r.so_id ? resolveSoUrl(r.so_id) : "";
          const custUrl = r.customer_id
            ? resolveCustomerUrl(r.customer_id)
            : "";
          const soLink = soUrl
            ? `<a href="${esc(soUrl)}" target="_blank">${esc(
                r.so_number || r.so_id
              )}</a>`
            : esc(r.so_number || "");
          const custLink = custUrl
            ? `<a style="display:inline-block;padding:6px 10px;border-radius:999px;background:#111827;color:#fff;font-weight:700;text-decoration:none" href="${esc(
                custUrl
              )}" target="_blank">${esc(r.customer_name || r.customer_id)}</a>`
            : `<span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#111827;color:#fff;font-weight:700">${esc(
                r.customer_name || r.customer_id || ""
              )}</span>`;
          const mail = r.customer_email
            ? `<a style="font-weight:700;text-decoration:none" href="mailto:${esc(
                r.customer_email
              )}">${esc(r.customer_email)}</a>`
            : `<span style="color:#6b7280">No email</span>`;
          return `
          <tr>
            <td style="width:280px">${custLink}</td>
            <td style="width:260px">${mail}</td>
            <td>${soLink}</td>
            <td>${esc(r.so_date || "")}</td>
            <td>${esc(r.item_name || "")}</td>
            <td style="text-align:right">${esc(r.qty == null ? "" : r.qty)}</td>
          </tr>
        `;
        })
        .join("");
    }

    html.defaultValue = `
      <style>
        .tbl{width:100%;border-collapse:separate;border-spacing:0}
        .tbl thead{background:#f9fafb;border-bottom:1px solid #e5e7eb}
        .tbl th,.tbl td{padding:12px 14px}
        .tbl tbody tr:nth-child(even){background:#fcfcfd}
      </style>
      <div style="margin-top:6px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <table class="tbl">
          <thead>
            <tr>
              <th style="text-align:left;">Customer</th>
              <th style="text-align:left;">Email</th>
              <th style="text-align:left;">SO #</th>
              <th style="text-align:left;">SO Date</th>
              <th style="text-align:left;">Item</th>
              <th style="text-align:right;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${
              rowsHtml ||
              (itemq
                ? `<tr><td colspan="6" style="padding:12px;color:#6b7280">No results.</td></tr>`
                : ``)
            }
          </tbody>
        </table>
      </div>
    `;

    response.writePage(form);
  }

  function onRequest(ctx) {
    const { request, response } = ctx;
    const method = request.method;
    const action = (request.parameters.action || "").trim().toLowerCase();

    if (method === "GET") {
      const itemq = (request.parameters.itemq || "").trim();
      if (action === "csv" && itemq) {
        downloadCsv({ response, itemq });
        return;
      }
      const page = Math.max(1, Number(request.parameters.page || 1) || 1);
      if (!itemq) {
        renderForm({
          response,
          rows: [],
          totalRows: 0,
          uniqueCustomers: 0,
          itemq: "",
          page: 1,
          hasNext: false,
        });
        return;
      }
      const data = runQuery({ itemq, page });
      renderForm({ response, itemq, page, ...data });
      return;
    }

    if (method === "POST") {
      const itemq = (request.parameters.custpage_itemq || "").trim();
      const page = Math.max(
        1,
        Number(request.parameters.custpage_page || 1) || 1
      );
      redirect.toSuitelet({
        scriptId: runtime.getCurrentScript().id,
        deploymentId: runtime.getCurrentScript().deploymentId,
        parameters: { itemq, page },
      });
    }
  }

  return { onRequest };
});
