/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/runtime", "N/log"], function (runtime, log) {
  function afterSubmit(context) {
    try {
      if (context.type !== context.UserEventType.CREATE) return;

      var rec = context.newRecord;
      var applyCount = rec.getLineCount({ sublistId: "apply" });
      var appliedLines = [];

      for (var i = 0; i < applyCount; i++) {
        var isApplied = rec.getSublistValue({
          sublistId: "apply",
          fieldId: "apply",
          line: i,
        });

        if (!isApplied) continue;

        appliedLines.push({
          line: i,
          doc: rec.getSublistValue({
            sublistId: "apply",
            fieldId: "doc",
            line: i,
          }),
          refnum: rec.getSublistValue({
            sublistId: "apply",
            fieldId: "refnum",
            line: i,
          }),
          internalid: rec.getSublistValue({
            sublistId: "apply",
            fieldId: "internalid",
            line: i,
          }),
          amount: rec.getSublistValue({
            sublistId: "apply",
            fieldId: "amount",
            line: i,
          }),
        });
      }

      log.emergency("DEPOSIT APPLICATION CREATED", {
        depositApplicationId: rec.id,
        executionContext: runtime.executionContext,
        scriptId: runtime.getCurrentScript().id,
        deploymentId: runtime.getCurrentScript().deploymentId,
        entity: rec.getValue({ fieldId: "entity" }),
        aracct: rec.getValue({ fieldId: "aracct" }),
        payment: rec.getValue({ fieldId: "payment" }),
        applied: rec.getValue({ fieldId: "applied" }),
        autoapply: rec.getValue({ fieldId: "autoapply" }),
        createdfrom: rec.getValue({ fieldId: "createdfrom" }),
        appliedLines: appliedLines,
      });
    } catch (e) {
      log.error("Deposit application logger failed", {
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
    }
  }

  return {
    afterSubmit: afterSubmit,
  };
});
