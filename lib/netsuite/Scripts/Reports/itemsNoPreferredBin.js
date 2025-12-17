/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/log"], function (
  serverWidget,
  search,
  log
) {
  function onRequest(context) {
    if (context.request.method !== "GET") {
      context.response.write("Only GET supported");
      return;
    }

    var form = serverWidget.createForm({
      title: "Items Without Preferred Bin",
    });

    var summaryField = form.addField({
      id: "custpage_summary",
      type: serverWidget.FieldType.INLINEHTML,
      label: "Summary",
    });

    var sublist = form.addSublist({
      id: "custpage_items",
      type: serverWidget.SublistType.LIST,
      label: "Items",
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
      id: "custpage_sku",
      type: serverWidget.FieldType.TEXT,
      label: "Item ID / SKU",
    });

    sublist.addField({
      id: "custpage_name",
      type: serverWidget.FieldType.TEXT,
      label: "Name",
    });

    sublist.addField({
      id: "custpage_type",
      type: serverWidget.FieldType.TEXT,
      label: "Type",
    });

    sublist.addField({
      id: "custpage_usebins",
      type: serverWidget.FieldType.TEXT,
      label: "Use Bins?",
    });

    var itemSearch = search.create({
      type: search.Type.ITEM,
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["usebins", "is", "T"],
        "AND",
        ["preferredbin", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "itemid" }),
        search.createColumn({ name: "displayname" }),
        search.createColumn({ name: "type" }),
        search.createColumn({ name: "usebins" }),
      ],
    });

    var line = 0;
    var totalCount = 0;
    var typeCounts = {};

    itemSearch.run().each(function (result) {
      var internalId = result.getValue({ name: "internalid" });
      var itemId = result.getValue({ name: "itemid" });
      var displayName = result.getValue({ name: "displayname" });
      var typeText = result.getText({ name: "type" }) || "";
      var useBinsVal = result.getValue({ name: "usebins" });
      var useBins = useBinsVal ? "T" : "F";

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

      if (itemId) {
        sublist.setSublistValue({
          id: "custpage_sku",
          line: line,
          value: itemId,
        });
      }

      if (displayName) {
        sublist.setSublistValue({
          id: "custpage_name",
          line: line,
          value: displayName,
        });
      }

      if (typeText) {
        sublist.setSublistValue({
          id: "custpage_type",
          line: line,
          value: typeText,
        });
      }

      sublist.setSublistValue({
        id: "custpage_usebins",
        line: line,
        value: useBins,
      });

      totalCount++;
      typeCounts[typeText] = (typeCounts[typeText] || 0) + 1;

      line++;
      return true;
    });

    var typeSummaryHtml = "";
    if (Object.keys(typeCounts).length > 0) {
      typeSummaryHtml += '<ul style="margin: 8px 0 0 20px; padding: 0;">';
      Object.keys(typeCounts).forEach(function (t) {
        typeSummaryHtml +=
          '<li style="margin: 2px 0; font-size: 13px;">' +
          "<strong>" +
          (t || "Unknown") +
          ":</strong> " +
          typeCounts[t] +
          "</li>";
      });
      typeSummaryHtml += "</ul>";
    }

    var summaryHtml =
      '<div style="padding: 16px; margin-bottom: 16px; ' +
      "background: linear-gradient(90deg, #ffe4e1, #fff5f5); " +
      "border-radius: 8px; border: 1px solid #ffb3b3; " +
      'box-shadow: 0 2px 4px rgba(0,0,0,0.05);">' +
      '<div style="font-size: 22px; font-weight: 700; color: #b30000; margin-bottom: 4px;">' +
      "Items Without a Preferred Bin" +
      "</div>" +
      '<div style="font-size: 14px; color: #333; margin-bottom: 8px;">' +
      "Items that use bins but have no preferred bin set." +
      "</div>" +
      '<div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px;">' +
      "Total Items: " +
      '<span style="font-size: 22px; font-weight: 700; color: #cc0000;">' +
      totalCount +
      "</span>" +
      "</div>" +
      (typeSummaryHtml
        ? '<div style="font-size: 13px; color: #555; margin-top: 4px;">' +
          "<strong>By Type:</strong>" +
          typeSummaryHtml +
          "</div>"
        : "") +
      "</div>";

    if (totalCount === 0) {
      summaryHtml =
        '<div style="padding: 16px; margin-bottom: 16px; ' +
        "background: #f0fff4; border-radius: 8px; border: 1px solid #9ae6b4; " +
        'box-shadow: 0 2px 4px rgba(0,0,0,0.05);">' +
        '<div style="font-size: 22px; font-weight: 700; color: #276749; margin-bottom: 4px;">' +
        "All Good!" +
        "</div>" +
        '<div style="font-size: 14px; color: #2f855a;">' +
        "No items found without a preferred bin." +
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
