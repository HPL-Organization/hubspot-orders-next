/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/file", "N/log", "N/search"], function (file, log, search) {
  function findFileIdByName(name, folderId) {
    var s = search.create({
      type: "file",
      filters: [
        ["name", "is", name],
        "AND",
        ["folder", "anyof", String(folderId)],
      ],
      columns: ["internalid"],
    });
    var id = null;
    s.run().each(function (res) {
      id = Number(res.getValue("internalid"));
      return false;
    });
    return id;
  }

  function get(request) {
    var idRaw = request && request.id;
    var idNum = Number(idRaw);
    var folderIdRaw = request && request.folderId;
    var folderId = Number(folderIdRaw);
    if (!isFinite(folderId) || folderId <= 0) folderId = 2279;

    var name = (request && request.name) || "customers.jsonl";
    var useManifest =
      String((request && request.manifest) || "").toLowerCase() === "1" ||
      String((request && request.manifest) || "").toLowerCase() === "t" ||
      String((request && request.useManifest) || "").toLowerCase() === "1" ||
      String((request && request.useManifest) || "").toLowerCase() === "t";

    if (!idRaw || !isFinite(idNum) || idNum <= 0) {
      if (useManifest) {
        try {
          var manifestId = findFileIdByName(
            "customer_export_manifest.json",
            folderId
          );
          if (!manifestId) {
            return JSON.stringify({ ok: false, error: "ManifestNotFound" });
          }
          var mf = file.load({ id: manifestId });
          var body = mf.getContents() || "";
          var parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch (e) {
            return JSON.stringify({ ok: false, error: "ManifestParseError" });
          }
          var embeddedId = parsed && parsed.file && parsed.file.id;
          var n = Number(embeddedId);
          if (!embeddedId || !isFinite(n) || n <= 0) {
            return JSON.stringify({
              ok: false,
              error: "ManifestMissingFileId",
            });
          }
          idNum = n;
        } catch (e) {
          try {
            log.error("RESTlet.Manifest.Exception", {
              name: e && e.name,
              message: e && e.message,
              stack: e && e.stack,
            });
          } catch (_) {}
          return JSON.stringify({ ok: false, error: "ManifestLoadFailed" });
        }
      } else {
        var lookedUp = findFileIdByName(name, folderId);
        if (!lookedUp) {
          return JSON.stringify({ ok: false, error: "FileNotFound" });
        }
        idNum = Number(lookedUp);
      }
    }

    var lineStart = Number(request && request.lineStart);
    if (!isFinite(lineStart) || lineStart < 0) lineStart = 0;

    var maxLinesReq = Number(request && request.maxLines);
    if (!isFinite(maxLinesReq) || maxLinesReq <= 0) maxLinesReq = 1000;
    if (maxLinesReq > 5000) maxLinesReq = 5000;

    try {
      var f = file.load({ id: idNum });
      var collected = [];
      var idx = 0;
      var iterator = f.lines.iterator();
      iterator.each(function (line) {
        var v = line && typeof line.value === "string" ? line.value : "";
        if (idx >= lineStart && collected.length < maxLinesReq) {
          collected.push(v);
        }
        idx += 1;
        if (collected.length >= maxLinesReq) return false;
        return true;
      });

      var done = collected.length < maxLinesReq;
      return JSON.stringify({
        ok: true,
        id: idNum,
        name: f.name,
        mime: f.mimeType || "text/plain",
        lineStart: lineStart,
        linesReturned: collected.length,
        data: collected.join("\n"),
        encoding: "utf8",
        done: !!done,
      });
    } catch (e) {
      try {
        log.error(
          "RESTlet.Exception",
          JSON.stringify({
            name: e && e.name,
            message: e && e.message,
            stack: e && e.stack,
            fileId: idNum,
            lineStart: lineStart,
            maxLines: maxLinesReq,
          })
        );
      } catch (_) {}
      return JSON.stringify({
        ok: false,
        error: "Unexpected",
        details: { name: e && e.name, message: e && e.message },
      });
    }
  }

  return { get: get };
});
