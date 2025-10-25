/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/search", "N/record", "N/log"], function (search, record, log) {
  function uniq(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var k = String(list[i]);
      if (!seen[k]) {
        seen[k] = true;
        out.push(k);
      }
    }
    return out;
  }

  function collectWaveIdsByCreatedFrom(soId) {
    var ids = [];
    try {
      var s = search.create({
        type: "wave",
        filters: [["createdfrom", "anyof", soId]],
        columns: ["internalid", "status"],
      });
      s.run().each(function (r) {
        var txt = (r.getText({ name: "status" }) || "").trim().toLowerCase();
        if (txt === "released") ids.push(r.id);
        return true;
      });
    } catch (e) {
      log.error("createdfrom search failed", {
        message: e.message || String(e),
      });
    }
    return ids;
  }

  function collectWaveIdsByTxnJoin(soId) {
    var ids = [];
    try {
      var s = search.create({
        type: "wave",
        filters: [["transaction.internalid", "anyof", soId]],
        columns: ["internalid", "status"],
      });
      s.run().each(function (r) {
        var txt = (r.getText({ name: "status" }) || "").trim().toLowerCase();
        if (txt === "released") ids.push(r.id);
        return true;
      });
    } catch (e) {
      log.error("transaction join search failed", {
        message: e.message || String(e),
      });
    }
    return ids;
  }

  function afterSubmit(ctx) {
    try {
      if (ctx.type === ctx.UserEventType.DELETE) return;
      var newRec = ctx.newRecord;
      var oldRec = ctx.oldRecord;
      var newStatus = String(newRec.getValue("shipstatus") || "").trim();
      var oldStatus = oldRec
        ? String(oldRec.getValue("shipstatus") || "").trim()
        : "";
      if (!(newStatus === "C" && oldStatus !== "C")) return;

      var soId = newRec.getValue("createdfrom");
      if (!soId) return;

      var waveIds = collectWaveIdsByCreatedFrom(soId);
      if (waveIds.length === 0) waveIds = collectWaveIdsByTxnJoin(soId);
      waveIds = uniq(waveIds);

      if (!waveIds.length) return;

      var deleted = [];
      var failed = [];
      for (var i = 0; i < waveIds.length; i++) {
        try {
          record.delete({ type: "wave", id: waveIds[i] });
          deleted.push(waveIds[i]);
        } catch (e) {
          failed.push({
            id: waveIds[i],
            msg: e && e.message ? e.message : String(e),
          });
        }
      }

      log.audit("ItemFulfillment shipped → removed released waves", {
        salesOrderId: soId,
        deletedCount: deleted.length,
        deletedIds: deleted,
        failed: failed,
      });
    } catch (err) {
      log.error(
        "Unhandled error in IF shipped wave cleanup",
        err && err.message ? err.message : String(err)
      );
    }
  }

  return { afterSubmit: afterSubmit };
});
