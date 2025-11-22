/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/file", "N/log"], function (file, log) {
  function get(request) {
    var idRaw = request && request.id;
    var idNum = Number(idRaw);
    if (!idRaw || !isFinite(idNum) || idNum <= 0) {
      return JSON.stringify({ ok: false, error: "InvalidId" });
    }

    var lineStart = Number(request.lineStart || 0);
    if (!isFinite(lineStart) || lineStart < 0) lineStart = 0;

    var maxLinesReq = Number(request.maxLines || 1000);
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
