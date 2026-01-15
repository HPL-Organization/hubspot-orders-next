/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * Custom Record: HPL Soft BOM Component Line (customrecord_hpl_soft_bom_comp_line)
 * Field: Component Item = custrecord_hpl_soft_bom_comp_item
 * Target: Name field = name
 */
define([], function () {
  const FLD_COMPONENT_ITEM = "custrecord_hpl_soft_bom_comp_item";

  function fieldChanged(context) {
    if (context.fieldId !== FLD_COMPONENT_ITEM) return;

    const rec = context.currentRecord;

    const txt = rec.getText({ fieldId: FLD_COMPONENT_ITEM });
    const val = rec.getValue({ fieldId: FLD_COMPONENT_ITEM });

    const name =
      txt && String(txt).trim() ? String(txt).trim() : val ? String(val) : "";

    if (name) rec.setValue({ fieldId: "name", value: name });
  }

  return { fieldChanged };
});
