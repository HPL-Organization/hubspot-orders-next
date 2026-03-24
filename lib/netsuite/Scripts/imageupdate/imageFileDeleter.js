/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/log", "N/file"], (search, log, file) => {
  const IMAGE_FOLDER_ID = 1598; // image folder id
  const DRY_RUN = false;

  function getInputData() {
    return search.create({
      type: "file",
      filters: [
        ["folder", "anyof", IMAGE_FOLDER_ID],
        "AND",
        ["filetype", "anyof", "JPGIMAGE", "PNGIMAGE", "GIFIMAGE"],
      ],
      columns: [
        search.createColumn({ name: "name", sort: search.Sort.ASC }),
        "filetype",
      ],
    });
  }

  function map(ctx) {
    const row = JSON.parse(ctx.value);
    const fileId = Number(row.id);
    const name = row.values?.name || "";
    const filetype = row.values?.filetype || "";

    if (!fileId) {
      log.error("SKIP missing fileId", ctx.value);
      return;
    }

    if (DRY_RUN) {
      log.audit(
        "DRY RUN would delete",
        `id=${fileId} name=${name} type=${filetype}`
      );
      return;
    }

    try {
      file.delete({ id: fileId });
      log.audit("DELETED", `id=${fileId} name=${name} type=${filetype}`);
    } catch (e) {
      log.error(
        "SKIP (delete failed)",
        `id=${fileId} name=${name} err=${e.name || ""} ${e.message || e}`
      );
    }
  }

  function summarize(summary) {
    if (summary.inputSummary?.error) {
      log.error("Input error", summary.inputSummary.error);
    }

    summary.mapSummary.errors.iterator().each((k, e) => {
      log.error(`Map error key=${k}`, e);
      return true;
    });

    log.audit("DONE", "Finished delete attempt for folder " + IMAGE_FOLDER_ID);
  }

  return { getInputData, map, summarize };
});
