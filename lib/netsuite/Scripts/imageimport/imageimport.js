/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/file", "N/log", "N/https", "N/search"], function (
  file,
  log,
  https,
  search
) {
  const IMAGE_FOLDER_ID = 1598;
  const CSV_FILE_ID = 56285;
  const DRY_RUN = false;

  const EXT_TO_TYPE = {
    jpg: file.Type.JPGIMAGE,
    jpeg: file.Type.JPGIMAGE,
    png: file.Type.PNGIMAGE,
    gif: file.Type.GIFIMAGE,
  };

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(function (l) {
      return l && l.trim();
    });
    if (!lines.length) return [];

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(",");
      if (parts.length < 2) continue;

      const filename = (parts[0] || "").trim();
      const url = (parts.slice(1).join(",") || "").trim();

      if (!filename || !url) continue;
      out.push({ filename: filename, url: url });
    }
    return out;
  }

  function normalizeUrl(raw) {
    const m = /https:\/\/drive\.google\.com\/file\/d\/([^/]+)/i.exec(raw);
    if (m && m[1]) {
      return "https://drive.google.com/uc?export=download&id=" + m[1];
    }
    return raw;
  }

  function findExistingFileId(filename) {
    const res = search
      .create({
        type: "file",
        filters: [
          ["folder", "anyof", IMAGE_FOLDER_ID],
          "AND",
          ["name", "is", filename],
        ],
        columns: ["internalid"],
      })
      .run()
      .getRange({ start: 0, end: 1 })[0];

    if (!res) return null;
    return Number(res.getValue("internalid")) || null;
  }

  function getInputData() {
    const csv = file.load({ id: CSV_FILE_ID });
    const text = csv.getContents();
    const rows = parseCsv(text);

    log.audit("CSV parsed", "rows=" + rows.length);
    return rows;
  }

  function map(ctx) {
    const row = JSON.parse(ctx.value);
    const filename = row.filename;
    const rawUrl = row.url;
    const url = normalizeUrl(rawUrl);

    const ext = (filename.split(".").pop() || "").toLowerCase();
    const fileType = EXT_TO_TYPE[ext];

    if (!fileType) {
      log.audit(
        "Unsupported extension (skipped)",
        "filename=" + filename + " ext=" + ext
      );
      return;
    }

    log.audit("Downloading image", "filename=" + filename + " url=" + url);

    let response;
    try {
      response = https.get({ url: url });
    } catch (e) {
      log.error(
        "HTTP get failed",
        "filename=" + filename + " url=" + url + " err=" + e.message
      );
      return;
    }

    if (String(response.code) !== "200") {
      log.error(
        "Non-200 HTTP response",
        "filename=" + filename + " url=" + url + " code=" + response.code
      );
      return;
    }

    const contents = response.body;

    if (!contents || contents.length === 0) {
      log.error("Empty response body", "filename=" + filename + " url=" + url);
      return;
    }

    const existingId = findExistingFileId(filename);
    const outcomeKey = existingId ? "updated" : "created";

    if (DRY_RUN) {
      log.audit(
        "DRY RUN",
        "filename=" +
          filename +
          " existingId=" +
          (existingId || "none") +
          " size=" +
          contents.length
      );
      ctx.write({
        key: outcomeKey,
        value: "1",
      });
      return;
    }

    try {
      const newFile = file.create({
        name: filename,
        fileType: fileType,
        contents: contents,
        folder: IMAGE_FOLDER_ID,
      });
      newFile.isOnline = true;

      const newId = newFile.save();

      if (existingId && newId !== existingId) {
        try {
          file.delete({ id: existingId });
          log.audit(
            "Replaced file via delete+create",
            "filename=" + filename + " oldId=" + existingId + " newId=" + newId
          );
        } catch (eDel) {
          log.error(
            "Delete old file failed",
            "filename=" +
              filename +
              " oldId=" +
              existingId +
              " err=" +
              eDel.message
          );
        }
      } else if (existingId && newId === existingId) {
        log.audit(
          "File overwritten in place",
          "filename=" + filename + " id=" + newId
        );
      } else {
        log.audit(
          "Created new file",
          "filename=" + filename + " newId=" + newId
        );
      }

      ctx.write({
        key: outcomeKey,
        value: "1",
      });
    } catch (e) {
      log.error("Save failed", "filename=" + filename + " err=" + e.message);
    }
  }

  function reduce(ctx) {
    let count = 0;
    ctx.values.forEach(function (v) {
      count += Number(v) || 0;
    });
    ctx.write(ctx.key, String(count));
  }

  function summarize(summary) {
    let created = 0;
    let updated = 0;

    summary.output.iterator().each(function (key, value) {
      const n = Number(value) || 0;
      if (key === "created") {
        created += n;
      } else if (key === "updated") {
        updated += n;
      }
      return true;
    });

    log.audit(
      "Image import summary",
      "created=" + created + " updated=" + updated
    );
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
