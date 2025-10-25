/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/record", "N/runtime", "N/log"], function (
  search,
  record,
  runtime,
  log
) {
  function parseStatuses(s) {
    var x = String(s || "").trim();
    if (!x) return ["released", "ready"];
    return x
      .split(",")
      .map(function (v) {
        return String(v || "")
          .trim()
          .toLowerCase();
      })
      .filter(Boolean);
  }
  function csvToIds(s) {
    var t = String(s || "")
      .replace(/\n/g, ",")
      .replace(/\r/g, "");
    return t
      .split(",")
      .map(function (v) {
        return String(v || "").trim();
      })
      .filter(Boolean);
  }
  function gatherSoIdsFromSavedSearch(savedSearchId) {
    if (!savedSearchId) return [];
    var out = [];
    try {
      var s = search.load({ id: savedSearchId });
      s.run().each(function (r) {
        var id = r.getValue({ name: "internalid" });
        if (id) out.push(String(id));
        return true;
      });
    } catch (e) {
      log.error("LoadSavedSearchFailed", {
        savedSearchId: savedSearchId,
        message: e.message || String(e),
      });
    }
    return out;
  }
  function collectWaveIdsByCreatedFrom(soId, targetStatuses) {
    var ids = [];
    try {
      var s = search.create({
        type: "wave",
        filters: [["createdfrom", "anyof", soId]],
        columns: ["internalid", "status", "createdfrom"],
      });
      s.run().each(function (r) {
        var st = (r.getText({ name: "status" }) || "").trim().toLowerCase();
        if (targetStatuses.indexOf(st) !== -1) ids.push(r.id);
        return true;
      });
    } catch (e) {
      log.error("SearchCreatedFromFailed", {
        soId: soId,
        message: e.message || String(e),
      });
    }
    return ids;
  }
  function collectWaveIdsByTxnJoin(soId, targetStatuses) {
    var ids = [];
    try {
      var s = search.create({
        type: "wave",
        filters: [["transaction.internalid", "anyof", soId]],
        columns: ["internalid", "status"],
      });
      s.run().each(function (r) {
        var st = (r.getText({ name: "status" }) || "").trim().toLowerCase();
        if (targetStatuses.indexOf(st) !== -1) ids.push(r.id);
        return true;
      });
    } catch (e) {
      log.error("SearchTxnJoinFailed", {
        soId: soId,
        message: e.message || String(e),
      });
    }
    return ids;
  }
  function uniq(a) {
    var seen = {};
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var k = String(a[i]);
      if (!seen[k]) {
        seen[k] = 1;
        out.push(k);
      }
    }
    return out;
  }

  function getInputData() {
    var soCsv = runtime
      .getCurrentScript()
      .getParameter({ name: "custscript_muw_so_csv" });
    var soSavedSearch = runtime
      .getCurrentScript()
      .getParameter({ name: "custscript_muw_so_savedsearch" });
    var a = [];
    a = a.concat(csvToIds(soCsv));
    a = a.concat(gatherSoIdsFromSavedSearch(soSavedSearch));
    a = uniq(a);
    log.audit("Input SO count", { count: a.length });
    return a;
  }

  function map(ctx) {
    var soId = ctx.value;
    var statuses = parseStatuses(
      runtime
        .getCurrentScript()
        .getParameter({ name: "custscript_muw_statuses" })
    );
    var dryRun =
      String(
        runtime
          .getCurrentScript()
          .getParameter({ name: "custscript_muw_dryrun" }) || ""
      ) === "1";
    var waves = collectWaveIdsByCreatedFrom(soId, statuses);
    if (waves.length === 0) waves = collectWaveIdsByTxnJoin(soId, statuses);
    waves = uniq(waves);
    var deleted = [];
    var failed = [];
    for (var i = 0; i < waves.length; i++) {
      var wid = waves[i];
      if (dryRun) {
        deleted.push(wid);
        continue;
      }
      try {
        record.delete({ type: "wave", id: wid });
        deleted.push(wid);
      } catch (e) {
        failed.push({ id: wid, msg: e && e.message ? e.message : String(e) });
      }
    }
    ctx.write(
      soId,
      JSON.stringify({
        soId: soId,
        waves: waves,
        deleted: deleted,
        failed: failed,
        dryRun: dryRun,
      })
    );
  }

  function reduce(ctx) {
    var soId = ctx.key;
    var summary = {
      soId: soId,
      totalCandidates: 0,
      totalDeleted: 0,
      totalFailed: 0,
      failures: [],
    };
    for (var i = 0; i < ctx.values.length; i++) {
      var v = {};
      try {
        v = JSON.parse(ctx.values[i] || "{}");
      } catch (e) {}
      summary.totalCandidates += (v.waves || []).length;
      summary.totalDeleted += (v.deleted || []).length;
      summary.totalFailed += (v.failed || []).length;
      if (v.failed && v.failed.length)
        summary.failures = summary.failures.concat(v.failed);
    }
    log.audit("SO Summary", summary);
  }

  function summarize(sum) {
    var totals = { input: 0, mapErrors: 0, reduceErrors: 0 };
    sum.output.iterator().each(function (key, value) {
      return true;
    });
    sum.mapSummary.errors.iterator().each(function (k, e) {
      totals.mapErrors++;
      log.error("MapError " + k, e.message);
      return true;
    });
    sum.reduceSummary.errors.iterator().each(function (k, e) {
      totals.reduceErrors++;
      log.error("ReduceError " + k, e.message);
      return true;
    });
    log.audit("Mass Unwind Complete", totals);
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
