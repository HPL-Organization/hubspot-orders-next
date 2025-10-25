/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/task", "N/log"], (ui, task, log) => {
  const MR_SCRIPT_ID = "customscript2711";
  const MR_DEPLOYMENT_ID = "customdeploy1";

  function submitMr() {
    const t = task.create({
      taskType: task.TaskType.MAP_REDUCE,
      scriptId: MR_SCRIPT_ID,
      deploymentId: MR_DEPLOYMENT_ID,
    });
    return t.submit();
  }

  function onRequest(ctx) {
    if (ctx.request.method === "POST" || ctx.request.parameters.run === "1") {
      try {
        const taskId = submitMr();
        const form = ui.createForm({ title: "Submitted" });
        const f = form.addField({
          id: "msg",
          type: ui.FieldType.INLINEHTML,
          label: " ",
        });
        f.defaultValue = `<div style="padding:10px 0">
          Submitted Map/Reduce task: <b>${taskId}</b><br/>
          <a href="/app/common/scripting/scriptstatus.nl" target="_blank">Open Script Status</a>
        </div>`;
        form.addButton({
          id: "runagain",
          label: "Run Again",
          functionName: "",
        });
        ctx.response.writePage(form);
        return;
      } catch (e) {
        log.error("Submit failed", e);
        const form = ui.createForm({ title: "Error" });
        const f = form.addField({
          id: "err",
          type: ui.FieldType.INLINEHTML,
          label: " ",
        });
        f.defaultValue = `<div style="color:#b00">Failed to submit MR: ${
          e && e.message
        }</div>`;
        form.addButton({ id: "back", label: "Back", functionName: "" });
        ctx.response.writePage(form);
        return;
      }
    }

    const form = ui.createForm({ title: "Run Image Wipe Map/Reduce" });
    const info = form.addField({
      id: "info",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    });
    info.defaultValue = `<div style="padding:8px 0">
      Target MR: <b>${MR_SCRIPT_ID}</b> / <b>${MR_DEPLOYMENT_ID}</b>
    </div>`;
    form.addSubmitButton({ label: "Run Now" });
    ctx.response.writePage(form);
  }

  return { onRequest };
});
