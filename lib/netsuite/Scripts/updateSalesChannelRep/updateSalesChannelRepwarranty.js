/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/file", "N/record", "N/log"], function (file, record, log) {
  var CSV_FILE_ID = 756661;

  var SALES_CHANNEL_FIELD_ID = "cseg_nsps_so_class";
  var SALES_CHANNEL_ID = 21;

  var SALES_REP_FIELD_ID = "salesrep";
  var SALES_REP_ID = 301052;

  var DEBUG_MODE = false;

  function getInputData() {
    var csvFile = file.load({ id: CSV_FILE_ID });
    var contents = csvFile.getContents();

    if (!contents || !contents.trim()) {
      throw new Error("CSV file is empty. File ID: " + CSV_FILE_ID);
    }

    var lines = contents.split(/\r?\n/).filter(function (line) {
      return line && line.trim();
    });

    if (!lines.length) {
      throw new Error("No rows found in CSV.");
    }

    var header = lines[0].split(",").map(function (h) {
      return String(h || "")
        .trim()
        .toLowerCase();
    });

    var soIdIndex = header.indexOf("internal id");

    if (soIdIndex === -1) {
      throw new Error('CSV must contain a column named "Internal ID".');
    }

    // only take first data row
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(",");
      var soId = cols[soIdIndex] ? String(cols[soIdIndex]).trim() : "";

      if (!soId) continue;

      return [
        {
          soId: soId,
          rowNum: i + 1,
          rawRow: lines[i],
        },
      ];
    }

    throw new Error("No valid SO internal ID found in CSV.");
  }

  function map(context) {
    var data = JSON.parse(context.value);

    try {
      var values = {};
      values[SALES_CHANNEL_FIELD_ID] = SALES_CHANNEL_ID;
      values[SALES_REP_FIELD_ID] = SALES_REP_ID;

      if (DEBUG_MODE) {
        log.audit("DEBUG ONLY - would update SO", {
          soId: data.soId,
          rowNum: data.rowNum,
          csvFileId: CSV_FILE_ID,
          salesChannelFieldId: SALES_CHANNEL_FIELD_ID,
          salesChannelId: SALES_CHANNEL_ID,
          salesRepFieldId: SALES_REP_FIELD_ID,
          salesRepId: SALES_REP_ID,
          rawRow: data.rawRow,
        });

        context.write({
          key: "debug",
          value: JSON.stringify({
            soId: data.soId,
            rowNum: data.rowNum,
            message: "Debug mode only - no update performed",
          }),
        });
        return;
      }

      record.submitFields({
        type: record.Type.SALES_ORDER,
        id: Number(data.soId),
        values: values,
        options: {
          enableSourcing: false,
          ignoreMandatoryFields: true,
        },
      });

      log.audit("SO updated successfully", {
        soId: data.soId,
        rowNum: data.rowNum,
        salesChannelId: SALES_CHANNEL_ID,
        salesRepId: SALES_REP_ID,
      });

      context.write({
        key: "success",
        value: JSON.stringify({
          soId: data.soId,
          rowNum: data.rowNum,
          salesChannelId: SALES_CHANNEL_ID,
          salesRepId: SALES_REP_ID,
        }),
      });
    } catch (e) {
      log.error("Failed updating SO " + data.soId, {
        rowNum: data.rowNum,
        error: e,
      });

      context.write({
        key: "failed",
        value: JSON.stringify({
          soId: data.soId,
          rowNum: data.rowNum,
          error: e.name + ": " + e.message,
        }),
      });
    }
  }

  function summarize(summary) {
    var debugCount = 0;
    var successCount = 0;
    var failedCount = 0;
    var outputs = [];
    var mapErrors = [];

    summary.output.iterator().each(function (key, value) {
      outputs.push({ key: key, value: value });

      if (key === "debug") debugCount++;
      if (key === "success") successCount++;
      if (key === "failed") failedCount++;

      return true;
    });

    summary.mapSummary.errors.iterator().each(function (key, error) {
      failedCount++;
      mapErrors.push({
        soId: key,
        error: error,
      });
      return true;
    });

    log.audit("SO First-Row Debug Summary", {
      csvFileId: CSV_FILE_ID,
      debugMode: DEBUG_MODE,
      debugCount: debugCount,
      successCount: successCount,
      failedCount: failedCount,
      outputs: outputs,
      mapErrors: mapErrors,
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    summarize: summarize,
  };
});
