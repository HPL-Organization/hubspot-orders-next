/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/url", "N/ui/serverWidget"], (url, ui) => {
  function beforeLoad(ctx) {
    if (
      ![
        ctx.UserEventType.VIEW,
        ctx.UserEventType.EDIT,
        ctx.UserEventType.COPY,
      ].includes(ctx.type)
    )
      return;

    const slScriptId = "2653";
    const slDeployId = "1";

    let slUrl = "#";
    try {
      slUrl = url.resolveScript({
        scriptId: slScriptId,
        deploymentId: slDeployId,
        params: { so: ctx.newRecord.id },
      });
    } catch (e) {}

    ctx.form.addButton({
      id: "custpage_unwind_related",
      label:
        "(Testing don't click) Remove Related (Payments / Deposits / Invoice)",
      functionName: "unwindRelated",
    });

    const inline = ctx.form.addField({
      id: "custpage_unwind_js",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    });
    inline.defaultValue = `
      <script>
        function unwindRelated(){ window.location.href = ${JSON.stringify(
          slUrl
        )}; }
      </script>`;
  }

  return { beforeLoad };
});
