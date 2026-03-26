/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(["N/query", "N/log"], function (query, log) {
  function execute() {
    var soId = 992721;

    var sql =
      "SELECT DISTINCT " +
      "  PTLL.PreviousType AS previousType, " +
      "  PTLL.PreviousDoc AS previousDoc, " +
      "  PTLL.PreviousLine AS previousLine, " +
      "  PTLL.NextType AS nextType, " +
      "  PTLL.NextDoc AS nextDoc, " +
      "  PTLL.NextLine AS nextLine " +
      "FROM PreviousTransactionLineLink PTLL " +
      "WHERE PTLL.PreviousDoc = ? " +
      "   OR PTLL.NextDoc = ? " +
      "ORDER BY PTLL.PreviousDoc, PTLL.NextDoc, PTLL.PreviousLine, PTLL.NextLine";

    var rows =
      query
        .runSuiteQL({
          query: sql,
          params: [soId, soId],
        })
        .asMappedResults() || [];

    log.audit("PTLL diagnostic count", {
      soId: soId,
      count: rows.length,
    });

    for (var i = 0; i < rows.length; i++) {
      log.audit("PTLL row " + (i + 1), rows[i]);
    }

    if (!rows.length) {
      log.audit("PTLL diagnostic rows", "No rows found for SO " + soId);
    }
  }

  return {
    execute: execute,
  };
});
