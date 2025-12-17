/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/search", "N/ui/serverWidget", "N/log"], function (search, ui, log) {
  function safeSet(sublist, fieldId, line, value) {
    if (value === null || value === undefined || value === "") {
      return;
    }
    sublist.setSublistValue({
      id: fieldId,
      line: line,
      value: String(value),
    });
  }

  function onRequest(context) {
    if (context.request.method !== "GET") {
      context.response.write("Only GET supported");
      return;
    }

    var form = ui.createForm({
      title: "Items With Inventory Not Assigned To Bins",
    });

    var sublist = form.addSublist({
      id: "custpage_results",
      type: ui.SublistType.LIST,
      label: "Inventory Location vs Bin Variance",
    });

    sublist.addField({
      id: "custpage_item",
      type: ui.FieldType.TEXT,
      label: "Item",
    });

    sublist.addField({
      id: "custpage_item_internalid",
      type: ui.FieldType.TEXT,
      label: "Item Internal ID",
    });

    sublist.addField({
      id: "custpage_location",
      type: ui.FieldType.TEXT,
      label: "Location",
    });

    sublist.addField({
      id: "custpage_location_internalid",
      type: ui.FieldType.TEXT,
      label: "Location Internal ID",
    });

    sublist.addField({
      id: "custpage_loc_qty",
      type: ui.FieldType.FLOAT,
      label: "Location Qty On Hand",
    });

    sublist.addField({
      id: "custpage_bin_qty",
      type: ui.FieldType.FLOAT,
      label: "Bin Qty On Hand (Sum)",
    });

    sublist.addField({
      id: "custpage_unbinned_qty",
      type: ui.FieldType.FLOAT,
      label: "Unbinned Qty (Loc - Bins)",
    });

    var rowsByKey = {};

    try {
      var itemSearch = search.create({
        type: search.Type.ITEM,
        filters: [
          ["type", "anyof", "InvtPart"],
          "AND",
          ["locationquantityonhand", "greaterthan", "0"],
        ],
        columns: [
          "internalid",
          "itemid",
          "location",
          "locationquantityonhand",
          "binnumber",
          "binonhandavail",
        ],
      });

      itemSearch.run().each(function (result) {
        var itemId = result.getValue({ name: "internalid" });
        var itemName = result.getValue({ name: "itemid" }) || "";
        var locId = result.getValue({ name: "location" });
        var locName = result.getText({ name: "location" }) || "";

        var locQtyRaw = result.getValue({ name: "locationquantityonhand" });
        var binQtyRaw = result.getValue({ name: "binonhandavail" });

        var locQty =
          locQtyRaw !== null && locQtyRaw !== "" ? parseFloat(locQtyRaw) : 0;
        var binQty =
          binQtyRaw !== null && binQtyRaw !== "" ? parseFloat(binQtyRaw) : 0;

        var key = String(itemId) + "|" + String(locId);

        if (!rowsByKey[key]) {
          rowsByKey[key] = {
            itemId: itemId,
            itemName: itemName,
            locId: locId,
            locName: locName,
            locQty: locQty,
            binQtySum: 0,
          };
        }

        rowsByKey[key].binQtySum += binQty;

        return true;
      });
    } catch (e) {
      log.error("ItemsNotInBins search error", e);
      context.response.write("Error running search: " + e.message);
      return;
    }

    var line = 0;
    var totalLines = 0;
    var totalLocQty = 0;
    var totalBinQty = 0;
    var totalUnbinnedQty = 0;

    Object.keys(rowsByKey).forEach(function (key) {
      var row = rowsByKey[key];

      var locQty = row.locQty || 0;
      var binQtySum = row.binQtySum || 0;
      var unbinned = locQty - binQtySum;

      if (unbinned <= 0) return;

      totalLines++;
      totalLocQty += locQty;
      totalBinQty += binQtySum;
      totalUnbinnedQty += unbinned;

      safeSet(sublist, "custpage_item", line, row.itemName);
      safeSet(sublist, "custpage_item_internalid", line, row.itemId);
      safeSet(sublist, "custpage_location", line, row.locName);
      safeSet(sublist, "custpage_location_internalid", line, row.locId);
      safeSet(sublist, "custpage_loc_qty", line, locQty);
      safeSet(sublist, "custpage_bin_qty", line, binQtySum);
      safeSet(sublist, "custpage_unbinned_qty", line, unbinned);

      line++;
    });

    var summaryGroupId = "custpage_summary_group";
    form.addFieldGroup({
      id: summaryGroupId,
      label: "Unbinned Inventory Summary",
    });

    var summaryField = form.addField({
      id: "custpage_summary_html",
      type: ui.FieldType.INLINEHTML,
      label: "Summary",
      container: summaryGroupId,
    });

    var summaryHtml =
      "<div style='margin-top:8px;padding:10px 12px;" +
      "background-color:#fff7d9;border:1px solid #f0c36d;" +
      "border-radius:4px;font-size:12px;color:#333;'>" +
      "<div style='font-weight:bold;font-size:13px;margin-bottom:6px;'>" +
      "Unbinned Inventory Summary" +
      "</div>" +
      "<div>Lines: <strong>" +
      totalLines +
      "</strong></div>" +
      "<div>Total Location Qty: <strong>" +
      totalLocQty +
      "</strong></div>" +
      "<div>Total Bin Qty: <strong>" +
      totalBinQty +
      "</strong></div>" +
      "<div>Total Unbinned Qty: <strong>" +
      totalUnbinnedQty +
      "</strong></div>" +
      "<div style='margin-top:8px;font-size:11px;color:#555;'>" +
      "Uses Item fields: Location Qty On Hand (locationquantityonhand) " +
      "and Bin On Hand Available (binonhandavail). Groups by Item + Location " +
      "and shows rows where Location Qty On Hand &gt; Sum of Bin On Hand Available." +
      "</div>" +
      "</div>";

    summaryField.defaultValue = summaryHtml;

    context.response.writePage(form);
  }

  return {
    onRequest: onRequest,
  };
});
