/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/file", "N/search"], function (query, file, search) {
  function getInputData() {
    return [1];
  }

  function map(context) {
    context.write({ key: "RUN", value: "RUN" });
  }

  function reduce(context) {}

  function summarize(summary) {
    var folderId = 2279;
    var PAGE = 1000;

    function two(n) {
      return n < 10 ? "0" + n : "" + n;
    }
    var d = new Date();
    var tag =
      d.getFullYear().toString() +
      two(d.getMonth() + 1) +
      two(d.getDate()) +
      "_" +
      two(d.getHours()) +
      two(d.getMinutes()) +
      two(d.getSeconds());

    function findFileIdsByName(name) {
      var ids = [];
      var s = search.create({
        type: "file",
        filters: [
          ["name", "is", name],
          "AND",
          ["folder", "anyof", String(folderId)],
        ],
        columns: ["internalid"],
      });
      s.run().each(function (res) {
        ids.push(Number(res.getValue("internalid")));
        return true;
      });
      return ids;
    }

    function deleteAllByName(name) {
      var ids = findFileIdsByName(name);
      for (var i = 0; i < ids.length; i++) {
        try {
          file["delete"]({ id: ids[i] });
        } catch (e) {
          log.debug("deleteAllByName: delete failed", {
            name: name,
            id: ids[i],
            error: e,
          });
        }
      }
    }

    function createTempThenRename(finalName, contents, fileType) {
      deleteAllByName(finalName);

      var tempName = finalName + "." + Date.now() + ".tmp";
      var tempId = file
        .create({
          name: tempName,
          fileType: fileType,
          contents: contents,
          folder: folderId,
        })
        .save();

      var f = file.load({ id: tempId });
      f.name = finalName;
      var finalId = f.save();

      var ids = findFileIdsByName(finalName);
      if (ids.length > 1) {
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i];
          if (id !== finalId) {
            try {
              file["delete"]({ id: id });
            } catch (e) {
              log.debug("createTempThenRename: cleanup delete failed", {
                finalName: finalName,
                id: id,
                error: e,
              });
            }
          }
        }
      }

      return finalId;
    }

    var availLines = [];
    var availCount = 0;

    var lastId = 0;
    for (;;) {
      var rows =
        query
          .runSuiteQL({
            query:
              "SELECT " +
              "  I.id AS itemid, " +
              "  SUM(NVL(AIL.QuantityAvailable, 0)) AS quantityavailable " +
              "FROM item I " +
              "LEFT JOIN AggregateItemLocation AIL ON AIL.item = I.id " +
              "WHERE I.isinactive = 'F' " +
              "  AND I.id > ? " +
              "GROUP BY I.id " +
              "ORDER BY I.id ASC " +
              "FETCH NEXT " +
              PAGE +
              " ROWS ONLY",
            params: [lastId],
          })
          .asMappedResults() || [];

      if (!rows.length) break;

      var lastRowItemId = 0;

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var itemId = Number(r.itemid);
        var qtyAvail = Number(r.quantityavailable || 0);

        availLines.push(
          JSON.stringify({
            item_id: itemId,
            available: qtyAvail,
          }) + "\n"
        );

        availCount++;
        lastRowItemId = itemId;
      }

      if (!lastRowItemId) break;
      lastId = lastRowItemId;
    }

    var availName = "item_availability.jsonl";
    var manifestName = "item_availability_manifest.json";

    var fAvailId = createTempThenRename(
      availName,
      availLines.join(""),
      file.Type.PLAINTEXT
    );

    var manifest = {
      generated_at: new Date().toISOString(),
      tag: tag,
      files: {
        item_availability: {
          id: fAvailId,
          name: availName,
          rows: availCount,
        },
      },
    };

    createTempThenRename(
      manifestName,
      JSON.stringify(manifest),
      file.Type.JSON
    );
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
