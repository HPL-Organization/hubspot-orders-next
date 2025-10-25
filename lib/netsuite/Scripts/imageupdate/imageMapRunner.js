/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/task", "N/log"], (ui, task, log) => {
  const MR_SCRIPT_ID = "customscript2714";
  const MR_DEPLOY_ID = "customdeploy1";

  function onRequest(ctx) {
    if (ctx.request.method === "POST") {
      try {
        const t = task.create({
          taskType: task.TaskType.MAP_REDUCE,
          scriptId: MR_SCRIPT_ID,
          deploymentId: MR_DEPLOY_ID,
        });
        const taskId = t.submit();
        const form = ui.createForm({ title: "Submitted" });
        form.addField({
          id: "msg",
          type: ui.FieldType.INLINEHTML,
          label: " ",
        }).defaultValue = `<div>Submitted Map/Reduce task: <b>${taskId}</b> — <a href="/app/common/scripting/scriptstatus.nl" target="_blank">Script Status</a></div>`;
        form.addSubmitButton({ label: "Run Again" });
        ctx.response.writePage(form);
        return;
      } catch (e) {
        const form = ui.createForm({ title: "Error" });
        form.addField({
          id: "err",
          type: ui.FieldType.INLINEHTML,
          label: " ",
        }).defaultValue = `<div style="color:#b00">Failed to submit MR: ${e.message}</div>`;
        form.addSubmitButton({ label: "Try Again" });
        ctx.response.writePage(form);
        return;
      }
    }

    const form = ui.createForm({ title: "Upload Item Images (SKU-slot)" });
    form.addField({
      id: "info",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `<div>This will map files named <code>SKU-#.(jpg|png|gif)</code> to item image fields by slot.</div>`;
    form.addSubmitButton({ label: "Run Now" });
    ctx.response.writePage(form);
  }

  return { onRequest };
});
