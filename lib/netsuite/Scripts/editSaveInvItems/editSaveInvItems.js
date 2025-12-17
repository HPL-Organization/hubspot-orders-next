/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/record", "N/log"], function (search, record, log) {
  function getInputData() {
    return search.create({
      type: record.Type.INVENTORY_ITEM,
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["salesdescription", "isempty", ""],
      ],
      columns: ["internalid"],
    });
  }

  function map(context) {
    var result = JSON.parse(context.value);
    var internalId = result.id;

    try {
      log.debug("Loading item", { internalId: internalId });

      var itemRec = record.load({
        type: record.Type.INVENTORY_ITEM,
        id: internalId,
        isDynamic: false,
      });

      // No field changes – just edit -> save to trigger workflows/UE scripts
      var savedId = itemRec.save({
        enableSourcing: true,
        ignoreMandatoryFields: true,
      });

      log.audit("Item resaved successfully", {
        internalId: internalId,
        savedId: savedId,
      });
    } catch (e) {
      log.error("Failed to resave item", {
        internalId: internalId,
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
    }
  }

  function reduce(context) {
    // Not used, required by MR signature
  }

  function summarize(summary) {
    log.audit("Resave inventory items summary", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
    });

    summary.mapSummary.errors.iterator().each(function (key, error) {
      log.error("Map error for key " + key, error);
      return true;
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
