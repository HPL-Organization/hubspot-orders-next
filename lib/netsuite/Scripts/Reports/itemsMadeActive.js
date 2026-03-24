/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/log"], function (
  serverWidget,
  search,
  log
) {
  var DEFAULT_DAYS_BACK = 4;
  var MAX_NOTES = 2000; // safety cap

  function csvEscape(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    if (s.indexOf('"') !== -1) s = s.replace(/"/g, '""');
    if (s.search(/["\,\n\r]/) !== -1) s = '"' + s + '"';
    return s;
  }

  function toCsv(rows) {
    var headers = [
      "Latest Activation Note Date/Time",
      "Item Internal ID",
      "SKU",
      "Item Name",
    ];
    var out = [];
    out.push(headers.join(","));
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push(
        [
          csvEscape(r.note_date),
          csvEscape(r.item_id),
          csvEscape(r.item_sku),
          csvEscape(r.item_name),
        ].join(",")
      );
    }
    return out.join("\n");
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // Build item metadata map AND include current isinactive status
  function buildItemMap(itemIds) {
    var map = {};
    if (!itemIds || !itemIds.length) return map;

    function toBoolTF(v) {
      // NetSuite sometimes returns boolean true/false, sometimes 'T'/'F'
      if (v === true) return true;
      if (v === false) return false;
      var s = String(v || "").toUpperCase();
      return s === "T" || s === "TRUE";
    }

    var chunks = chunk(itemIds, 900);
    for (var c = 0; c < chunks.length; c++) {
      var ids = chunks[c];

      var s = search.create({
        type: "item",
        filters: [["internalid", "anyof", ids]],
        columns: ["internalid", "itemid", "displayname", "isinactive"],
      });

      var paged = s.runPaged({ pageSize: 1000 });
      paged.pageRanges.forEach(function (pr) {
        var page = paged.fetch({ index: pr.index });
        page.data.forEach(function (r) {
          var id = String(r.getValue({ name: "internalid" }) || "");
          if (!id) return;

          var inactiveVal = r.getValue({ name: "isinactive" });

          map[id] = {
            sku: r.getValue({ name: "itemid" }) || "",
            name: r.getValue({ name: "displayname" }) || "",
            isinactive: toBoolTF(inactiveVal), // <-- boolean
          };
        });
      });
    }
    return map;
  }

  function fieldLooksLikeInactive(fieldVal) {
    var f = String(fieldVal || "").toLowerCase();
    return (
      f === "inactive" || f === "isinactive" || f.indexOf("inactive") !== -1
    );
  }

  function fetchActivationNotes(daysBack) {
    var daysAgoToken = "daysago" + String(daysBack);

    // Base filters: date + old/new values (supported)
    var baseFilters = [
      ["date", "onorafter", daysAgoToken],
      "AND",
      ["oldvalue", "is", "T"],
      "AND",
      ["newvalue", "is", "F"],
    ];

    var filtersWithName = baseFilters.concat([
      "AND",
      ["name", "contains", "Inactive"],
    ]);

    var columns = [
      search.createColumn({ name: "date", sort: search.Sort.DESC }),
      "recordid",
      "field",
      "name",
      "oldvalue",
      "newvalue",
    ];

    function run(filters) {
      var s = search.create({
        type: "systemnote",
        filters: filters,
        columns: columns,
      });

      var out = [];
      var idsSet = {};
      var paged = s.runPaged({ pageSize: 1000 });

      outer: for (var p = 0; p < paged.pageRanges.length; p++) {
        var page = paged.fetch({ index: paged.pageRanges[p].index });
        for (var i = 0; i < page.data.length; i++) {
          if (out.length >= MAX_NOTES) break outer;

          var r = page.data[i];
          var recordId = String(r.getValue({ name: "recordid" }) || "");
          if (!recordId) continue;

          out.push({
            note_date: r.getValue({ name: "date" }) || "",
            item_id: recordId,
            field: r.getValue({ name: "field" }) || "",
            name: r.getValue({ name: "name" }) || "",
            oldvalue: r.getValue({ name: "oldvalue" }) || "",
            newvalue: r.getValue({ name: "newvalue" }) || "",
          });

          idsSet[recordId] = true;
        }
      }

      return {
        notes: out,
        recordIds: Object.keys(idsSet),
        capped: out.length >= MAX_NOTES,
      };
    }

    try {
      return run(filtersWithName);
    } catch (e) {
      log.audit("Name filter not supported, falling back", e.message);

      var res = run(baseFilters);

      // post-filter to only inactive toggles
      var filtered = [];
      var idsSet2 = {};
      for (var k = 0; k < res.notes.length; k++) {
        var n = res.notes[k];
        if (!fieldLooksLikeInactive(n.field) && !fieldLooksLikeInactive(n.name))
          continue;

        filtered.push(n);
        idsSet2[String(n.item_id)] = true;
      }

      return {
        notes: filtered,
        recordIds: Object.keys(idsSet2),
        capped: res.capped,
        didFallback: true,
      };
    }
  }

  function onRequest(ctx) {
    if (ctx.request.method !== "GET") {
      ctx.response.write("Only GET supported");
      return;
    }

    var params = ctx.request.parameters || {};
    var wantCsv =
      String(params.csv || "").toLowerCase() === "1" ||
      String(params.csv || "").toLowerCase() === "t" ||
      String(params.csv || "").toLowerCase() === "true";

    var daysBack = parseInt(params.days || "", 10);
    if (!daysBack || daysBack < 1) daysBack = DEFAULT_DAYS_BACK;

    var data;
    try {
      data = fetchActivationNotes(daysBack);
    } catch (e) {
      log.error("System note search failed", e.message);
      ctx.response.write("System note search failed: " + e.message);
      return;
    }

    // Build item meta and filter to CURRENTLY ACTIVE only
    var itemMap = buildItemMap(data.recordIds || []);

    // DISTINCT items: keep latest activation note per item (notes are already DESC)
    var distinct = {}; // itemId -> {note_date, item_id, sku, name}
    for (var i = 0; i < (data.notes || []).length; i++) {
      var n = data.notes[i];
      var id = String(n.item_id || "");
      if (!id) continue;

      var meta = itemMap[id];
      if (!meta) continue; // not an item

      // only CURRENTLY ACTIVE
      if (meta.isinactive === true) continue; // only currently ACTIVE items remain

      // keep first one since sorted DESC (latest)
      if (!distinct[id]) {
        distinct[id] = {
          note_date: n.note_date || "",
          item_id: id,
          item_sku: meta.sku || "",
          item_name: meta.name || meta.sku || "",
        };
      }
    }

    // Convert to array, keep newest first by note_date (string works OK for NS datetime formatting)
    var finalRows = Object.keys(distinct)
      .map(function (k) {
        return distinct[k];
      })
      .sort(function (a, b) {
        var ad = String(a.note_date || "");
        var bd = String(b.note_date || "");
        return bd.localeCompare(ad);
      });

    if (wantCsv) {
      var csv = toCsv(finalRows);
      ctx.response.setHeader({
        name: "Content-Type",
        value: "text/csv; charset=utf-8",
      });
      ctx.response.setHeader({
        name: "Content-Disposition",
        value:
          'attachment; filename="items_currently_active_activated_last_' +
          String(daysBack) +
          '_days.csv"',
      });
      ctx.response.write(csv);
      return;
    }

    var form = serverWidget.createForm({
      title:
        "Items Activated (Inactive → Active) in Last " +
        String(daysBack) +
        " Days (Distinct + Currently Active Only)",
    });

    var csvUrl =
      (function () {
        var u = ctx.request.url || "";
        if (!u) return "";
        var q = u.indexOf("?") === -1 ? "?" : "&";
        return u + q + "csv=1";
      })() || "";

    var summary = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    summary.defaultValue =
      '<div style="margin:8px 0 16px;padding:12px 14px;border-radius:10px;' +
      "background:#112e51;color:#fff;font-size:14px;line-height:1.6;font-weight:600;" +
      'box-shadow:0 4px 10px rgba(0,0,0,0.15)">' +
      "<div>Distinct Items (currently active): <b>" +
      finalRows.length +
      "</b></div>" +
      (data.capped
        ? '<div style="margin-top:8px;color:#ffd;">NOTE: capped at ' +
          MAX_NOTES +
          " systemnote rows.</div>"
        : "") +
      (csvUrl
        ? '<div style="margin-top:10px;"><a style="color:#fff;text-decoration:underline;" href="' +
          csvUrl +
          '">Download CSV</a></div>'
        : "") +
      "</div>";

    var sub = form.addSublist({
      id: "custpage_lines",
      type: serverWidget.SublistType.LIST,
      label: "Distinct Items (Currently Active) - Latest Activation Note",
    });

    sub.addField({
      id: "col_note_date",
      type: serverWidget.FieldType.TEXT,
      label: "Latest Activation Note Date/Time",
    });
    sub.addField({
      id: "col_item_id",
      type: serverWidget.FieldType.INTEGER,
      label: "Item Internal ID",
    });
    sub.addField({
      id: "col_item_sku",
      type: serverWidget.FieldType.TEXT,
      label: "SKU",
    });
    sub.addField({
      id: "col_item_name",
      type: serverWidget.FieldType.TEXT,
      label: "Item Name",
    });
    sub.addField({
      id: "col_item_link",
      type: serverWidget.FieldType.URL,
      label: "Open Item",
    });

    for (var i = 0; i < finalRows.length; i++) {
      var r = finalRows[i];
      var itemId = Number(r.item_id || 0);
      var itemUrl = itemId
        ? "/app/common/item/item.nl?id=" + String(itemId)
        : "";

      if (r.note_date)
        sub.setSublistValue({
          id: "col_note_date",
          line: i,
          value: String(r.note_date),
        });
      if (itemId)
        sub.setSublistValue({
          id: "col_item_id",
          line: i,
          value: String(itemId),
        });
      if (r.item_sku)
        sub.setSublistValue({
          id: "col_item_sku",
          line: i,
          value: String(r.item_sku),
        });
      if (r.item_name)
        sub.setSublistValue({
          id: "col_item_name",
          line: i,
          value: String(r.item_name),
        });
      if (itemUrl)
        sub.setSublistValue({
          id: "col_item_link",
          line: i,
          value: itemUrl,
        });
    }

    ctx.response.writePage(form);
  }

  return { onRequest: onRequest };
});
