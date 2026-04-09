/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/log", "N/file"], function (
  serverWidget,
  search,
  log,
  file,
) {
  function escapeCsv(value) {
    var str = value == null ? "" : String(value);
    if (/[",\n\r]/.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
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

  function buildRows(itemDisplayNameMap) {
    var rows = [];
    var totalBinRows = 0;
    var uniqueItems = {};
    var locationCounts = {};
    var debugCount = 0;
    var seen = {};

    var itemBinSearch = search.create({
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
        ["binnumber", "isnotempty", ""],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "itemid" }),
        search.createColumn({ name: "displayname" }),
        search.createColumn({ name: "location" }),
        search.createColumn({ name: "binnumber" }),
        search.createColumn({ name: "binonhandcount" }),
        search.createColumn({ name: "binonhandavail" }),
        search.createColumn({ name: "preferredbin" }),
      ],
    });

    itemBinSearch.run().each(function (result) {
      var internalId = result.getValue({ name: "internalid" });
      if (!internalId) {
        return true;
      }

      var itemText =
        result.getValue({ name: "itemid" }) ||
        result.getText({ name: "internalid" }) ||
        "";

      var itemDisplayName =
        itemDisplayNameMap[internalId] ||
        result.getValue({ name: "displayname" }) ||
        "";

      var locationText =
        result.getText({ name: "location" }) ||
        result.getValue({ name: "location" }) ||
        "";

      var binText =
        result.getText({ name: "binnumber" }) ||
        result.getValue({ name: "binnumber" }) ||
        "";

      var binOnHand = result.getValue({ name: "binonhandcount" }) || "0";
      var binAvail = result.getValue({ name: "binonhandavail" }) || "0";

      var preferredRaw = result.getValue({ name: "preferredbin" });
      var preferredBin =
        preferredRaw === "T" || preferredRaw === true ? "Yes" : "No";

      var dedupeKey = [
        String(internalId),
        String(locationText),
        String(binText),
        String(binOnHand),
        String(binAvail),
        String(preferredBin),
      ].join("|");

      if (seen[dedupeKey]) {
        return true;
      }
      seen[dedupeKey] = true;

      if (debugCount < 200) {
        log.debug("Item bin row", {
          internalId: internalId,
          itemText: itemText,
          itemDisplayName: itemDisplayName,
          locationText: locationText,
          binText: binText,
          binOnHand: binOnHand,
          binAvail: binAvail,
          preferredRaw: preferredRaw,
          preferredBin: preferredBin,
        });
        debugCount++;
      }

      rows.push({
        internalId: String(internalId),
        itemText: String(itemText),
        itemDisplayName: String(itemDisplayName),
        locationText: String(locationText),
        binText: String(binText),
        preferredBin: preferredBin,
        binOnHand: String(binOnHand),
        binAvail: String(binAvail),
      });

      totalBinRows++;
      uniqueItems[internalId] = true;

      if (locationText) {
        locationCounts[locationText] = (locationCounts[locationText] || 0) + 1;
      }

      return true;
    });

    return {
      rows: rows,
      totalBinRows: totalBinRows,
      distinctItemCount: Object.keys(uniqueItems).length,
      locationCounts: locationCounts,
    };
  }

  function exportCsv(context, dataset) {
    var csvLines = [];
    csvLines.push(
      [
        "Internal ID",
        "Item",
        "Item Display Name",
        "Location",
        "Bin Number",
        "Preferred Bin?",
        "Bin On Hand",
        "Bin Available",
      ].join(","),
    );

    dataset.rows.forEach(function (row) {
      csvLines.push(
        [
          escapeCsv(row.internalId),
          escapeCsv(row.itemText),
          escapeCsv(row.itemDisplayName),
          escapeCsv(row.locationText),
          escapeCsv(row.binText),
          escapeCsv(row.preferredBin),
          escapeCsv(row.binOnHand),
          escapeCsv(row.binAvail),
        ].join(","),
      );
    });

    var csvContent = csvLines.join("\n");

    var csvFile = file.create({
      name: "item_bin_stock_distribution.csv",
      fileType: file.Type.CSV,
      contents: csvContent,
    });

    context.response.writeFile({
      file: csvFile,
      isInline: false,
    });
  }

  function onRequest(context) {
    if (context.request.method !== "GET") {
      context.response.write("Only GET supported");
      return;
    }

    var itemDisplayNameMap = getItemDisplayNameMap();
    var dataset = buildRows(itemDisplayNameMap);

    log.audit("Item bin search summary", {
      totalBinRows: dataset.totalBinRows,
      distinctItems: dataset.distinctItemCount,
    });

    if (context.request.parameters.exportcsv === "T") {
      exportCsv(context, dataset);
      return;
    }

    var form = serverWidget.createForm({
      title: "Item Bin Stock Distribution",
    });

    form.addButton({
      id: "custpage_exportcsv",
      label: "Export CSV",
      functionName:
        "(function(){ var url = window.location.href; if (url.indexOf('exportcsv=T') === -1) { url += (url.indexOf('?') === -1 ? '?' : '&') + 'exportcsv=T'; } window.location.href = url; })",
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

    for (var line = 0; line < dataset.rows.length; line++) {
      var row = dataset.rows[line];

      sublist.setSublistValue({
        id: "custpage_itemurl",
        line: line,
        value: "/app/common/item/item.nl?id=" + row.internalId,
      });

      sublist.setSublistValue({
        id: "custpage_internalid",
        line: line,
        value: row.internalId,
      });

      if (row.itemText) {
        sublist.setSublistValue({
          id: "custpage_itemtext",
          line: line,
          value: row.itemText,
        });
      }

      if (row.itemDisplayName) {
        sublist.setSublistValue({
          id: "custpage_itemdisplayname",
          line: line,
          value: row.itemDisplayName,
        });
      }

      if (row.locationText) {
        sublist.setSublistValue({
          id: "custpage_location",
          line: line,
          value: row.locationText,
        });
      }

      if (row.binText) {
        sublist.setSublistValue({
          id: "custpage_bin",
          line: line,
          value: row.binText,
        });
      }

      sublist.setSublistValue({
        id: "custpage_prefbin",
        line: line,
        value: row.preferredBin,
      });

      sublist.setSublistValue({
        id: "custpage_bin_onhand",
        line: line,
        value: row.binOnHand,
      });

      sublist.setSublistValue({
        id: "custpage_bin_avail",
        line: line,
        value: row.binAvail,
      });
    }

    var locationSummaryHtml = "";
    if (Object.keys(dataset.locationCounts).length > 0) {
      locationSummaryHtml += '<ul style="margin: 8px 0 0 20px; padding: 0;">';
      Object.keys(dataset.locationCounts).forEach(function (loc) {
        locationSummaryHtml +=
          '<li style="margin: 2px 0; font-size: 13px;">' +
          "<strong>" +
          (loc || "No Location") +
          ":</strong> " +
          dataset.locationCounts[loc] +
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
      "All item/bin rows from item search, with preferred bins shown from the same search." +
      "</div>" +
      '<div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px;">' +
      "Distinct Items: " +
      '<span style="font-size: 22px; font-weight: 700; color: #123c7b;">' +
      dataset.distinctItemCount +
      "</span>" +
      "</div>" +
      '<div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px;">' +
      "Total Bin Rows: " +
      '<span style="font-size: 22px; font-weight: 700; color: #123c7b;">' +
      dataset.totalBinRows +
      "</span>" +
      "</div>" +
      (locationSummaryHtml
        ? '<div style="font-size: 13px; color: #555; margin-top: 4px;">' +
          "<strong>By Location (bin rows):</strong>" +
          locationSummaryHtml +
          "</div>"
        : "") +
      "</div>";

    if (dataset.totalBinRows === 0) {
      summaryHtml =
        '<div style="padding: 16px; margin-bottom: 16px; ' +
        "background: #f0fff4; border-radius: 8px; border: 1px solid #9ae6b4; " +
        'box-shadow: 0 2px 4px rgba(0,0,0,0.05);">' +
        '<div style="font-size: 22px; font-weight: 700; color: #276749; margin-bottom: 4px;">' +
        "No Bin Stock Found" +
        "</div>" +
        '<div style="font-size: 14px; color: #2f855a;">' +
        "No matching items with bin rows were found." +
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
