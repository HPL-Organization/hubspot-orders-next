/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(["N/record", "N/log"], (record, log) => {
  function execute() {
    try {
      const so = record.load({
        type: "salesorder",
        id: 874139,
        isDynamic: false,
      });

      log.audit({
        title: "Sales Order loaded successfully",
        details: {
          id: so.id,
          tranid: so.getValue({ fieldId: "tranid" }),
          trandate: so.getValue({ fieldId: "trandate" }),
          customform: so.getValue({ fieldId: "customform" }),
          lineCount: so.getLineCount({ sublistId: "item" }),
        },
      });
    } catch (e) {
      log.error({
        title: "Failed to load Sales Order 874139",
        details: {
          name: e.name,
          message: e.message,
          stack: e.stack,
        },
      });
    }
  }

  return { execute };
});
