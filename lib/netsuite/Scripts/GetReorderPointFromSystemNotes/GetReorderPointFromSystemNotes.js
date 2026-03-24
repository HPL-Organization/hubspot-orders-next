/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/record", "N/search", "N/log"], function (
  query,
  record,
  search,
  log,
) {
  function findItemInternalIdBySku(sku) {
    var itemId = null;
    search
      .create({
        type: "item",
        filters: [["itemid", "is", sku]],
        columns: [search.createColumn({ name: "internalid" })],
      })
      .run()
      .each(function (r) {
        itemId = r.getValue({ name: "internalid" });
        return false;
      });
    return itemId ? String(itemId) : null;
  }

  function loadItemForReplenishment(itemInternalId) {
    var typesToTry = [
      "inventoryitem",
      "assemblyitem",
      "kititem",
      "noninventoryitem",
      "serviceitem",
      "item",
    ];
    for (var i = 0; i < typesToTry.length; i++) {
      try {
        return record.load({
          type: typesToTry[i],
          id: itemInternalId,
          isDynamic: false,
        });
      } catch (e) {}
    }
    return null;
  }

  function getInputData() {
    var sku = "120004";
    var itemInternalId = findItemInternalIdBySku(sku);

    log.audit("Resolved Item Internal ID", {
      sku: sku,
      itemInternalId: itemInternalId,
    });
    if (!itemInternalId) return [];

    var sql =
      "SELECT ilc.id AS ilc_id, ilc.location AS location_id " +
      "FROM itemlocationconfiguration ilc " +
      "WHERE ilc.item = ?";

    var rs = query.runSuiteQL({ query: sql, params: [itemInternalId] });
    var rows = rs.asMappedResults() || [];

    log.audit("ILC rows found", {
      sku: sku,
      itemInternalId: itemInternalId,
      count: rows.length,
      rows: rows,
    });

    return rows.map(function (r) {
      return {
        sku: sku,
        itemInternalId: itemInternalId,
        ilcId: String(r.ilc_id),
        locationId: String(r.location_id),
      };
    });
  }

  function clean(v) {
    return String(v == null ? "" : v).trim();
  }

  function getLastKnownFromSystemNotes(ilcId) {
    // Pull newest system notes for this ILC where field label contains either target
    // NOTE: no recordtype filter on purpose; recordid is already specific.
    var filters = [
      ["recordid", "equalto", String(ilcId)],
      "and",
      [
        ["formulatext: {field}", "contains", "Reorder Point"],
        "or",
        ["formulatext: {field}", "contains", "Preferred Stock Level"],
      ],
    ];

    var s = search.create({
      type: "systemnote",
      filters: filters,
      columns: [
        search.createColumn({ name: "date", sort: search.Sort.DESC }),
        search.createColumn({ name: "field" }),
        search.createColumn({ name: "oldvalue" }),
        search.createColumn({ name: "newvalue" }),
        search.createColumn({ name: "context" }),
      ],
    });

    var lastRP = null;
    var lastPSL = null;
    var rpRow = null;
    var pslRow = null;

    s.run().each(function (res) {
      var field = clean(res.getText("field") || res.getValue("field"));
      var oldV = clean(res.getValue("oldvalue"));
      var newV = clean(res.getValue("newvalue"));
      var date = res.getValue("date");
      var context = clean(res.getText("context") || res.getValue("context"));

      var isRP = field.toLowerCase().indexOf("reorder point") !== -1;
      var isPSL = field.toLowerCase().indexOf("preferred stock level") !== -1;

      // For "last known value":
      // - If newest row has newValue, that IS the last known value
      // - If newest row cleared it (newValue=""), last known is oldValue
      if (isRP && lastRP == null) {
        lastRP = newV || oldV || "";
        rpRow = {
          date: date,
          field: field,
          oldValue: oldV,
          newValue: newV,
          context: context,
        };
      }

      if (isPSL && lastPSL == null) {
        lastPSL = newV || oldV || "";
        pslRow = {
          date: date,
          field: field,
          oldValue: oldV,
          newValue: newV,
          context: context,
        };
      }

      return !(lastRP != null && lastPSL != null); // stop once both found
    });

    return {
      lastKnownReorderPoint: lastRP,
      lastKnownPreferredStockLevel: lastPSL,
      sourceRowReorderPoint: rpRow,
      sourceRowPreferredStockLevel: pslRow,
    };
  }

  function map(context) {
    var row = JSON.parse(context.value);

    var itemRec = loadItemForReplenishment(row.itemInternalId);
    if (!itemRec) {
      log.error("Could not load item record", {
        sku: row.sku,
        itemInternalId: row.itemInternalId,
      });
      return;
    }

    var replText = "";
    try {
      replText = clean(
        itemRec.getText({ fieldId: "supplyreplenishmentmethod" }),
      );
    } catch (e) {}

    var isReorderPoint = replText.toLowerCase().indexOf("reorder point") !== -1;

    if (!isReorderPoint) {
      log.audit("Skipping (item not Reorder Point method)", {
        sku: row.sku,
        itemInternalId: row.itemInternalId,
        ilcId: row.ilcId,
        locationId: row.locationId,
        itemSupplyReplenishmentMethod: replText,
      });
      return;
    }

    var lastKnown = getLastKnownFromSystemNotes(row.ilcId);

    log.audit("Last known RP/PSL from ILC System Notes", {
      sku: row.sku,
      itemInternalId: row.itemInternalId,
      ilcId: row.ilcId,
      locationId: row.locationId,
      itemSupplyReplenishmentMethod: replText,
      lastKnownReorderPoint: lastKnown.lastKnownReorderPoint,
      lastKnownPreferredStockLevel: lastKnown.lastKnownPreferredStockLevel,
      sourceRowReorderPoint: lastKnown.sourceRowReorderPoint,
      sourceRowPreferredStockLevel: lastKnown.sourceRowPreferredStockLevel,
    });
  }

  function summarize(summary) {
    log.audit("Done", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
    });

    summary.mapSummary.errors.iterator().each(function (key, err) {
      log.error("Map error for key " + key, err);
      return true;
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    summarize: summarize,
  };
});
