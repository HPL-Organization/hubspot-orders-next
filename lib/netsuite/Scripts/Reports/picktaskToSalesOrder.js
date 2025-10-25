/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/url", "N/log"], (
  ui,
  search,
  url,
  log
) => {
  const TITLE = "Pick Cartons → Sales Orders";
  const SEARCH_ID = "customsearch1836";

  const v = (x) => (x == null ? "" : String(x));
  const clean = (s) => (s && s !== "undefined" && s !== "null" ? s : "");

  function header(form, rowCount, uniqueCartons) {
    form.addField({
      id: "custpage_hdr",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `<div style="display:flex;gap:12px;align-items:center;margin:12px 0 8px;flex-wrap:wrap;">
         <div style="padding:12px 14px;border-radius:10px;background:#0b5fff0d;border:1px solid #dfe6ff;">
           <div style="font-size:12px;margin-bottom:4px;font-weight:600;">${TITLE}</div>
           <div style="font-size:18px;font-weight:800;">Total Rows: ${
             rowCount || 0
           }</div>
         </div>
         <div style="padding:12px 14px;border-radius:10px;background:#f6f7fb;border:1px solid #e6e8f0;">
           <div style="font-size:12px;margin-bottom:4px;font-weight:600;">Unique Pick Cartons</div>
           <div style="font-size:18px;font-weight:800;">${
             uniqueCartons || 0
           }</div>
         </div>
       </div>`;
  }

  function addSearchField(form, cartonVal) {
    form.addFieldGroup({ id: "custpage_grp", label: "Search" });
    const f = form.addField({
      id: "custpage_carton_like",
      type: ui.FieldType.TEXT,
      label: "Pick Carton contains",
      container: "custpage_grp",
    });
    if (cartonVal) f.defaultValue = cartonVal;
    form.addSubmitButton({ label: "Search" });
  }

  function ensureColumns(s) {
    const has = (name, join, formula) =>
      s.columns.some(
        (c) =>
          c.name === name &&
          (c.join || "") === (join || "") &&
          (c.formula || "") === (formula || "")
      );
    const extra = [];
    if (!has("formulatext", null, "{inventorydetail.pickcarton}"))
      extra.push(
        search.createColumn({
          name: "formulatext",
          formula: "{inventorydetail.pickcarton}",
          label: "Pick Carton",
        })
      );
    if (!has("createdfrom"))
      extra.push(search.createColumn({ name: "createdfrom" }));
    if (!has("tranid", "createdFrom"))
      extra.push(search.createColumn({ name: "tranid", join: "createdFrom" }));
    if (!has("internalid"))
      extra.push(search.createColumn({ name: "internalid" }));
    if (!has("tranid")) extra.push(search.createColumn({ name: "tranid" }));
    if (!has("item")) extra.push(search.createColumn({ name: "item" }));
    if (!has("quantity")) extra.push(search.createColumn({ name: "quantity" }));
    if (!has("location")) extra.push(search.createColumn({ name: "location" }));
    if (!has("recordtype"))
      extra.push(search.createColumn({ name: "recordtype" }));
    if (extra.length) s.columns = s.columns.concat(extra);
    return s;
  }

  function loadBaseSearch() {
    try {
      const s = search.load({ id: SEARCH_ID });
      return ensureColumns(s);
    } catch (e) {
      log.error("Failed to load saved search; using fallback", e);
      return search.create({
        type: "transaction",
        filters: [
          ["mainline", "is", "F"],
          "AND",
          ["inventorydetail.pickcarton", "isnotempty", ""],
        ],
        columns: [
          search.createColumn({
            name: "formulatext",
            formula: "{inventorydetail.pickcarton}",
          }),
          search.createColumn({ name: "createdfrom" }),
          search.createColumn({ name: "tranid", join: "createdFrom" }),
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: "tranid" }),
          search.createColumn({ name: "item" }),
          search.createColumn({ name: "quantity" }),
          search.createColumn({ name: "location" }),
          search.createColumn({ name: "recordtype" }),
        ],
      });
    }
  }

  function appendCartonFilter(s, carton) {
    if (!carton) return s;
    var existing = [];
    if (s.filters) {
      existing = Array.isArray(s.filters) ? s.filters.slice() : [s.filters];
    }
    existing.push(
      search.createFilter({
        name: "pickcarton",
        join: "inventorydetail",
        operator: search.Operator.CONTAINS,
        values: carton,
      })
    );
    s.filters = existing;
    return s;
  }

  function getSoUrl(soId) {
    if (!soId) return "";
    try {
      return url.resolveRecord({
        recordType: "salesorder",
        recordId: soId,
        isEditMode: false,
      });
    } catch {
      return "";
    }
  }

  function runPagedLatestOnly(s) {
    const bestByCarton = {};
    const paged = s.runPaged({ pageSize: 1000 });
    paged.pageRanges.forEach((pr) => {
      const page = paged.fetch({ index: pr.index });
      page.data.forEach((r) => {
        const carton = r.getValue({ name: "formulatext" }) || "";
        if (!carton) return;
        const soid = r.getValue({ name: "createdfrom" }) || "";
        const soidNum = Number(soid) || 0;
        const current = bestByCarton[carton];
        if (!current || soidNum > current._soidNum) {
          bestByCarton[carton] = {
            carton,
            rectype: r.getValue({ name: "recordtype" }) || "",
            txid: r.getValue({ name: "internalid" }),
            txnum: r.getValue({ name: "tranid" }),
            soid,
            sonum: r.getValue({ name: "tranid", join: "createdFrom" }) || "",
            sohref: getSoUrl(soid),
            item: r.getText({ name: "item" }) || r.getValue({ name: "item" }),
            qty: r.getValue({ name: "quantity" }),
            location:
              r.getText({ name: "location" }) ||
              r.getValue({ name: "location" }),
            _soidNum: soidNum,
          };
        }
      });
    });
    const rows = Object.keys(bestByCarton)
      .sort()
      .map((k) => {
        const o = bestByCarton[k];
        delete o._soidNum;
        return o;
      });
    return { rows, uniqueCartons: rows.length };
  }

  function makeList(form) {
    const list = form.addSublist({
      id: "custpage_list",
      label: "Results",
      type: ui.SublistType.LIST,
    });
    list.addField({
      id: "carton",
      type: ui.FieldType.TEXT,
      label: "Pick Carton #",
    });
    list.addField({
      id: "rectype",
      type: ui.FieldType.TEXT,
      label: "Trans Type",
    });
    list.addField({
      id: "txid",
      type: ui.FieldType.TEXT,
      label: "Transaction (ID)",
    });
    list.addField({
      id: "txnum",
      type: ui.FieldType.TEXT,
      label: "Transaction #",
    });
    const soUrl = list.addField({
      id: "solink",
      type: ui.FieldType.URL,
      label: "SO Link",
    });
    soUrl.linkText = "Open SO";
    list.addField({ id: "soid", type: ui.FieldType.TEXT, label: "SO (ID)" });
    list.addField({ id: "sonum", type: ui.FieldType.TEXT, label: "SO Number" });
    list.addField({ id: "item", type: ui.FieldType.TEXT, label: "Item" });
    list.addField({ id: "qty", type: ui.FieldType.TEXT, label: "Qty" });
    list.addField({
      id: "location",
      type: ui.FieldType.TEXT,
      label: "Location",
    });
    return list;
  }

  function onRequest(ctx) {
    const params = ctx.request.parameters || {};
    const carton = clean(params.custpage_carton_like);

    const form = ui.createForm({ title: TITLE });
    addSearchField(form, carton);

    const s = appendCartonFilter(loadBaseSearch(), carton);
    const { rows, uniqueCartons } = runPagedLatestOnly(s);

    header(form, rows.length, uniqueCartons);

    const list = makeList(form);
    rows.forEach((r, i) => {
      if (r.carton)
        list.setSublistValue({ id: "carton", line: i, value: v(r.carton) });
      if (r.rectype)
        list.setSublistValue({ id: "rectype", line: i, value: v(r.rectype) });
      if (r.txid)
        list.setSublistValue({ id: "txid", line: i, value: v(r.txid) });
      if (r.txnum)
        list.setSublistValue({ id: "txnum", line: i, value: v(r.txnum) });
      if (r.sohref)
        list.setSublistValue({ id: "solink", line: i, value: v(r.sohref) });
      if (r.soid)
        list.setSublistValue({ id: "soid", line: i, value: v(r.soid) });
      if (r.sonum)
        list.setSublistValue({ id: "sonum", line: i, value: v(r.sonum) });
      if (r.item)
        list.setSublistValue({ id: "item", line: i, value: v(r.item) });
      if (r.qty != null)
        list.setSublistValue({ id: "qty", line: i, value: v(r.qty) });
      if (r.location)
        list.setSublistValue({ id: "location", line: i, value: v(r.location) });
    });

    form.addField({
      id: "custpage_note",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue =
      '<div style="margin-top:8px;color:#666;font-size:11px;">' +
      "Source: saved search <b>customsearch1836</b>. Type a carton and click <b>Search</b>. Only the latest Sales Order per carton is shown." +
      "</div>";

    ctx.response.writePage(form);
  }

  return { onRequest };
});
