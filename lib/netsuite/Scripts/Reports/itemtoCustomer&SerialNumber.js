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

  function pageLink(itemq, serialq, page, extra) {
    const params = {
      itemq: itemq || "",
      serialq: serialq || "",
      page: String(page || 1),
    };
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

  function sqlFilters({ itemq, serialq }) {
    const parts = [
      "o.type = 'SalesOrd'",
      "NVL(l.isclosed, 'F') = 'F'",
      "l.item IS NOT NULL",
    ];
    const params = [];
    if (itemq) {
      parts.push("i.itemid LIKE ?");
      params.push(`%${itemq}%`);
    }
    if (serialq) {
      parts.push(`EXISTS (
        SELECT 1
        FROM transaction ifl
        JOIN transactionline ifll ON ifl.id = ifll.transaction
        JOIN inventoryassignment ia ON ia.transactionline = ifll.id
        JOIN inventorynumber inv ON inv.id = ia.inventorynumber
        WHERE ifl.type = 'ItemShip'
          AND ifll.createdfrom = o.id
          AND ifll.item = l.item
          AND inv.inventorynumber LIKE ?
      )`);
      params.push(`%${serialq}%`);
    }
    return { where: parts.join(" AND "), params };
  }

  function buildSql({ itemq, serialq, page }) {
    const start = ((page || 1) - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const f = sqlFilters({ itemq, serialq });
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
        WHERE ${f.where}
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
        n.item_id,
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
    const params = f.params.concat([start, end]);
    return { sql, params };
  }

  function buildCountSql({ itemq, serialq }) {
    const f = sqlFilters({ itemq, serialq });
    const sql = `
      SELECT COUNT(*) AS total_rows
      FROM transaction o
      JOIN transactionline l ON o.id = l.transaction
      LEFT JOIN item i ON l.item = i.id
      WHERE ${f.where}
    `;
    return { sql, params: f.params };
  }

  function buildDistinctSql({ itemq, serialq }) {
    const f = sqlFilters({ itemq, serialq });
    const sql = `
      SELECT COUNT(DISTINCT o.entity) AS unique_customers
      FROM transaction o
      JOIN transactionline l ON o.id = l.transaction
      LEFT JOIN item i ON l.item = i.id
      WHERE ${f.where}
    `;
    return { sql, params: f.params };
  }

  function buildCsvSql({ itemq, serialq }) {
    const f = sqlFilters({ itemq, serialq });
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
      WHERE ${f.where}
    )
    SELECT
      customer_name,
      customer_email,
      SUM(qty) AS total_qty
    FROM base
    GROUP BY customer_name, customer_email
    ORDER BY customer_name
  `;
    return { sql, params: f.params };
  }

  function fetchSerialsFor(rows, serialq) {
    if (!rows.length) return {};
    const pairs = [];
    const params = [];
    rows.forEach((r) => {
      if (r.so_id && r.item_id) {
        pairs.push("(ifll.createdfrom = ? AND ifll.item = ?)");
        params.push(r.so_id, r.item_id);
      }
    });
    if (!pairs.length) return {};
    let sql = `
      SELECT
        ifll.createdfrom     AS so_id,
        ifll.item            AS item_id,
        inv.inventorynumber  AS serial
      FROM transaction ifl
      JOIN transactionline ifll
        ON ifl.id = ifll.transaction
      JOIN inventoryassignment ia
        ON ia.transactionline = ifll.id
      JOIN inventorynumber inv
        ON inv.id = ia.inventorynumber
      WHERE ifl.type = 'ItemShip'
        AND (${pairs.join(" OR ")})
    `;
    if (serialq) {
      sql += ` AND inv.inventorynumber LIKE ?`;
      params.push(`%${serialq}%`);
    }
    const rs = query.runSuiteQL({ query: sql, params }).asMappedResults();
    const map = {};
    for (const r of rs) {
      const key = `${r.so_id}|${r.item_id}`;
      if (!map[key]) map[key] = new Set();
      if (r.serial) map[key].add(String(r.serial));
    }
    const out = {};
    Object.keys(map).forEach((k) => {
      out[k] = Array.from(map[k]).sort();
    });
    return out;
  }

  function runQuery({ itemq, serialq, page }) {
    const q = buildSql({ itemq, serialq, page });
    const rs = query
      .runSuiteQL({ query: q.sql, params: q.params })
      .asMappedResults();
    let rows = rs.map((r) => ({
      item_id: r.item_id && Number(r.item_id),
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
      const cntQ = buildCountSql({ itemq, serialq });
      const cnt = query
        .runSuiteQL({ query: cntQ.sql, params: cntQ.params })
        .asMappedResults();
      totalRows = cnt && cnt[0] ? Number(cnt[0].total_rows || 0) : 0;
      const dQ = buildDistinctSql({ itemq, serialq });
      const d = query
        .runSuiteQL({ query: dQ.sql, params: dQ.params })
        .asMappedResults();
      uniqueCustomers = d && d[0] ? Number(d[0].unique_customers || 0) : 0;
    }
    const serialMap = fetchSerialsFor(rows, serialq);
    const expanded = [];
    for (const r of rows) {
      const key = `${r.so_id}|${r.item_id}`;
      const arr = serialMap[key] || [];
      if (arr.length === 0) {
        expanded.push({ ...r, serial: "" });
      } else {
        for (const s of arr) {
          expanded.push({ ...r, serial: s });
        }
      }
    }
    rows = expanded;
    const hasNext = totalRows > page * PAGE_SIZE;
    return { rows, totalRows, uniqueCustomers, hasNext };
  }

  function downloadCsv({ response, itemq, serialq }) {
    const q = buildCsvSql({ itemq, serialq });
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
    const fname = `customers_${safeFileName(itemq || serialq)}.csv`;
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
    serialq,
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

    const fldItem = form.addField({
      id: "custpage_itemq",
      label: "SEARCH ITEM (NAME/SKU; PARTIAL)",
      type: ui.FieldType.TEXT,
      container: "grp_search",
    });
    if (itemq) fldItem.defaultValue = itemq;

    const fldSerial = form.addField({
      id: "custpage_serialq",
      label: "SEARCH SERIAL (PARTIAL)",
      type: ui.FieldType.TEXT,
      container: "grp_search",
    });
    if (serialq) fldSerial.defaultValue = serialq;

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
    const csvUrl =
      itemq || serialq ? pageLink(itemq, serialq, page, { action: "csv" }) : "";
    const summaryHtml =
      itemq || serialq
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
          ${itemq ? `<div class="badge"><b>Item:</b> ${esc(itemq)}</div>` : ""}
          ${
            serialq
              ? `<div class="badge"><b>Serial:</b> ${esc(serialq)}</div>`
              : ""
          }
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
                    pageLink(itemq, serialq, page - 1)
                  )}">◀ Prev</a>`
                : ""
            }
            ${
              hasNext
                ? `<a class="btn" href="${esc(
                    pageLink(itemq, serialq, page + 1)
                  )}">Next ▶</a>`
                : ""
            }
          </div>
        </div>
      `
        : `<div style="color:#6b7280;padding:8px 0;">Enter an Item SKU/name and/or a Serial, then press Search.</div>`;
    summary.defaultValue = summaryHtml;

    const html = form.addField({
      id: "custpage_tbl",
      label: " ",
      type: ui.FieldType.INLINEHTML,
      container: "grp_info",
    });

    let rowsHtml = "";
    if (itemq || serialq) {
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
            <td>${esc(r.serial || "")}</td>
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
              <th style="text-align:left;">Serial</th>
              <th style="text-align:right;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${
              rowsHtml ||
              (itemq || serialq
                ? `<tr><td colspan="7" style="padding:12px;color:#6b7280">No results.</td></tr>`
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
      const serialq = (request.parameters.serialq || "").trim();
      if (action === "csv" && (itemq || serialq)) {
        downloadCsv({ response, itemq, serialq });
        return;
      }
      const page = Math.max(1, Number(request.parameters.page || 1) || 1);
      if (!itemq && !serialq) {
        renderForm({
          response,
          rows: [],
          totalRows: 0,
          uniqueCustomers: 0,
          itemq: "",
          serialq: "",
          page: 1,
          hasNext: false,
        });
        return;
      }
      const data = runQuery({ itemq, serialq, page });
      renderForm({ response, itemq, serialq, page, ...data });
      return;
    }

    if (method === "POST") {
      const itemq = (request.parameters.custpage_itemq || "").trim();
      const serialq = (request.parameters.custpage_serialq || "").trim();
      const page = Math.max(
        1,
        Number(request.parameters.custpage_page || 1) || 1
      );
      redirect.toSuitelet({
        scriptId: runtime.getCurrentScript().id,
        deploymentId: runtime.getCurrentScript().deploymentId,
        parameters: { itemq, serialq, page },
      });
    }
  }

  return { onRequest };
});
