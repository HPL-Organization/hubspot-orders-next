/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record"], function (record) {
  function beforeSubmit(context) {
    var inv = context.newRecord;
    if (!inv) return;

    var createdFrom = inv.getValue({ fieldId: "createdfrom" });
    if (!createdFrom) return;

    var hide = false;

    try {
      var so = record.load({
        type: record.Type.SALES_ORDER,
        id: createdFrom,
        isDynamic: false,
      });

      var v = so.getValue({ fieldId: "custbodycustbody_hide_tax_total" });
      hide = v === true || v === "T";
    } catch (e) {
      return;
    }

    inv.setValue({
      fieldId: "custbodycustbody_hide_tax_total",
      value: hide,
    });
  }

  return { beforeSubmit: beforeSubmit };
});
