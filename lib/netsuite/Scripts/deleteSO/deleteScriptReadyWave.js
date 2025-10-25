/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/search", "N/record", "N/url", "N/redirect", "N/log"], function (
  search,
  record,
  url,
  redirect,
  log
) {
  function parseStatuses(param) {
    var s = String(param || "").trim();
    if (!s) return ["released", "ready"];
    return s
      .split(",")
      .map(function (x) {
        return String(x || "")
          .trim()
          .toLowerCase();
      })
      .filter(Boolean);
  }

  function collectWaveIdsByCreatedFrom(soId, targetStatuses) {
    var ids = [];
    try {
      log.debug("Search createdfrom -> wave", {
        soId: soId,
        targetStatuses: targetStatuses,
      });
      var s = search.create({
        type: "wave",
        filters: [["createdfrom", "anyof", soId]],
        columns: ["internalid", "status", "createdfrom"],
      });
      s.run().each(function (r) {
        var txt = (r.getText({ name: "status" }) || "").trim().toLowerCase();
        log.debug("Wave candidate (createdfrom)", {
          id: r.id,
          statusText: txt,
        });
        if (targetStatuses.indexOf(txt) !== -1) ids.push(r.id);
        return true;
      });
    } catch (e) {
      log.error("createdfrom search failed", {
        message: e.message || String(e),
      });
    }
    return ids;
  }

  function collectWaveIdsByTxnJoin(soId, targetStatuses) {
    var ids = [];
    try {
      log.debug("Search transaction join -> wave", {
        soId: soId,
        targetStatuses: targetStatuses,
      });
      var s = search.create({
        type: "wave",
        filters: [["transaction.internalid", "anyof", soId]],
        columns: ["internalid", "status"],
      });
      s.run().each(function (r) {
        var txt = (r.getText({ name: "status" }) || "").trim().toLowerCase();
        log.debug("Wave candidate (txn join)", { id: r.id, statusText: txt });
        if (targetStatuses.indexOf(txt) !== -1) ids.push(r.id);
        return true;
      });
    } catch (e) {
      log.error("transaction join search failed", {
        message: e.message || String(e),
      });
    }
    return ids;
  }

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

  function onRequest(ctx) {
    log.audit("Unwind Waves: start", {
      method: ctx.request.method,
      params: ctx.request.parameters,
    });
    try {
      var soId = String(ctx.request.parameters.so || "").trim();
      var debugMode = String(ctx.request.parameters.debug || "").trim() === "1";
      var targetStatuses = parseStatuses(ctx.request.parameters.status);
      if (!soId) {
        log.error("MissingParam", 'Param "so" is required');
        ctx.response.write('Missing sales order id (param "so").');
        return;
      }

      log.debug("Params received", {
        soId: soId,
        debugMode: debugMode,
        targetStatuses: targetStatuses,
      });

      var waveIds = collectWaveIdsByCreatedFrom(soId, targetStatuses);
      if (waveIds.length === 0) {
        log.debug("No waves via createdfrom, trying txn join", { soId: soId });
        waveIds = collectWaveIdsByTxnJoin(soId, targetStatuses);
      }
      waveIds = uniq(waveIds);

      log.audit("Target waves collected", {
        count: waveIds.length,
        ids: waveIds,
      });

      var deleted = [];
      var failed = [];
      for (var i = 0; i < waveIds.length; i++) {
        var wid = waveIds[i];
        try {
          log.debug("Attempting delete", { waveId: wid });
          record.delete({ type: "wave", id: wid });
          deleted.push(wid);
          log.audit("Deleted wave", { waveId: wid });
        } catch (e) {
          var msg = e && e.message ? e.message : String(e);
          failed.push({ id: wid, msg: msg });
          log.error("Delete failed", { waveId: wid, message: msg });
        }
      }

      var soUrl = url.resolveRecord({
        recordType: "salesorder",
        recordId: soId,
        isEditMode: false,
      });

      if (!debugMode && failed.length === 0) {
        log.audit("All deletions successful; redirecting", {
          deletedCount: deleted.length,
        });
        redirect.redirect({ url: soUrl });
        return;
      }

      var html =
        '<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;max-width:900px;margin:0 auto;">' +
        '<h2 style="margin:0 0 12px;">Unwind Waves</h2>' +
        '<p style="margin:0 0 8px;">Sales Order: ' +
        soId +
        "</p>" +
        '<p style="margin:0 0 8px;">Statuses targeted: ' +
        targetStatuses.join(", ") +
        "</p>" +
        '<p style="margin:0 0 8px;">Waves found: ' +
        waveIds.length +
        "</p>" +
        '<p style="margin:0 0 8px;">Deleted: ' +
        deleted.length +
        "</p>" +
        '<p style="margin:0 0 8px;">Failed: ' +
        failed.length +
        "</p>";

      if (waveIds.length) {
        html += '<h3 style="margin:16px 0 8px;">Candidates</h3><ul>';
        for (var c = 0; c < waveIds.length; c++)
          html += "<li>Wave " + waveIds[c] + "</li>";
        html += "</ul>";
      }

      if (deleted.length) {
        html += '<h3 style="margin:16px 0 8px;">Deleted</h3><ul>';
        for (var d = 0; d < deleted.length; d++)
          html += "<li>Wave " + deleted[d] + "</li>";
        html += "</ul>";
      }

      if (failed.length) {
        html += '<h3 style="margin:16px 0 8px;">Failed</h3><ul>';
        for (var f = 0; f < failed.length; f++)
          html += "<li>Wave " + failed[f].id + ": " + failed[f].msg + "</li>";
        html += "</ul>";
      }

      html +=
        '<p style="margin-top:16px;"><a href="' +
        soUrl +
        '">Back to Sales Order</a></p>' +
        "</div>";

      ctx.response.write(html);
      log.audit("Unwind Waves: done", {
        deletedCount: deleted.length,
        failedCount: failed.length,
        debugMode: debugMode,
      });
    } catch (err) {
      var emsg = err && err.message ? err.message : String(err);
      log.error("Unhandled error", emsg);
      ctx.response.write("Error: " + emsg);
    }
  }

  return { onRequest: onRequest };
});
