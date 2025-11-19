/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/search", "N/https", "N/runtime", "N/log", "N/format"], (
  search,
  https,
  runtime,
  log,
  format
) => {
  const WEBHOOK_URL =
    "https://portal.hplapidary.com/api/hooks/netsuite/customer-merge";
  const WEBHOOK_SECRET_CONST =
    "4736225f8f8f34c2399cd6a27c6068c13fdc6e4fad20907a5216231213";
  const getParam = (n, d) => {
    const v = runtime.getCurrentScript().getParameter({ name: n });
    return v === null || v === undefined || v === "" ? d : v;
  };
  const LOOKBACK_MINUTES = () =>
    Number(getParam("custscript_merge_lookback_minutes", "30"));
  const SLACK_URL = () => getParam("custscript_merge_slack_webhook", "");

  const buildSearch = () =>
    search.create({
      type: search.Type.CUSTOMER,
      filters: [
        ["systemnotes.newvalue", "startswith", "Merged with duplicates:"],
      ],
      columns: [
        "internalid",
        "entityid",
        "email",
        search.createColumn({
          name: "date",
          join: "systemNotes",
          sort: search.Sort.DESC,
        }),
        search.createColumn({ name: "name", join: "systemNotes" }),
        search.createColumn({ name: "newvalue", join: "systemNotes" }),
        search.createColumn({ name: "type", join: "systemNotes" }),
      ],
    });

  const parseMergedIds = (txt) => {
    if (!txt) return [];
    const m = String(txt).match(/Merged with duplicates:\s*([\d,\s]+)/i);
    if (!m || !m[1]) return [];
    return m[1]
      .split(",")
      .map((s) => Number(String(s).trim()))
      .filter(Number.isFinite);
  };

  const getInputData = () => {
    const lookback = LOOKBACK_MINUTES();
    const cutoffMs = Date.now() - lookback * 60 * 1000;
    log.audit("merge-mr:start", {
      lookbackMinutes: lookback,
      cutoffIso: new Date(cutoffMs).toISOString(),
    });

    const s = buildSearch();
    const paged = s.runPaged({ pageSize: 1000 });

    let scanned = 0;
    let accepted = 0;
    let stoppedOnOld = false;
    const rows = [];

    paged.pageRanges.forEach((range) => {
      if (stoppedOnOld) return;
      const page = paged.fetch({ index: range.index });
      for (let i = 0; i < page.data.length; i++) {
        const r = page.data[i];
        scanned += 1;

        const whenStr = r.getValue({ name: "date", join: "systemNotes" });
        let when = null;
        try {
          when = whenStr
            ? format.parse({ value: whenStr, type: format.Type.DATETIME })
            : null;
        } catch (e) {
          when = null;
        }
        const whenMs = when ? when.getTime() : 0;

        if (when && whenMs < cutoffMs) {
          stoppedOnOld = true;
          break;
        }

        rows.push({
          recordType: search.Type.CUSTOMER,
          masterId: Number(r.getValue("internalid")),
          masterDisplay: r.getValue("entityid") || null,
          masterEmail: r.getValue("email") || null,
          systemNoteDate: whenStr,
          systemNoteBy: r.getValue({ name: "name", join: "systemNotes" }),
          systemNoteNewValue: r.getValue({
            name: "newvalue",
            join: "systemNotes",
          }),
        });
        accepted += 1;
      }
    });

    log.audit("merge-mr:collected", { scanned, accepted, stoppedOnOld });
    return rows;
  };

  const map = (ctx) => {
    const row = JSON.parse(ctx.value);
    const mergedIds = parseMergedIds(row.systemNoteNewValue) || [];
    if (!row.masterEmail) {
      log.debug("merge-mr:skip-no-email", {
        masterId: row.masterId,
        date: row.systemNoteDate,
      });
      log.debug("merge-mr:note", { newvalue: row.systemNoteNewValue });
      return;
    }
    const eventId =
      String(row.masterId) + ":" + String(row.systemNoteDate || "");
    const out = {
      event: "netsuite.entity.merge",
      eventId,
      recordType: row.recordType,
      masterId: row.masterId,
      masterEmail: row.masterEmail,
      masterDisplay: row.masterDisplay || null,
      mergedIds,
      systemNote: {
        when: row.systemNoteDate,
        by: row.systemNoteBy,
        rawNewValue: row.systemNoteNewValue,
      },
    };
    log.debug("merge-mr:emit", {
      masterId: row.masterId,
      email: row.masterEmail,
      mergedIds: mergedIds.length,
    });
    ctx.write({ key: String(row.masterId), value: JSON.stringify(out) });
  };

  const reduce = (ctx) => {
    const payloads = ctx.values.map((v) => JSON.parse(v));
    const base = payloads[0];
    const set = new Set();
    payloads.forEach((p) => p.mergedIds.forEach((id) => set.add(id)));
    base.mergedIds = Array.from(set);

    const headers = {
      "Content-Type": "application/json",
      "x-netsuite-webhook-secret": WEBHOOK_SECRET_CONST,
    };

    log.audit("merge-mr:secret", {
      secret: WEBHOOK_SECRET_CONST,
      len: WEBHOOK_SECRET_CONST.length,
    });

    log.audit("merge-mr:post", {
      masterId: base.masterId,
      email: base.masterEmail,
      mergedIds: base.mergedIds.length,
      url: WEBHOOK_URL,
    });

    const payload = Object.assign({}, base, { secret: WEBHOOK_SECRET_CONST });
    const bodyJson = JSON.stringify(payload);
    log.debug("merge-mr:post-body", bodyJson);

    try {
      const resp = https.post({
        url: WEBHOOK_URL,
        headers,
        body: bodyJson,
      });
      const bodySnippet = resp.body ? String(resp.body).slice(0, 2000) : null;
      log.audit("merge-mr:post-result", {
        masterId: base.masterId,
        email: base.masterEmail,
        status: resp.code,
        body: bodySnippet,
      });
    } catch (e) {
      log.error("merge-mr:post-error", {
        masterId: base.masterId,
        email: base.masterEmail,
        message: e && e.message,
      });
    }

    if (SLACK_URL() && base.mergedIds.length > 0) {
      try {
        https.post({
          url: SLACK_URL(),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: "Entity merge posted",
            attachments: [
              {
                fields: [
                  {
                    title: "masterId",
                    value: String(base.masterId),
                    short: true,
                  },
                  {
                    title: "email",
                    value: String(base.masterEmail || ""),
                    short: true,
                  },
                  {
                    title: "mergedIds",
                    value: String(base.mergedIds.length),
                    short: true,
                  },
                ],
              },
            ],
          }),
        });
      } catch (e) {
        log.debug("merge-mr:slack-error", { message: e && e.message });
      }
    }
  };

  const summarize = (summary) => {
    if (summary.inputSummary.error)
      log.error("merge-mr:input-error", summary.inputSummary.error);
    let mapErrors = 0;
    summary.mapSummary.errors.iterator().each((k, e) => {
      mapErrors += 1;
      log.error("merge-mr:map-error", { key: k, error: e });
      return true;
    });
    let reduceErrors = 0;
    summary.reduceSummary.errors.iterator().each((k, e) => {
      reduceErrors += 1;
      log.error("merge-mr:reduce-error", { key: k, error: e });
      return true;
    });
    log.audit("merge-mr:summary", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
      mapErrors,
      reduceErrors,
    });
  };

  return { getInputData, map, reduce, summarize };
});
