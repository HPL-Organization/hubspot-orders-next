/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/https", "N/log"], (https, log) => {
  const WEBHOOK_URL =
    "https://customer-portal-bina.onrender.com/api/hooks/netsuite/new-netsuite-customer-upsert";
  const WEBHOOK_SECRET =
    "4736225f8f8f34c2399cd6a27c6068c13fdc6e4fad20907a5216bb02b948eefd";

  function afterSubmit(ctx) {
    if (ctx.type !== ctx.UserEventType.CREATE) return;

    const rec = ctx.newRecord;
    const email = rec.getValue({ fieldId: "email" });
    if (!email) return;

    const payload = JSON.stringify({
      email: String(email).toLowerCase(),
      netsuite_customer_id: Number(rec.id),
    });

    try {
      const resp = https.post({
        url: WEBHOOK_URL,
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": WEBHOOK_SECRET,
        },
        body: payload,
      });

      if (resp.code >= 300) {
        log.error(
          "customer-upsert webhook failed",
          "HTTP " + resp.code + ": " + resp.body
        );
      }
    } catch (e) {
      log.error(
        "customer-upsert webhook exception",
        e && e.message ? e.message : String(e)
      );
    }
  }

  return { afterSubmit };
});
