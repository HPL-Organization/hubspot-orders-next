/**
 *@NApiVersion 2.x
 *@NScriptType Restlet
 */
define(["N/record", "N/search", "N/error", "N/log"], function (
  record,
  search,
  error,
  log
) {
  var DEFAULT_FIELD_ID = "isdefault";

  function asNum(n) {
    var x = Number(n);
    return isFinite(x) && x > 0 ? x : 0;
  }
  function redactId(id) {
    var s = String(id || "");
    return s.length <= 4 ? "***" + s : "***" + s.slice(-4);
  }

  function post(request) {
    var customerId = asNum(request && request.customerId);
    var instrumentId = asNum(request && request.instrumentId);

    try {
      log.audit("make-default: request", {
        customerId: customerId || "(missing)",
        instrumentId: redactId(instrumentId),
      });
    } catch (e0) {}

    if (!customerId || !instrumentId) {
      return {
        success: false,
        message: "customerId and instrumentId are required",
      };
    }

    var rec;
    try {
      rec = record.load({ type: "paymentcardtoken", id: instrumentId });
    } catch (e) {
      return {
        success: false,
        message: "Instrument not found",
        error: e && e.message,
      };
    }

    var ownerId = 0;
    try {
      ownerId = Number(rec.getValue({ fieldId: "entity" })) || 0;
    } catch (e) {}
    if (!ownerId || ownerId !== customerId) {
      return {
        success: false,
        message: "Instrument does not belong to provided customer",
        foundOwnerId: ownerId,
        expectedCustomerId: customerId,
      };
    }

    try {
      var s = search.create({
        type: "paymentcardtoken",
        filters: [
          ["entity", "anyof", String(customerId)],
          "AND",
          ["internalid", "noneof", String(instrumentId)],
        ],
        columns: ["internalid", DEFAULT_FIELD_ID],
      });
      s.run().each(function (r) {
        var otherId = r.getValue({ name: "internalid" });
        try {
          record.submitFields({
            type: "paymentcardtoken",
            id: otherId,
            values: (function () {
              var v = {};
              v[DEFAULT_FIELD_ID] = false;
              return v;
            })(),
          });
        } catch (eUnset) {
          log.debug("unset default failed (ignored)", {
            otherId: otherId,
            reason: eUnset && eUnset.message,
          });
        }
        return true;
      });
    } catch (eS) {
      log.debug("search/unset step failed (continuing)", eS && eS.message);
    }

    try {
      var values = {};
      values[DEFAULT_FIELD_ID] = true;
      values["isinactive"] = false;
      record.submitFields({
        type: "paymentcardtoken",
        id: instrumentId,
        values: values,
      });

      log.audit("payment instrument made default", {
        instrumentId: instrumentId,
        customerId: customerId,
      });
      return {
        success: true,
        action: "made-default",
        instrumentId: instrumentId,
        customerId: customerId,
      };
    } catch (e3) {
      return {
        success: false,
        message: "Failed to set default",
        error: e3 && e3.message,
      };
    }
  }

  return { post: post };
});
