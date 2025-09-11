/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/search", "N/log"], (record, search, log) => {
  const TARGET_FIELD = "custbody_hpl_customer_phone";

  function beforeSubmit(ctx) {
    try {
      const rec = ctx.newRecord;
      if (rec.type !== record.Type.ITEM_FULFILLMENT) return;

      const customerId = rec.getValue("entity");
      if (!customerId) {
        log.debug("No customer on IF, skipping", { ifId: rec.id });
        return;
      }

      const cust = search.lookupFields({
        type: search.Type.CUSTOMER,
        id: customerId,
        columns: ["mobilephone", "phone"],
      });
      const mobile = (cust.mobilephone || "").trim();
      const main = (cust.phone || "").trim();

      const finalVal = mobile || main;

      rec.setValue({ fieldId: TARGET_FIELD, value: finalVal || "" });

      log.debug("Set IF customer phone", {
        ifId: rec.id,
        customerId,
        mobile,
        main,
        final: finalVal,
      });
    } catch (e) {
      log.error("IF customer phone UE error", e);
    }
  }

  return { beforeSubmit };
});
