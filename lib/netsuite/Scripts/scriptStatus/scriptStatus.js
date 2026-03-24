/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Ops Status Center (Read-only)
 */
define([
  "N/search",
  "N/ui/serverWidget",
  "N/format",
  "N/log",
  "N/url",
], function (search, serverWidget, format, log, url) {
  const WATCH_SCRIPTS = [
    { label: "HPL | Package Customer info for Portal", scriptInternalId: 2936 },
    { label: "HPL | Package fulfillments for Portal", scriptInternalId: 2962 },
    { label: "HPL | Package invoices for Portal", scriptInternalId: 2934 },
    { label: "HPL | Package item available", scriptInternalId: 2946 },
    { label: "HPL | Package SOs for Portal", scriptInternalId: 2960 },
  ];

  const TIME_OFFSET_HOURS = 3;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(d) {
    try {
      if (!d) return "";
      return format.format({ value: d, type: format.Type.DATETIMETZ });
    } catch (e) {
      try {
        return format.format({ value: d, type: format.Type.DATETIME });
      } catch (_e) {
        return String(d);
      }
    }
  }

  // ✅ bulletproof: always return a real Date or null
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;

    // sometimes NetSuite gives objects that stringify
    const s = String(v).trim();
    if (!s) return null;

    // try NS parse first
    try {
      const d1 = format.parse({ value: s, type: format.Type.DATETIMETZ });
      if (d1 instanceof Date && !isNaN(d1.getTime())) return d1;
    } catch (e1) {}
    try {
      const d2 = format.parse({ value: s, type: format.Type.DATETIME });
      if (d2 instanceof Date && !isNaN(d2.getTime())) return d2;
    } catch (e2) {}

    // last resort: JS Date
    const d3 = new Date(s);
    if (d3 instanceof Date && !isNaN(d3.getTime())) return d3;

    return null;
  }

  function fmtDateWithOffset(v, hoursToAdd) {
    const d = toDate(v);
    if (!d) return String(v || "");
    const shifted = new Date(d.getTime() + hoursToAdd * 60 * 60 * 1000);
    return fmtDate(shifted);
  }

  function pill(label, tone) {
    const map = {
      ok: { fg: "#0f5132", bg: "#d1e7dd", bd: "#badbcc", dot: "#198754" },
      warn: { fg: "#664d03", bg: "#fff3cd", bd: "#ffecb5", dot: "#f59f00" },
      bad: { fg: "#842029", bg: "#f8d7da", bd: "#f5c2c7", dot: "#dc3545" },
      idle: { fg: "#374151", bg: "#f3f4f6", bd: "#e5e7eb", dot: "#6b7280" },
    };
    const c = map[tone] || map.idle;

    return `
      <span style="
        display:inline-flex;align-items:center;gap:6px;
        padding:4px 10px;border-radius:999px;
        font-weight:700;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        font-size:12px;color:${c.fg};background:${c.bg};border:1px solid ${
      c.bd
    };
        white-space:nowrap;
      ">
        <span style="width:8px;height:8px;border-radius:99px;background:${
          c.dot
        };display:inline-block;"></span>
        ${esc(label)}
      </span>
    `;
  }

  function cardHtml(opts) {
    return `
      <div class="ops-card">
        <div class="ops-card-h">
          <div style="min-width:0;">
            <div class="ops-title">${esc(opts.title)}</div>
            <div class="ops-subtitle">${esc(opts.subtitle || "")}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">
            ${opts.rightHtml || ""}
          </div>
        </div>
        <div class="ops-body">${opts.bodyHtml || ""}</div>
      </div>
    `;
  }

  function getAppBaseUrl() {
    const domain = url.resolveDomain({ hostType: url.HostType.APPLICATION });
    return "https://" + domain;
  }

  function linkToScript(scriptInternalId) {
    return (
      getAppBaseUrl() +
      "/app/common/scripting/script.nl?id=" +
      encodeURIComponent(String(scriptInternalId))
    );
  }

  function linkToDeployment(deploymentId) {
    return (
      getAppBaseUrl() +
      "/app/common/scripting/scriptrecord.nl?id=" +
      encodeURIComponent(String(deploymentId))
    );
  }

  function toneFromRunStatus(statusText) {
    const s = String(statusText || "").toUpperCase();
    if (!s) return "idle";
    if (s.includes("FAIL") || s.includes("ERROR")) return "bad";
    if (
      s.includes("PENDING") ||
      s.includes("QUEUE") ||
      s.includes("RUN") ||
      s.includes("PROCESS")
    )
      return "warn";
    if (s.includes("COMPLETE") || s.includes("FINISH") || s.includes("SUCCESS"))
      return "ok";
    return "idle";
  }

  function tryFirstRowSearch(args) {
    const s = search.create({
      type: args.type,
      filters: args.filters,
      columns: args.columns,
    });
    return (s.run().getRange({ start: 0, end: 1 }) || [])[0] || null;
  }

  function findBestDeploymentForScript(scriptInternalId) {
    try {
      const s = search.create({
        type: "scriptdeployment",
        filters: [["script", "anyof", String(scriptInternalId)]],
        columns: [
          search.createColumn({ name: "internalid", sort: search.Sort.DESC }),
          search.createColumn({ name: "title" }),
          search.createColumn({ name: "scriptid" }),
          search.createColumn({ name: "isdeployed" }),
          search.createColumn({ name: "status" }),
        ],
      });

      const rows = s.run().getRange({ start: 0, end: 50 }) || [];
      if (!rows.length) return { ok: false, err: "No deployments found" };

      let chosen = rows[0];
      for (let i = 0; i < rows.length; i++) {
        const isDep =
          rows[i].getValue({ name: "isdeployed" }) === true ||
          rows[i].getValue({ name: "isdeployed" }) === "T";
        if (isDep) {
          chosen = rows[i];
          break;
        }
      }

      const deploymentId =
        Number(chosen.getValue({ name: "internalid" }) || 0) || null;
      const title = chosen.getValue({ name: "title" }) || "";
      const scriptId = chosen.getValue({ name: "scriptid" }) || "";
      const isDeployed =
        chosen.getValue({ name: "isdeployed" }) === true ||
        chosen.getValue({ name: "isdeployed" }) === "T";
      const statusText =
        chosen.getText({ name: "status" }) ||
        String(chosen.getValue({ name: "status" }) || "");

      return {
        ok: true,
        deploymentId,
        title,
        scriptId,
        isDeployed,
        statusText,
      };
    } catch (e) {
      return { ok: false, err: String(e.message || e) };
    }
  }

  function getLatestRunForScript(scriptInternalId, deploymentScriptId) {
    const targetScript = String(scriptInternalId);
    const targetDep = deploymentScriptId
      ? String(deploymentScriptId).toLowerCase()
      : null;

    const sources = ["mapreducescriptinstance", "scheduledscriptinstance"];

    const columnSets = [
      () => [
        search.createColumn({ name: "startdate", sort: search.Sort.DESC }),
        search.createColumn({ name: "enddate" }),
        search.createColumn({ name: "status" }),
        search.createColumn({ name: "percentcomplete" }),
        search.createColumn({ name: "internalid", join: "script" }),
        search.createColumn({ name: "scriptid", join: "scriptdeployment" }),
      ],
      () => [
        search.createColumn({ name: "startdate", sort: search.Sort.DESC }),
        search.createColumn({ name: "enddate" }),
        search.createColumn({ name: "status" }),
        search.createColumn({ name: "internalid", join: "script" }),
        search.createColumn({ name: "scriptid", join: "scriptdeployment" }),
      ],
      () => [
        search.createColumn({ name: "startdate", sort: search.Sort.DESC }),
        search.createColumn({ name: "enddate" }),
        search.createColumn({ name: "status" }),
        search.createColumn({ name: "internalid", join: "script" }),
      ],
    ];

    for (let sIdx = 0; sIdx < sources.length; sIdx++) {
      const type = sources[sIdx];

      for (let cIdx = 0; cIdx < columnSets.length; cIdx++) {
        try {
          const cols = columnSets[cIdx]();

          const s = search.create({
            type: type,
            filters: [],
            columns: cols,
          });

          const rows = s.run().getRange({ start: 0, end: 500 }) || [];
          if (!rows.length) return { ok: true, exists: false };

          let best = null;

          for (let i = 0; i < rows.length; i++) {
            const rowScriptId = rows[i].getValue({
              name: "internalid",
              join: "script",
            });
            if (String(rowScriptId) !== targetScript) continue;

            if (!best) best = rows[i];

            if (targetDep) {
              const rowDep =
                rows[i].getValue({
                  name: "scriptid",
                  join: "scriptdeployment",
                }) ||
                rows[i].getText({
                  name: "scriptid",
                  join: "scriptdeployment",
                }) ||
                "";
              if (String(rowDep).toLowerCase() === targetDep) {
                best = rows[i];
                break;
              }
            } else {
              break;
            }
          }

          if (!best) return { ok: true, exists: false };

          return {
            ok: true,
            exists: true,
            statusText:
              best.getText({ name: "status" }) ||
              String(best.getValue({ name: "status" }) || ""),
            startDate: best.getValue({ name: "startdate" }) || "",
            endDate: best.getValue({ name: "enddate" }) || "",
            percentComplete: best.getValue({ name: "percentcomplete" }) ?? null,
            sourceType: type,
          };
        } catch (e) {
          if (sIdx === sources.length - 1 && cIdx === columnSets.length - 1) {
            return { ok: false, err: String(e.message || e) };
          }
        }
      }
    }

    return { ok: false, err: "Unknown error" };
  }

  function getLatestIssueForScript(scriptInternalId) {
    try {
      const rErr = tryFirstRowSearch({
        type: "script",
        filters: [
          ["internalid", "anyof", String(scriptInternalId)],
          "AND",
          ["executionlog.type", "anyof", "ERROR"],
        ],
        columns: [
          search.createColumn({
            name: "date",
            join: "executionlog",
            sort: search.Sort.DESC,
          }),
          search.createColumn({ name: "type", join: "executionlog" }),
          search.createColumn({ name: "title", join: "executionlog" }),
          search.createColumn({ name: "detail", join: "executionlog" }),
        ],
      });

      if (rErr) {
        return {
          ok: true,
          hasIssue: true,
          kind: "ERROR",
          date: rErr.getValue({ name: "date", join: "executionlog" }) || "",
          type: rErr.getValue({ name: "type", join: "executionlog" }) || "",
          title: rErr.getValue({ name: "title", join: "executionlog" }) || "",
          detail: rErr.getValue({ name: "detail", join: "executionlog" }) || "",
        };
      }
    } catch (e) {}

    const patterns = [
      "error.SuiteScriptError",
      "SSS_",
      "INVALID_SEARCH_TYPE",
      "Invalid search type",
      "Search error occurred",
      "SuiteQL failed",
      "Exception",
      "failed",
    ];

    for (let i = 0; i < patterns.length; i++) {
      try {
        const r = tryFirstRowSearch({
          type: "script",
          filters: [
            ["internalid", "anyof", String(scriptInternalId)],
            "AND",
            ["executionlog.type", "anyof", "DEBUG", "AUDIT"],
            "AND",
            [
              ["executionlog.detail", "contains", patterns[i]],
              "OR",
              ["executionlog.title", "contains", patterns[i]],
            ],
          ],
          columns: [
            search.createColumn({
              name: "date",
              join: "executionlog",
              sort: search.Sort.DESC,
            }),
            search.createColumn({ name: "type", join: "executionlog" }),
            search.createColumn({ name: "title", join: "executionlog" }),
            search.createColumn({ name: "detail", join: "executionlog" }),
          ],
        });

        if (r) {
          return {
            ok: true,
            hasIssue: true,
            kind: "ISSUE",
            date: r.getValue({ name: "date", join: "executionlog" }) || "",
            type: r.getValue({ name: "type", join: "executionlog" }) || "",
            title: r.getValue({ name: "title", join: "executionlog" }) || "",
            detail: r.getValue({ name: "detail", join: "executionlog" }) || "",
          };
        }
      } catch (e) {}
    }

    return { ok: true, hasIssue: false };
  }

  function overallTone(dep, run, issue) {
    if (!dep.ok) return "bad";
    if (!dep.isDeployed) return "idle";
    if (issue && issue.ok && issue.hasIssue) return "warn";

    if (run) {
      if (run.ok === false) return "warn";
      if (!run.exists) return "idle";
      return toneFromRunStatus(run.statusText);
    }
    return "ok";
  }

  function render(context) {
    const form = serverWidget.createForm({
      title: "Ops Status Center (Read Only)",
    });
    const info = form.addField({
      id: "custpage_info",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    const now = new Date();
    let okCount = 0,
      warnCount = 0,
      badCount = 0,
      idleCount = 0;

    const cards = WATCH_SCRIPTS.map((w) => {
      const dep = findBestDeploymentForScript(w.scriptInternalId);
      const run = getLatestRunForScript(
        w.scriptInternalId,
        dep.ok ? dep.scriptId : null
      );
      const issue = getLatestIssueForScript(w.scriptInternalId);

      const tone = overallTone(dep, run, issue);
      if (tone === "ok") okCount++;
      else if (tone === "warn") warnCount++;
      else if (tone === "bad") badCount++;
      else idleCount++;

      const pills = [];
      pills.push(pill(`SCRIPT ID: ${w.scriptInternalId}`, "idle"));

      if (!dep.ok) {
        pills.push(pill("DEPLOYMENT: ERROR", "bad"));
      } else {
        pills.push(
          pill(
            dep.isDeployed ? "DEPLOYED = ON" : "DEPLOYED = OFF",
            dep.isDeployed ? "ok" : "idle"
          )
        );
        pills.push(
          pill(
            `DEPLOY STATUS: ${dep.statusText || "Unknown"}`,
            dep.isDeployed ? "ok" : "idle"
          )
        );
      }

      if (run) {
        if (run.ok === false)
          pills.push(pill("LATEST RUN: UNAVAILABLE", "warn"));
        else if (!run.exists) pills.push(pill("LATEST RUN: NONE", "idle"));
        else
          pills.push(
            pill(
              `LATEST RUN: ${run.statusText || "Unknown"}`,
              toneFromRunStatus(run.statusText)
            )
          );
      }

      if (issue) {
        if (issue.ok && issue.hasIssue)
          pills.push(
            pill(`EXEC LOG: ISSUE FOUND (${issue.type || "?"})`, "warn")
          );
        else if (issue.ok) pills.push(pill("EXEC LOG: NO ISSUES", "ok"));
        else pills.push(pill("EXEC LOG: UNAVAILABLE", "idle"));
      }

      const rightHtml = `
        <a class="ops-linkbtn" href="${esc(
          linkToScript(w.scriptInternalId)
        )}">Script</a>
        ${
          dep.ok && dep.deploymentId
            ? `<a class="ops-linkbtn" href="${esc(
                linkToDeployment(dep.deploymentId)
              )}">Deployment</a>`
            : ""
        }
      `;

      const depBlock = dep.ok
        ? `
          <div><b>Deployment</b>: <a href="${esc(
            linkToDeployment(dep.deploymentId)
          )}">#${esc(dep.deploymentId)}</a> ${
            dep.scriptId
              ? `— <code class="ops-code">${esc(dep.scriptId)}</code>`
              : ""
          }</div>
          <div style="margin-top:2px;color:#6b7280;">${esc(
            dep.title || ""
          )}</div>
        `
        : `<div class="ops-err"><b>Deployment lookup failed:</b> ${esc(
            dep.err || ""
          )}</div>`;

      const runBlock =
        run.ok === false
          ? `<div class="ops-warn" style="margin-top:10px;"><b>Latest Run:</b> unavailable (${esc(
              run.err || ""
            )})</div>`
          : !run.exists
          ? `<div style="margin-top:10px;color:#6b7280;"><b>Latest Run:</b> none found</div>`
          : `
            <div style="margin-top:10px;">
              <b>Latest Run</b>
              <div style="margin-top:6px;color:#374151;">
                <div>Status: <b>${esc(run.statusText || "")}</b></div>
                <div>Start: <b>${esc(
                  fmtDateWithOffset(run.startDate, TIME_OFFSET_HOURS)
                )}</b></div>
                <div>End: <b>${esc(
                  fmtDateWithOffset(run.endDate, TIME_OFFSET_HOURS)
                )}</b></div>
                ${
                  run.percentComplete !== null &&
                  run.percentComplete !== "" &&
                  run.percentComplete !== undefined
                    ? `<div>% Complete: <b>${esc(
                        String(run.percentComplete)
                      )}</b></div>`
                    : ""
                }
              </div>
            </div>
          `;

      const issueBlock = !issue
        ? ""
        : issue.ok === false
        ? `<div style="margin-top:10px;color:#6b7280;">Execution Log unavailable: ${esc(
            issue.err || ""
          )}</div>`
        : !issue.hasIssue
        ? `<div style="margin-top:10px;color:#6b7280;">No error-like entries in Execution Log for this script.</div>`
        : `
          <div class="ops-warn" style="margin-top:10px;">
            <b>Last Issue (Execution Log)</b>
            <div style="margin-top:6px;color:#6b7280;font-size:12px;">${esc(
              fmtDateWithOffset(issue.date, TIME_OFFSET_HOURS)
            )}</div>
            <div style="margin-top:6px;">
              <b>${esc(String(issue.title || "Issue"))}</b>
              ${
                issue.type
                  ? ` <span class="ops-code">${esc(String(issue.type))}</span>`
                  : ""
              }
            </div>
            <div style="margin-top:6px;white-space:pre-wrap;">${esc(
              String(issue.detail || "")
            ).slice(0, 900)}</div>
          </div>
        `;

      const bodyHtml = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${pills.join("")}
        </div>
        <div style="font-size:12px;color:#111827;line-height:1.35;">
          ${depBlock}
          ${runBlock}
          ${issueBlock}
        </div>
      `;

      return cardHtml({
        title: w.label,
        subtitle:
          "Read-only: deployment status + latest run (by script) + last issue from Execution Log",
        bodyHtml: bodyHtml,
        rightHtml: rightHtml,
      });
    }).join("");

    info.defaultValue = `
      <style>
        .ops-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding: 6px 2px 2px 2px;}
        .ops-header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin: 4px 0 12px 0;}
        .ops-h-title{font-size:16px;font-weight:900;color:#111827;margin:0;}
        .ops-h-sub{margin-top:4px;font-size:12px;color:#6b7280;max-width: 900px;}
        .ops-summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}
        .ops-grid{display:flex;flex-wrap:wrap;gap:12px;}
        .ops-card{flex: 1 1 520px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;padding:14px;box-shadow:0 10px 22px rgba(0,0,0,0.06);}
        .ops-card-h{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;}
        .ops-title{font-size:14px;font-weight:900;color:#111827;margin-bottom:2px;}
        .ops-subtitle{font-size:12px;color:#6b7280;}
        .ops-body{border-top:1px dashed #e5e7eb;padding-top:10px;}
        .ops-code{font-size:12px;background:#f6f8fa;border:1px solid #e5e7eb;padding:1px 6px;border-radius:8px;}
        .ops-linkbtn{
          display:inline-block;
          padding:8px 10px;
          border-radius:12px;
          border:1px solid #e5e7eb;
          background:#f9fafb;
          text-decoration:none;
          color:#111827;
          font-weight:800;
          font-size:12px;
        }
        .ops-linkbtn:hover{background:#f3f4f6;}
        .ops-warn{color:#664d03;background:#fff3cd;border:1px solid #ffecb5;padding:10px;border-radius:12px;}
        .ops-err{color:#842029;background:#f8d7da;border:1px solid #f5c2c7;padding:10px;border-radius:12px;}
      </style>

      <div class="ops-wrap">
        <div class="ops-header">
          <div>
            <div class="ops-h-title">Ops Status Center</div>
            <div class="ops-h-sub">
              Read-only dashboard.
              Latest Run scans instance records and matches by <b>script</b>.
              Execution Log shows true <b>ERROR</b> first, otherwise "error-like" <b>DEBUG/AUDIT</b>.
              <br/>Refreshed: <b>${esc(
                fmtDateWithOffset(now, TIME_OFFSET_HOURS)
              )}</b>
            </div>

            <div class="ops-summary">
              ${pill("OK: " + okCount, "ok")}
              ${pill("WARN: " + warnCount, "warn")}
              ${pill("BAD: " + badCount, "bad")}
              ${pill("IDLE: " + idleCount, "idle")}
            </div>
          </div>

          <div>
            <a class="ops-linkbtn" href="${esc(
              context.request.url
            )}">Refresh</a>
          </div>
        </div>

        <div class="ops-grid">
          ${cards}
        </div>
      </div>
    `;

    context.response.writePage(form);
  }

  function onRequest(context) {
    try {
      render(context);
    } catch (e) {
      log.error("Ops Status Center Error", e);
      const form = serverWidget.createForm({
        title: "Ops Status Center - Error",
      });
      const f = form.addField({
        id: "custpage_err",
        type: serverWidget.FieldType.INLINEHTML,
        label: " ",
      });
      f.defaultValue = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#842029;background:#f8d7da;border:1px solid #f5c2c7;padding:12px;border-radius:12px;">
        <b>Error:</b> ${esc(String(e.message || e))}
      </div>`;
      context.response.writePage(form);
    }
  }

  return { onRequest: onRequest };
});
