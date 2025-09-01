/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/log"], (log) => {
  const ITEM_SUBLIST = "item";
  const LINE_FLAG = "custcol_hpl_itempaid";
  const HEADER_FLAG = "custbody_hpl_paidreleased";

  function beforeSubmit(ctx) {
    try {
      if (ctx.type === ctx.UserEventType.DELETE) return;

      const so = ctx.newRecord;
      const lineCount = so.getLineCount({ sublistId: ITEM_SUBLIST }) || 0;

      let anyPaid = false;
      for (let i = 0; i < lineCount; i++) {
        const v = so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: LINE_FLAG,
          line: i,
        });
        if (v === true || v === "T") {
          anyPaid = true;
          break;
        }
      }

      const currentHeader = !!so.getValue({ fieldId: HEADER_FLAG });
      if (currentHeader !== anyPaid) {
        so.setValue({ fieldId: HEADER_FLAG, value: anyPaid });
        log.debug("paidReleased updated", { anyPaid, lineCount });
      } else {
        log.debug("paidReleased unchanged", { anyPaid, lineCount });
      }
    } catch (e) {
      log.error("SO beforeSubmit error", e);
    }
  }

  return { beforeSubmit };
});
