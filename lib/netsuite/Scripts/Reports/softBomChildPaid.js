/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/url", "N/runtime"], (
  serverWidget,
  search,
  url,
  runtime
) => {
  const PAID_FLAG = "custcol_hpl_itempaid";
  const SOFT_CHILD_FLAG = "custcol_hpl_softbom_child";
  const SOFT_GROUPKEY = "custcol_hpl_softbom_groupkey";

  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    const params = ctx.request.parameters || {};
    const download = String(params.download || "").toUpperCase() === "T";
    const soIdParam = String(params.soid || "").trim();
    const daysParam = Number(params.days || 365);

    const cs = runtime.getCurrentScript();
    const baseUrl = url.resolveScript({
      scriptId: cs.id,
      deploymentId: cs.deploymentId,
      returnExternalUrl: false,
    });

    const queryParts = [];
    if (soIdParam) queryParts.push("soid=" + encodeURIComponent(soIdParam));
    if (Number.isFinite(daysParam) && daysParam > 0)
      queryParts.push("days=" + encodeURIComponent(String(daysParam)));

    const downloadUrl =
      baseUrl +
      (baseUrl.indexOf("?") === -1 ? "?" : "&") +
      (queryParts.length ? queryParts.join("&") + "&" : "") +
      "download=T";

    const rows = buildMismatchRows({
      soId: soIdParam ? Number(soIdParam) : null,
      days:
        Number.isFinite(daysParam) && daysParam > 0
          ? Math.floor(daysParam)
          : 365,
    });

    if (download) {
      const header = [
        "so_internal_id",
        "so_number",
        "group_key",
        "parent_line",
        "parent_item",
        "parent_paid",
        "child_line",
        "child_item",
        "child_paid",
      ];

      const csv = [header.join(",")]
        .concat(rows.map((r) => header.map((k) => csvCell(r[k])).join(",")))
        .join("\n");

      ctx.response.addHeader({
        name: "Content-Type",
        value: "text/csv; charset=utf-8",
      });
      ctx.response.addHeader({
        name: "Content-Disposition",
        value: `attachment; filename="softbom_child_paid_parent_unpaid.csv"`,
      });
      ctx.response.write(csv);
      return;
    }

    const form = serverWidget.createForm({
      title: "Soft BOM Audit — Child Paid but Parent Unpaid",
    });

    const info = form.addField({
      id: "custpage_info",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    const filtersText =
      `<div style="padding:8px 0;">` +
      `<b>Rows found:</b> ${rows.length}` +
      `</div>` +
      `<div style="padding:6px 0;">` +
      `<b>Filters:</b> ` +
      (soIdParam
        ? `SO Internal ID = ${escapeHtml(soIdParam)}`
        : `Last ${escapeHtml(String(daysParam || 365))} days`) +
      `</div>` +
      `<div style="padding:6px 0;">` +
      `<a href="${downloadUrl}" target="_blank">Download CSV</a>` +
      `</div>` +
      `<div style="padding:6px 0; font-size:12px; color:#555;">` +
      `Tip: add <code>&soid=631823</code> to test a single SO, or change <code>&days=365</code> for older history.` +
      `</div>`;

    info.defaultValue = filtersText;

    const sublist = form.addSublist({
      id: "custpage_list",
      type: serverWidget.SublistType.LIST,
      label: "Mismatches",
    });

    const soUrlField = sublist.addField({
      id: "so_url",
      type: serverWidget.FieldType.URL,
      label: "SO Link",
    });
    soUrlField.linkText = "Open";

    sublist.addField({
      id: "so_internal_id",
      type: serverWidget.FieldType.TEXT,
      label: "SO Internal ID",
    });
    sublist.addField({
      id: "so_number",
      type: serverWidget.FieldType.TEXT,
      label: "SO #",
    });
    sublist.addField({
      id: "group_key",
      type: serverWidget.FieldType.TEXT,
      label: "Soft BOM Group Key",
    });

    sublist.addField({
      id: "parent_line",
      type: serverWidget.FieldType.TEXT,
      label: "Parent Line",
    });
    sublist.addField({
      id: "parent_item",
      type: serverWidget.FieldType.TEXT,
      label: "Parent Item",
    });
    sublist.addField({
      id: "parent_paid",
      type: serverWidget.FieldType.TEXT,
      label: "Parent Paid",
    });

    sublist.addField({
      id: "child_line",
      type: serverWidget.FieldType.TEXT,
      label: "Child Line",
    });
    sublist.addField({
      id: "child_item",
      type: serverWidget.FieldType.TEXT,
      label: "Child Item",
    });
    sublist.addField({
      id: "child_paid",
      type: serverWidget.FieldType.TEXT,
      label: "Child Paid",
    });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const soLink = url.resolveRecord({
        recordType: "salesorder",
        recordId: Number(r.so_internal_id),
        isEditMode: false,
      });

      safeSet(sublist, "so_url", i, soLink);
      safeSet(sublist, "so_internal_id", i, r.so_internal_id);
      safeSet(sublist, "so_number", i, r.so_number);
      safeSet(sublist, "group_key", i, r.group_key);

      safeSet(sublist, "parent_line", i, r.parent_line);
      safeSet(sublist, "parent_item", i, r.parent_item);
      safeSet(sublist, "parent_paid", i, r.parent_paid);

      safeSet(sublist, "child_line", i, r.child_line);
      safeSet(sublist, "child_item", i, r.child_item);
      safeSet(sublist, "child_paid", i, r.child_paid);
    }

    ctx.response.writePage(form);
  }

  function buildMismatchRows(opts) {
    const soId = opts.soId;
    const days = opts.days;

    const filters = [
      ["mainline", "is", "F"],
      "and",
      [SOFT_GROUPKEY, "isnotempty", ""],
    ];

    if (soId && Number.isFinite(soId)) {
      filters.push("and", ["internalid", "anyof", String(soId)]);
    } else if (days && Number.isFinite(days) && days > 0) {
      filters.push("and", ["trandate", "onorafter", `daysAgo${days}`]);
    }

    const cols = [
      search.createColumn({ name: "internalid" }),
      search.createColumn({ name: "tranid" }),
      search.createColumn({ name: "line" }),
      search.createColumn({ name: "item" }),
      search.createColumn({ name: SOFT_GROUPKEY }),
      search.createColumn({ name: SOFT_CHILD_FLAG }),
      search.createColumn({ name: PAID_FLAG }),
    ];

    const s = search.create({
      type: search.Type.SALES_ORDER,
      filters,
      columns: cols,
    });

    const bySoGroup = new Map();
    const soMeta = new Map();

    s.runPaged({ pageSize: 1000 }).pageRanges.forEach((range) => {
      const page = s.runPaged({ pageSize: 1000 }).fetch({ index: range.index });
      page.data.forEach((res) => {
        const soInternalId = String(res.getValue({ name: "internalid" }) || "");
        const soNumber = String(res.getValue({ name: "tranid" }) || "");
        soMeta.set(soInternalId, soNumber);

        const groupKey = String(
          res.getValue({ name: SOFT_GROUPKEY }) || ""
        ).trim();
        if (!groupKey) return;

        const lineNo = String(res.getValue({ name: "line" }) || "");
        const itemText = String(
          res.getText({ name: "item" }) || res.getValue({ name: "item" }) || ""
        );

        const isChild = truthy(res.getValue({ name: SOFT_CHILD_FLAG }));
        const isPaid = truthy(res.getValue({ name: PAID_FLAG }));

        const key = soInternalId + "||" + groupKey;
        let bucket = bySoGroup.get(key);
        if (!bucket) {
          bucket = { soInternalId, groupKey, parents: [], children: [] };
          bySoGroup.set(key, bucket);
        }

        const entry = { lineNo, itemText, isPaid };

        if (isChild) bucket.children.push(entry);
        else bucket.parents.push(entry);
      });
    });

    const out = [];

    for (const bucket of bySoGroup.values()) {
      const anyParentPaid = bucket.parents.some((p) => p.isPaid === true);

      if (anyParentPaid) continue;

      for (const c of bucket.children) {
        if (!c.isPaid) continue;

        const parentExample = bucket.parents.length ? bucket.parents[0] : null;

        out.push({
          so_internal_id: bucket.soInternalId,
          so_number: soMeta.get(bucket.soInternalId) || "",
          group_key: bucket.groupKey,
          parent_line: parentExample ? parentExample.lineNo : "",
          parent_item: parentExample
            ? parentExample.itemText
            : "(no parent line found)",
          parent_paid: "F",
          child_line: c.lineNo,
          child_item: c.itemText,
          child_paid: "T",
        });
      }
    }

    return out;
  }

  function truthy(v) {
    if (v === true || v === "T") return true;
    if (v === false || v === "F") return false;
    if (v == null) return false;
    const s = String(v).trim().toUpperCase();
    return s === "T" || s === "TRUE" || s === "1" || s === "Y";
  }

  function safeSet(sublist, id, line, val) {
    if (val === null || val === undefined) return;
    const s = String(val);
    if (!s || s === "null" || s === "undefined") return;
    sublist.setSublistValue({ id, line, value: s });
  }

  function csvCell(v) {
    if (v == null) return "";
    const s = String(v);
    const needs =
      s.includes(",") ||
      s.includes('"') ||
      s.includes("\n") ||
      s.includes("\r");
    if (!needs) return s;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return { onRequest };
});
