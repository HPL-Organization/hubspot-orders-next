/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/task", "N/search", "N/log"], (
  ui,
  task,
  search,
  log
) => {
  const MR_SCRIPT_ID = "customscript2718";
  const MR_DEPLOY_ID = "customdeploy1";

  function getScriptInternalIdByScriptId(scriptId) {
    const r = search
      .create({
        type: "script",
        filters: [["scriptid", "is", scriptId]],
        columns: ["internalid"],
      })
      .run()
      .getRange({ start: 0, end: 1 });
    if (!r || !r.length) throw new Error("Script not found: " + scriptId);
    return String(r[0].getValue("internalid"));
  }

  function fetchInstances(limit = 50) {
    return (
      search
        .create({
          type: "scheduledscriptinstance",
          columns: [
            search.createColumn({
              name: "datecreated",
              sort: search.Sort.DESC,
            }),
            "status",
            "taskid",
            "script",
            "scriptid",
          ],
        })
        .run()
        .getRange({ start: 0, end: limit }) || []
    );
  }

  function listRecentInstances(scriptIntId, limit = 10) {
    const rows = fetchInstances(Math.max(limit, 50));
    const lines = [];
    for (const r of rows) {
      const sid = String(r.getValue("scriptid") || "");
      if (sid === scriptIntId) {
        lines.push(
          `${r.getValue("datecreated")} — ${r.getText("status")} — ${r.getValue(
            "taskid"
          )}`
        );
        if (lines.length >= limit) break;
      }
    }
    return lines;
  }

  function cancelUnfinished(scriptIntId) {
    const rows = fetchInstances(200);
    const out = [];
    for (const r of rows) {
      const sid = String(r.getValue("scriptid") || "");
      const st = r.getText("status") || "";
      if (sid === scriptIntId && /pending|processing|restart|retry/i.test(st)) {
        const taskId = r.getValue("taskid");
        try {
          task.cancelTask({ taskId });
          out.push(`Canceled ${taskId} (${st})`);
        } catch (e) {
          out.push(`Failed ${taskId}: ${e.message}`);
        }
      }
    }
    return out;
  }

  function submitMr() {
    const t = task.create({
      taskType: task.TaskType.MAP_REDUCE,
      scriptId: MR_SCRIPT_ID,
      deploymentId: MR_DEPLOY_ID,
    });
    return t.submit();
  }

  function addControls(form) {
    const hidden = form.addField({
      id: "sl_action",
      type: ui.FieldType.TEXT,
      label: "action",
    });
    hidden.updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN });
    form.addField({
      id: "cs",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `<script>
         function runNow(){ document.getElementById('sl_action').value='run'; document.forms[0].submit(); }
         function stopNow(){ document.getElementById('sl_action').value='cancel'; document.forms[0].submit(); }
       </script>`;
    form.addButton({ id: "run_btn", label: "Run Now", functionName: "runNow" });
    form.addButton({
      id: "stop_btn",
      label: "Stop Running",
      functionName: "stopNow",
    });
  }

  function onRequest(ctx) {
    let scriptIntId;
    try {
      scriptIntId = getScriptInternalIdByScriptId(MR_SCRIPT_ID);
    } catch (e) {
      const err = ui.createForm({ title: "Image Mapper Runner" });
      err.addField({
        id: "err",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue = `<div style="color:#b00">Error: ${e.message}</div>`;
      ctx.response.writePage(err);
      return;
    }

    if (ctx.request.method === "POST") {
      const action = (ctx.request.parameters.sl_action || "").toLowerCase();
      let msgHtml = "";
      try {
        if (action === "cancel") {
          const lines = cancelUnfinished(scriptIntId);
          msgHtml = `<div><b>Cancel results</b><br>${
            lines.length ? lines.join("<br>") : "No unfinished instances"
          }</div>`;
        } else {
          const taskId = submitMr();
          msgHtml = `<div>Submitted Map/Reduce task: <b>${taskId}</b> — <a href="/app/common/scripting/scriptstatus.nl" target="_blank">Script Status</a></div>`;
        }
      } catch (e) {
        log.error("Runner error", e);
        msgHtml = `<div style="color:#b00">Error: ${e.message}</div>`;
      }
      const form = ui.createForm({ title: "Image Mapper Runner" });
      form.addField({
        id: "result",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue = msgHtml + "<hr>";
      form.addField({
        id: "recent",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue = `<div><b>Recent instances</b><br>${
        listRecentInstances(scriptIntId, 10).join("<br>") || "None"
      }</div>`;
      addControls(form);
      ctx.response.writePage(form);
      return;
    }

    const form = ui.createForm({ title: "Image Mapper Runner" });
    form.addField({
      id: "info",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `<div>Target MR: <b>${MR_SCRIPT_ID}</b> / <b>${MR_DEPLOY_ID}</b></div><hr>`;
    form.addField({
      id: "recent",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `<div><b>Recent instances</b><br>${
      listRecentInstances(scriptIntId, 10).join("<br>") || "None"
    }</div>`;
    addControls(form);
    ctx.response.writePage(form);
  }

  return { onRequest };
});
