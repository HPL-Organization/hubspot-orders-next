/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/log"], (log) => {
  const US_ALIASES = new Set([
    "US",
    "USA",
    "UNITED STATES",
    "UNITED STATES OF AMERICA",
  ]);

  const norm = (v) =>
    String(v || "")
      .trim()
      .toUpperCase();

  function getShipCountry(rec) {
    let c = norm(rec.getValue({ fieldId: "shipcountry" }));
    if (c) return c;

    try {
      const sub = rec.getSubrecord({ fieldId: "shippingaddress" });
      const sc = norm(sub && sub.getValue({ fieldId: "country" }));
      if (sc) return sc;
    } catch (e) {
      /* ignore if not present */
    }

    return "";
  }

  function beforeSubmit(ctx) {
    if (ctx.type !== ctx.UserEventType.CREATE) return;

    const rec = ctx.newRecord;
    const shipCountry = getShipCountry(rec);
    const isInternational = shipCountry && !US_ALIASES.has(shipCountry);

    if (isInternational) {
      rec.setValue({ fieldId: "shipcomplete", value: true });
      log.debug("Ship Complete enabled (international shipping)", {
        shipCountry,
      });
    } else {
      log.debug("Domestic shipping; Ship Complete unchanged", { shipCountry });
    }
  }

  return { beforeSubmit };
});
