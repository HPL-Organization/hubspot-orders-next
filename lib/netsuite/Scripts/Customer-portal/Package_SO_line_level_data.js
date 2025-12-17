/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/query", "N/error", "N/log"], function (query, error, log) {
  function get(context) {
    log.debug("SO Lines RESTlet context", context);

    var soIdParam = context.soId;
    if (!soIdParam) {
      throw error.create({
        name: "MISSING_SO_ID",
        message: "Missing required parameter soId",
      });
    }

    var soId = Number(soIdParam);
    if (!soId || !isFinite(soId)) {
      throw error.create({
        name: "INVALID_SO_ID",
        message: "soId must be a valid numeric internal id",
      });
    }

    var sql =
      "select " +
      "  t.id as so_id, " +
      "  tl.line as line_no, " +
      "  tl.item as item_id, " +
      "  i.itemid as item_sku, " +
      "  nvl(i.displayname, i.salesdescription) as item_display_name, " +
      "  tl.quantity as quantity, " +
      "  tl.rate as rate, " +
      "  tl.amount as amount, " +
      "  tl.description as description, " +
      "  tl.isclosed as is_closed, " +
      "  tl.lineuniquekey as ns_line_id, " +
      "  tl.quantityfulfilled as quantity_fulfilled " +
      "from transaction t " +
      "join transactionline tl on t.id = tl.transaction " +
      "left join item i on tl.item = i.id " +
      "where t.id = ? " +
      "  and tl.mainline = 'F' " +
      "order by tl.line";

    var resultSet = query
      .runSuiteQL({
        query: sql,
        params: [soId],
      })
      .asMappedResults();

    var lines = [];
    for (var i = 0; i < resultSet.length; i++) {
      var row = resultSet[i];

      var quantity = row.quantity != null ? Number(row.quantity) : null;
      var quantityFulfilled =
        row.quantity_fulfilled != null ? Number(row.quantity_fulfilled) : null;

      var fulfillmentStatus = null;
      if (quantity != null && quantity !== 0 && quantityFulfilled != null) {
        if (quantityFulfilled === 0) {
          fulfillmentStatus = "OPEN";
        } else if (quantityFulfilled < quantity) {
          fulfillmentStatus = "PARTIAL";
        } else if (quantityFulfilled >= quantity) {
          fulfillmentStatus = "FULFILLED";
        }
      }

      lines.push({
        so_id: soId,
        line_no: Number(row.line_no), // this will match NetSuite line numbers
        item_id: row.item_id ? Number(row.item_id) : null,
        item_sku: row.item_sku || null,
        item_display_name: row.item_display_name || null,
        quantity: quantity,
        rate: row.rate != null ? Number(row.rate) : null,
        amount: row.amount != null ? Number(row.amount) : null,
        description: row.description || null,
        comment: null,
        is_closed: row.is_closed === "T" || row.is_closed === true,
        fulfillment_status: fulfillmentStatus,
        ns_line_id: row.ns_line_id ? Number(row.ns_line_id) : null,
      });
    }

    return {
      so_id: soId,
      line_count: lines.length,
      lines: lines,
    };
  }

  return {
    get: get,
  };
});
