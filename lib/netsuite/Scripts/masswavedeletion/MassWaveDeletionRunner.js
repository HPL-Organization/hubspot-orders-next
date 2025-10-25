/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/task",
  "N/runtime",
  "N/search",
  "N/log",
], function (ui, task, runtime, search, log) {
  var BATCH_SO = 200;

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
      .replace(/\r/g, "")
      .replace(/\n/g, ",");
    return t
      .split(",")
      .map(function (v) {
        return String(v || "").trim();
      })
      .filter(Boolean);
  }
  function extractIdsFromFile(fileObj) {
    try {
      if (!fileObj) return [];
      var txt = fileObj.getContents ? fileObj.getContents() : "";
      if (!txt) return [];
      var tokens = String(txt)
        .replace(/\r/g, "\n")
        .split(/[\n,;|\t]+/);
      var out = [];
      for (var i = 0; i < tokens.length; i++) {
        var m = String(tokens[i] || "").match(/\d+/g);
        if (m) for (var j = 0; j < m.length; j++) out.push(m[j]);
      }
      return out;
    } catch (e) {
      log.error("FileParseError", e);
      return [];
    }
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
  function uniq(a) {
    var seen = {},
      out = [];
    for (var i = 0; i < a.length; i++) {
      var k = String(a[i]);
      if (!seen[k]) {
        seen[k] = 1;
        out.push(k);
      }
    }
    return out;
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function findWavesForBatch(soBatch, targetStatuses) {
    var map = {};
    for (var i = 0; i < soBatch.length; i++) map[soBatch[i]] = [];
    try {
      var filters = [
        ["createdfrom", "anyof", soBatch],
        "OR",
        ["transaction.internalid", "anyof", soBatch],
      ];
      var columns = [
        "internalid",
        "status",
        "createdfrom",
        search.createColumn({ name: "internalid", join: "transaction" }),
      ];
      var s = search.create({
        type: "wave",
        filters: filters,
        columns: columns,
      });
      s.run().each(function (r) {
        var waveId = r.id;
        var st = (r.getText({ name: "status" }) || "").trim().toLowerCase();
        if (targetStatuses.indexOf(st) === -1) return true;
        var soViaCreatedFrom = r.getValue({ name: "createdfrom" });
        var soViaTxnJoin = r.getValue({
          name: "internalid",
          join: "transaction",
        });
        var soKey = String(soViaCreatedFrom || soViaTxnJoin || "");
        if (soKey) {
          if (!map[soKey]) map[soKey] = [];
          map[soKey].push(waveId);
        }
        return true;
      });
    } catch (e) {
      log.error("BulkWaveSearchFailed", {
        batchSize: soBatch.length,
        message: e.message || String(e),
      });
    }
    return map;
  }

  function previewCandidates(soIds, statuses) {
    var rows = [];
    var totalWaves = 0;
    var batches = chunk(soIds, BATCH_SO);
    for (var b = 0; b < batches.length; b++) {
      var batch = batches[b];
      var map = findWavesForBatch(batch, statuses);
      for (var i = 0; i < batch.length; i++) {
        var soId = batch[i];
        var waves = map[soId] || [];
        var seen = {},
          dedup = [];
        for (var k = 0; k < waves.length; k++) {
          var w = String(waves[k]);
          if (!seen[w]) {
            seen[w] = 1;
            dedup.push(w);
          }
        }
        rows.push({ soId: soId, waves: dedup });
        totalWaves += dedup.length;
      }
      try {
        var rem = runtime.getCurrentScript().getRemainingUsage();
        if (rem < 100) {
          log.audit("GovernanceStop", {
            remaining: rem,
            processedBatches: b + 1,
            totalBatches: batches.length,
          });
          break;
        }
      } catch (_) {}
    }
    return { rows: rows, totalSOs: rows.length, totalWaves: totalWaves };
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

  function renderForm(ctx) {
    var form = ui.createForm({ title: "Mass Unwind Waves" });
    form.addField({
      id: "custpage_so_csv",
      type: ui.FieldType.LONGTEXT,
      label: "Sales Order IDs (CSV or line-separated)",
    });
    form.addField({
      id: "custpage_so_file",
      type: ui.FieldType.FILE,
      label: "Upload CSV/TXT (Sales Order IDs)",
    });
    form.addField({
      id: "custpage_statuses",
      type: ui.FieldType.TEXT,
      label: " ",
    }).defaultValue = "released,ready";
    form
      .getField({ id: "custpage_statuses" })
      .updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN });
    form.addField({
      id: "custpage_mode",
      type: ui.FieldType.TEXT,
      label: " ",
    }).defaultValue = "preview";
    form
      .getField({ id: "custpage_mode" })
      .updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN });
    form.addField({
      id: "custpage_so_savedsearch",
      type: ui.FieldType.TEXT,
      label: " ",
    }).defaultValue = "";
    form
      .getField({ id: "custpage_so_savedsearch" })
      .updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN });
    form.addField({
      id: "custpage_dryrun",
      type: ui.FieldType.CHECKBOX,
      label: " ",
    }).defaultValue = "F";
    form
      .getField({ id: "custpage_dryrun" })
      .updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN });
    form.addSubmitButton({ label: "Submit" });
    ctx.response.writePage(form);
  }

  function renderPreview(ctx, params, summary, resolvedIds) {
    var html =
      '<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;max-width:1000px;margin:0 auto;">' +
      '<h2 style="margin:0 0 8px;">Preview: Candidate Waves</h2>' +
      '<p style="margin:0 0 6px;">Statuses: ' +
      params.statuses.join(", ") +
      "</p>" +
      '<p style="margin:0 0 6px;">Sales Orders scanned: ' +
      summary.totalSOs +
      "</p>" +
      '<p style="margin:0 12px 16px 0;">Total waves matching: <b>' +
      summary.totalWaves +
      "</b></p>" +
      '<table style="border-collapse:collapse;width:100%"><thead><tr>' +
      '<th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Sales Order ID</th>' +
      '<th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Wave IDs</th>' +
      '<th style="text-align:right;border-bottom:1px solid #ddd;padding:8px;">Count</th>' +
      "</tr></thead><tbody>";
    for (var i = 0; i < summary.rows.length; i++) {
      var r = summary.rows[i];
      html +=
        '<tr><td style="border-bottom:1px solid #eee;padding:8px;">' +
        r.soId +
        "</td>" +
        '<td style="border-bottom:1px solid #eee;padding:8px;">' +
        (r.waves.length ? r.waves.join(", ") : "<i>None</i>") +
        "</td>" +
        '<td style="border-bottom:1px solid #eee;padding:8px;text-align:right;">' +
        r.waves.length +
        "</td></tr>";
    }
    html +=
      "</tbody></table>" +
      '<form method="POST" style="margin-top:18px;">' +
      '<input type="hidden" name="custpage_so_resolved" value="' +
      encodeHtml(resolvedIds.join(",")) +
      '"/>' +
      '<input type="hidden" name="custpage_so_csv" value="' +
      encodeHtml(String(params.soCsv || "")) +
      '"/>' +
      '<input type="hidden" name="custpage_so_savedsearch" value=""/>' +
      '<input type="hidden" name="custpage_statuses" value="' +
      encodeHtml(params.statuses.join(",")) +
      '"/>' +
      '<input type="hidden" name="custpage_mode" value="run"/>' +
      '<input type="hidden" name="custpage_dryrun" value="' +
      (params.dryRun ? "T" : "F") +
      '"/>' +
      '<button type="submit" style="padding:8px 14px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Confirm Delete (Run)</button>' +
      "</form>" +
      '<form method="GET" style="margin-top:8px;"><button type="submit" style="padding:6px 10px;border:none;background:none;color:#0366d6;cursor:pointer;">Back</button></form>' +
      "</div>";
    var form = ui.createForm({ title: "Mass Unwind Waves: Preview" });
    form.addField({
      id: "custpage_preview",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = html;
    ctx.response.writePage(form);
  }

  function encodeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function onRequest(ctx) {
    if (ctx.request.method === "GET") {
      renderForm(ctx);
      return;
    }

    var soCsv = String(ctx.request.parameters.custpage_so_csv || "").trim();
    var soSavedSearch = String(
      ctx.request.parameters.custpage_so_savedsearch || ""
    ).trim();
    var statuses = parseStatuses(ctx.request.parameters.custpage_statuses);
    var mode = String(ctx.request.parameters.custpage_mode || "preview");
    var dryRun = String(ctx.request.parameters.custpage_dryrun || "") === "T";

    var soIds = [];
    var resolvedFromHidden = String(
      ctx.request.parameters.custpage_so_resolved || ""
    ).trim();
    if (mode === "run" && resolvedFromHidden) {
      soIds = soIds.concat(csvToIds(resolvedFromHidden));
    } else {
      soIds = soIds.concat(csvToIds(soCsv));
      try {
        var upload =
          ctx.request.files && ctx.request.files.custpage_so_file
            ? ctx.request.files.custpage_so_file
            : null;
        if (upload) soIds = soIds.concat(extractIdsFromFile(upload));
      } catch (e) {
        log.error("UploadReadError", e);
      }
      soIds = soIds.concat(gatherSoIdsFromSavedSearch(soSavedSearch));
    }
    soIds = uniq(soIds);

    if (!soIds.length) {
      var f = ui.createForm({ title: "Mass Unwind Waves" });
      f.addField({
        id: "custpage_err",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue =
        '<div style="padding:16px;color:#b00020;">Please provide SO IDs via CSV text or upload a CSV/TXT file.</div>';
      f.addField({
        id: "custpage_so_csv",
        type: ui.FieldType.LONGTEXT,
        label: "Sales Order IDs (CSV or line-separated)",
      }).defaultValue = soCsv;
      f.addField({
        id: "custpage_so_file",
        type: ui.FieldType.FILE,
        label: "Upload CSV/TXT (Sales Order IDs)",
      });
      f.addField({
        id: "custpage_statuses",
        type: ui.FieldType.TEXT,
        label: " ",
      }).defaultValue = statuses.join(",");
      f.getField({ id: "custpage_statuses" }).updateDisplayType({
        displayType: ui.FieldDisplayType.HIDDEN,
      });
      f.addField({
        id: "custpage_mode",
        type: ui.FieldType.TEXT,
        label: " ",
      }).defaultValue = "preview";
      f.getField({ id: "custpage_mode" }).updateDisplayType({
        displayType: ui.FieldDisplayType.HIDDEN,
      });
      f.addField({
        id: "custpage_so_savedsearch",
        type: ui.FieldType.TEXT,
        label: " ",
      }).defaultValue = "";
      f.getField({ id: "custpage_so_savedsearch" }).updateDisplayType({
        displayType: ui.FieldDisplayType.HIDDEN,
      });
      f.addField({
        id: "custpage_dryrun",
        type: ui.FieldType.CHECKBOX,
        label: " ",
      }).defaultValue = dryRun ? "T" : "F";
      f.getField({ id: "custpage_dryrun" }).updateDisplayType({
        displayType: ui.FieldDisplayType.HIDDEN,
      });
      f.addSubmitButton({ label: "Submit" });
      ctx.response.writePage(f);
      return;
    }

    if (mode === "preview") {
      var summary = previewCandidates(soIds, statuses);
      renderPreview(
        ctx,
        {
          soCsv: soCsv,
          soSavedSearch: soSavedSearch,
          statuses: statuses,
          dryRun: dryRun,
        },
        summary,
        soIds
      );
      return;
    }

    var soCsvForMr = csvToIds(soCsv).length ? soCsv : soIds.join(",");
    var t = task.create({
      taskType: task.TaskType.MAP_REDUCE,
      scriptId: "customscript2675",
      deploymentId: "customdeploy1",
      params: {
        custscript_muw_so_csv: soCsvForMr,
        custscript_muw_so_savedsearch: soSavedSearch,
        custscript_muw_statuses: statuses.join(","),
        custscript_muw_dryrun: dryRun ? "1" : "0",
      },
    });
    var taskId = t.submit();
    var form2 = ui.createForm({ title: "Mass Unwind Waves: Submitted" });
    form2.addField({
      id: "custpage_msg",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue =
      '<div style="padding:16px;"><p><b>Task submitted.</b></p><p>Task ID: ' +
      taskId +
      "</p><p>Statuses: " +
      statuses.join(", ") +
      "</p><p>Dry run: " +
      (dryRun ? "Yes" : "No") +
      "</p></div>";
    ctx.response.writePage(form2);
  }
  return { onRequest: onRequest };
});
