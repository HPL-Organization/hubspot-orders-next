/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/log"], function (
  serverWidget,
  search,
  log
) {
  function getEligibleItems() {
    var eligible = {};
    var s = search.create({
      type: search.Type.ITEM,
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["usebins", "is", "T"],
        "AND",
        ["type", "anyof", "InvtPart", "Assembly"],
        "AND",
        ["isserialitem", "is", "F"],
      ],
      columns: [search.createColumn({ name: "internalid" })],
    });

    s.run().each(function (result) {
      var id = result.getValue({ name: "internalid" });
      if (id) {
        eligible[id] = true;
      }
      return true;
    });

    return eligible;
  }

  function getItemDisplayNameMap() {
    var nameMap = {};
    var s = search.create({
      type: search.Type.ITEM,
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["usebins", "is", "T"],
        "AND",
        ["type", "anyof", "InvtPart", "Assembly"],
        "AND",
        ["isserialitem", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "displayname" }),
      ],
    });

    s.run().each(function (result) {
      var id = result.getValue({ name: "internalid" });
      var displayName = result.getValue({ name: "displayname" }) || "";
      if (id) {
        nameMap[id] = displayName;
      }
      return true;
    });

    log.audit("Item display name map summary", {
      totalItems: Object.keys(nameMap).length,
    });

    return nameMap;
  }

  function getPreferredBinMap() {
    var preferredMap = {};
    var s = search.create({
      type: search.Type.ITEM,
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["usebins", "is", "T"],
        "AND",
        ["type", "anyof", "InvtPart", "Assembly"],
        "AND",
        ["isserialitem", "is", "F"],
        "AND",
        ["preferredbin", "is", "T"],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "binnumber" }),
      ],
    });

    var prefDebugCount = 0;

    s.run().each(function (result) {
      var id = result.getValue({ name: "internalid" });
      var binName = result.getValue({ name: "binnumber" });
      var binTextDisplay = result.getText({ name: "binnumber" }) || "";
      if (id && binName) {
        var key = id + "|" + binName;
        preferredMap[key] = true;
        if (prefDebugCount < 200) {
          log.debug("PreferredBinMap entry", {
            itemId: id,
            binId: binName,
            binText: binTextDisplay,
            key: key,
          });
          prefDebugCount++;
        }
      } else if (prefDebugCount < 200) {
        log.debug("PreferredBinMap missing id or binName", {
          itemId: id,
          binId: binName,
          binText: binTextDisplay,
        });
        prefDebugCount++;
      }
      return true;
    });

    log.audit("PreferredBinMap summary", {
      totalKeys: Object.keys(preferredMap).length,
    });

    return preferredMap;
  }

  function onRequest(context) {
    if (context.request.method !== "GET") {
      context.response.write("Only GET supported");
      return;
    }

    var form = serverWidget.createForm({
      title: "Item Bin Stock Distribution",
    });

    var summaryField = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: "Summary",
    });

    var sublist = form.addSublist({
      id: "custpage_bins",
      type: serverWidget.SublistType.LIST,
      label: "Item Bin Stock",
    });

    var itemLinkField = sublist.addField({
      id: "custpage_itemurl",
      type: serverWidget.FieldType.URL,
      label: "Item Link",
    });
    itemLinkField.linkText = "View";

    sublist.addField({
      id: "custpage_internalid",
      type: serverWidget.FieldType.TEXT,
      label: "Internal ID",
    });

    sublist.addField({
      id: "custpage_itemtext",
      type: serverWidget.FieldType.TEXT,
      label: "Item",
    });

    sublist.addField({
      id: "custpage_itemdisplayname",
      type: serverWidget.FieldType.TEXT,
      label: "Item Display Name",
    });

    sublist.addField({
      id: "custpage_location",
      type: serverWidget.FieldType.TEXT,
      label: "Location",
    });

    sublist.addField({
      id: "custpage_bin",
      type: serverWidget.FieldType.TEXT,
      label: "Bin Number",
    });

    sublist.addField({
      id: "custpage_prefbin",
      type: serverWidget.FieldType.TEXT,
      label: "Preferred Bin?",
    });

    sublist.addField({
      id: "custpage_bin_onhand",
      type: serverWidget.FieldType.TEXT,
      label: "Bin On Hand",
    });

    sublist.addField({
      id: "custpage_bin_avail",
      type: serverWidget.FieldType.TEXT,
      label: "Bin Available",
    });

    var eligibleItems = getEligibleItems();
    log.audit("Eligible items summary", {
      totalEligibleItems: Object.keys(eligibleItems).length,
    });

    var itemDisplayNameMap = getItemDisplayNameMap();
    var preferredMap = getPreferredBinMap();

    var binSearch = search.create({
      type: search.Type.BIN_ITEM_BALANCE,
      filters: [["onhand", "greaterthan", "0"]],
      columns: [
        search.createColumn({ name: "item" }),
        search.createColumn({ name: "location" }),
        search.createColumn({ name: "binnumber" }),
        search.createColumn({ name: "onhand" }),
        search.createColumn({ name: "available" }),
      ],
    });

    var line = 0;
    var totalBinRows = 0;
    var uniqueItems = {};
    var locationCounts = {};
    var binDebugCount = 0;

    binSearch.run().each(function (result) {
      var internalId = result.getValue({ name: "item" });
      if (!internalId || !eligibleItems[internalId]) {
        return true;
      }

      var itemText = result.getText({ name: "item" }) || "";
      var itemDisplayName = itemDisplayNameMap[internalId] || "";
      var locationText = result.getText({ name: "location" }) || "";
      var binIdInternal = result.getValue({ name: "binnumber" });
      var binText = result.getText({ name: "binnumber" }) || "";
      var binOnHand = result.getValue({ name: "onhand" }) || "0";
      var binAvail = result.getValue({ name: "available" }) || "0";

      var key = binText ? internalId + "|" + binText : "";
      var preferredBinFlag = key && preferredMap[key] ? true : false;
      var preferredBin = preferredBinFlag ? "Yes" : "No";

      if (binDebugCount < 200) {
        log.debug("BinItemBalance row", {
          itemId: internalId,
          itemText: itemText,
          itemDisplayName: itemDisplayName,
          locationText: locationText,
          binId: binIdInternal,
          binText: binText,
          key: key,
          preferredHit: preferredBinFlag,
        });
        binDebugCount++;
      }

      sublist.setSublistValue({
        id: "custpage_itemurl",
        line: line,
        value: "/app/common/item/item.nl?id=" + internalId,
      });

      sublist.setSublistValue({
        id: "custpage_internalid",
        line: line,
        value: String(internalId),
      });

      if (itemText) {
        sublist.setSublistValue({
          id: "custpage_itemtext",
          line: line,
          value: itemText,
        });
      }

      if (itemDisplayName) {
        sublist.setSublistValue({
          id: "custpage_itemdisplayname",
          line: line,
          value: itemDisplayName,
        });
      }

      if (locationText) {
        sublist.setSublistValue({
          id: "custpage_location",
          line: line,
          value: locationText,
        });
        locationCounts[locationText] = (locationCounts[locationText] || 0) + 1;
      }

      if (binText) {
        sublist.setSublistValue({
          id: "custpage_bin",
          line: line,
          value: binText,
        });
      }

      sublist.setSublistValue({
        id: "custpage_prefbin",
        line: line,
        value: preferredBin,
      });

      sublist.setSublistValue({
        id: "custpage_bin_onhand",
        line: line,
        value: String(binOnHand),
      });

      sublist.setSublistValue({
        id: "custpage_bin_avail",
        line: line,
        value: String(binAvail),
      });

      totalBinRows++;
      uniqueItems[internalId] = true;
      line++;
      return true;
    });

    log.audit("Bin search summary", {
      totalBinRows: totalBinRows,
      distinctItems: Object.keys(uniqueItems).length,
    });

    var distinctItemCount = Object.keys(uniqueItems).length;

    var locationSummaryHtml = "";
    if (Object.keys(locationCounts).length > 0) {
      locationSummaryHtml += '<ul style="margin: 8px 0 0 20px; padding: 0;">';
      Object.keys(locationCounts).forEach(function (loc) {
        locationSummaryHtml +=
          '<li style="margin: 2px 0; font-size: 13px;">' +
          "<strong>" +
          (loc || "No Location") +
          ":</strong> " +
          locationCounts[loc] +
          " bin rows" +
          "</li>";
      });
      locationSummaryHtml += "</ul>";
    }

    var summaryHtml =
      '<div style="padding: 16px; margin-bottom: 16px; ' +
      "background: linear-gradient(90deg, #e6f0ff, #f5f8ff); " +
      "border-radius: 8px; border: 1px solid #9fbfff; " +
      'box-shadow: 0 2px 4px rgba(0,0,0,0.05);">' +
      '<div style="font-size: 22px; font-weight: 700; color: #123c7b; margin-bottom: 4px;">' +
      "Item Bin Stock Distribution" +
      "</div>" +
      '<div style="font-size: 14px; color: #333; margin-bottom: 8px;">' +
      "All bin locations with stock for non-serialized inventory and assembly items that use bins, with preferred bins highlighted." +
      "</div>" +
      '<div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px;">' +
      "Distinct Items: " +
      '<span style="font-size: 22px; font-weight: 700; color: #123c7b;">' +
      distinctItemCount +
      "</span>" +
      "</div>" +
      '<div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px;">' +
      "Total Bin Rows: " +
      '<span style="font-size: 22px; font-weight: 700; color: #123c7b;">' +
      totalBinRows +
      "</span>" +
      "</div>" +
      (locationSummaryHtml
        ? '<div style="font-size: 13px; color: #555; margin-top: 4px;">' +
          "<strong>By Location (bin rows):</strong>" +
          locationSummaryHtml +
          "</div>"
        : "") +
      "</div>";

    if (totalBinRows === 0) {
      summaryHtml =
        '<div style="padding: 16px; margin-bottom: 16px; ' +
        "background: #f0fff4; border-radius: 8px; border: 1px solid #9ae6b4; " +
        'box-shadow: 0 2px 4px rgba(0,0,0,0.05);">' +
        '<div style="font-size: 22px; font-weight: 700; color: #276749; margin-bottom: 4px;">' +
        "No Bin Stock Found" +
        "</div>" +
        '<div style="font-size: 14px; color: #2f855a;">' +
        "No matching items with bin stock were found." +
        "</div>" +
        "</div>";
    }

    summaryField.defaultValue = summaryHtml;

    context.response.writePage(form);
  }

  return {
    onRequest: onRequest,
  };
});
