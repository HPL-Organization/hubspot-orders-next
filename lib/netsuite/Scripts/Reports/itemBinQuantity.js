/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/file"], function (
  serverWidget,
  search,
  file,
) {
  function escapeCsv(value) {
    var str = value == null ? "" : String(value);
    if (/[",\n\r]/.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function getBinRows() {
    var rows = [];
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
        ["binnumber", "isnotempty", ""],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "itemid" }),
        search.createColumn({ name: "displayname" }),
        search.createColumn({ name: "location" }),
        search.createColumn({ name: "binnumber" }),
        search.createColumn({ name: "binonhandcount" }),
      ],
    });

    itemBinSearch.run().each(function (result) {
      var internalId = result.getValue({ name: "internalid" }) || "";
      var itemName = result.getValue({ name: "itemid" }) || "";
      var displayName = result.getValue({ name: "displayname" }) || "";
      var locationText =
        result.getText({ name: "location" }) ||
        result.getValue({ name: "location" }) ||
        "";
      var binText =
        result.getText({ name: "binnumber" }) ||
        result.getValue({ name: "binnumber" }) ||
        "";
      var qty = result.getValue({ name: "binonhandcount" }) || "0";

      var dedupeKey = [
        internalId,
        itemName,
        displayName,
        locationText,
        binText,
        qty,
      ].join("|");

      if (seen[dedupeKey]) {
        return true;
      }
      seen[dedupeKey] = true;

      rows.push({
        internalId: String(internalId),
        itemName: String(itemName),
        displayName: String(displayName),
        locationText: String(locationText),
        binText: String(binText),
        qty: String(qty),
      });

      return true;
    });

    rows.sort(function (a, b) {
      if (a.itemName !== b.itemName) {
        return a.itemName > b.itemName ? 1 : -1;
      }
      if (a.locationText !== b.locationText) {
        return a.locationText > b.locationText ? 1 : -1;
      }
      return a.binText > b.binText ? 1 : -1;
    });

    return rows;
  }

  function exportCsv(context, rows) {
    var csvLines = [];
    csvLines.push(
      [
        "Internal ID",
        "Item",
        "Display Name",
        "Location",
        "Bin",
        "Quantity",
      ].join(","),
    );

    rows.forEach(function (row) {
      csvLines.push(
        [
          escapeCsv(row.internalId),
          escapeCsv(row.itemName),
          escapeCsv(row.displayName),
          escapeCsv(row.locationText),
          escapeCsv(row.binText),
          escapeCsv(row.qty),
        ].join(","),
      );
    });

    var csvFile = file.create({
      name: "item_bin_quantity_report.csv",
      fileType: file.Type.CSV,
      contents: csvLines.join("\n"),
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

    var rows = getBinRows();

    if (context.request.parameters.exportcsv === "T") {
      exportCsv(context, rows);
      return;
    }

    var form = serverWidget.createForm({
      title: "Item Bin Quantity Report",
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

    summaryField.defaultValue =
      '<div style="padding:12px;background:#f8fafc;border:1px solid #d1d5db;border-radius:6px;">' +
      '<div style="font-size:18px;font-weight:bold;margin-bottom:6px;">Item Bin Quantity Report</div>' +
      "<div>This report shows all bin locations an item is stored in and the quantity in each bin.</div>" +
      '<div style="margin-top:6px;"><strong>Total Rows:</strong> ' +
      rows.length +
      "</div>" +
      "</div>";

    var sublist = form.addSublist({
      id: "custpage_results",
      type: serverWidget.SublistType.LIST,
      label: "Bin Details",
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
      id: "custpage_item",
      type: serverWidget.FieldType.TEXT,
      label: "Item",
    });

    sublist.addField({
      id: "custpage_displayname",
      type: serverWidget.FieldType.TEXT,
      label: "Display Name",
    });

    sublist.addField({
      id: "custpage_location",
      type: serverWidget.FieldType.TEXT,
      label: "Location",
    });

    sublist.addField({
      id: "custpage_bin",
      type: serverWidget.FieldType.TEXT,
      label: "Bin",
    });

    sublist.addField({
      id: "custpage_qty",
      type: serverWidget.FieldType.TEXT,
      label: "Quantity",
    });

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];

      sublist.setSublistValue({
        id: "custpage_itemurl",
        line: i,
        value: "/app/common/item/item.nl?id=" + row.internalId,
      });

      sublist.setSublistValue({
        id: "custpage_internalid",
        line: i,
        value: row.internalId,
      });

      if (row.itemName) {
        sublist.setSublistValue({
          id: "custpage_item",
          line: i,
          value: row.itemName,
        });
      }

      if (row.displayName) {
        sublist.setSublistValue({
          id: "custpage_displayname",
          line: i,
          value: row.displayName,
        });
      }

      if (row.locationText) {
        sublist.setSublistValue({
          id: "custpage_location",
          line: i,
          value: row.locationText,
        });
      }

      if (row.binText) {
        sublist.setSublistValue({
          id: "custpage_bin",
          line: i,
          value: row.binText,
        });
      }

      sublist.setSublistValue({
        id: "custpage_qty",
        line: i,
        value: row.qty,
      });
    }

    context.response.writePage(form);
  }

  return {
    onRequest: onRequest,
  };
});
