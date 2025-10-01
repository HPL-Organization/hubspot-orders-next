/**
 *@NApiVersion 2.x
 *@NScriptType Restlet
 */
define(["N/record", "N/error", "N/log"], function (record, error, log) {
  function safeStr(v, max) {
    if (typeof max !== "number") max = 80;
    try {
      var s = String(v == null ? "" : v);
      return s.length > max ? s.slice(0, max) + "..." : s;
    } catch (e) {
      return "";
    }
  }

  function redactId(id) {
    if (!id && id !== 0) return "(none)";
    var s = String(id);
    if (s.length <= 4) return "***" + s;
    return "***" + s.slice(-4);
  }

  function asNumber(n) {
    var x = Number(n);
    return isFinite(x) && x > 0 ? x : 0;
  }

  function getOwnerId(rec) {
    var f = ["entity", "customer"];
    for (var i = 0; i < f.length; i++) {
      try {
        var v = rec.getValue({ fieldId: f[i] });
        if (v) return Number(v);
      } catch (e) {}
    }
    return 0;
  }

  function tryLoad(type, id) {
    try {
      return record.load({ type: type, id: id });
    } catch (e) {
      return null;
    }
  }

  function detectType(id) {
    var CANDIDATES = ["paymentcardtoken", "paymentcard", "generaltoken"];
    for (var i = 0; i < CANDIDATES.length; i++) {
      var t = CANDIDATES[i];
      var r = tryLoad(t, id);
      if (r) return { type: t, rec: r };
    }
    return { type: null, rec: null };
  }

  function canSoftDeleteMsg(msg) {
    if (!msg) return false;
    var s = String(msg).toLowerCase();
    return (
      s.indexOf("default") >= 0 ||
      s.indexOf("in use") >= 0 ||
      s.indexOf("referenc") >= 0 ||
      s.indexOf("cannot delete") >= 0
    );
  }

  function softDelete(type, id) {
    try {
      record.submitFields({
        type: type,
        id: id,
        values: { isinactive: true },
      });
      return { ok: true, action: "inactivated" };
    } catch (e) {
      return { ok: false, err: e };
    }
  }

  function handleDelete(request) {
    var instrumentId = asNumber(request && request.instrumentId);
    var customerId = asNumber(request && request.customerId);
    var explicitType =
      request && request.type ? String(request.type).toLowerCase().trim() : "";

    try {
      log.audit(
        "delete PI: request",
        JSON.stringify({
          instrumentId: redactId(instrumentId),
          customerId: customerId || "(none)",
          type: explicitType || "(auto)",
        })
      );
    } catch (e0) {}

    if (!instrumentId || !customerId) {
      return {
        success: false,
        message: "instrumentId and customerId are required",
      };
    }

    var rec, type;
    if (explicitType) {
      rec = tryLoad(explicitType, instrumentId);
      type = explicitType;
      if (!rec) {
        var d = detectType(instrumentId);
        rec = d.rec;
        type = d.type;
      }
    } else {
      var d2 = detectType(instrumentId);
      rec = d2.rec;
      type = d2.type;
    }

    if (!rec || !type) {
      return {
        success: false,
        message: "Instrument not found or unsupported type",
        instrumentId: instrumentId,
      };
    }

    var ownerId = getOwnerId(rec);
    if (ownerId && ownerId !== customerId) {
      return {
        success: false,
        message: "Instrument does not belong to provided customer",
        instrumentId: instrumentId,
        foundOwnerId: ownerId,
        expectedCustomerId: customerId,
        type: type,
      };
    }

    try {
      record.delete({ type: type, id: instrumentId });
      log.audit("Payment instrument deleted", { type: type, id: instrumentId });
      return {
        success: true,
        action: "deleted",
        type: type,
        instrumentId: instrumentId,
        customerId: customerId,
      };
    } catch (e) {
      var msg = (e && e.message) || String(e);
      log.debug("Hard delete failed, evaluating soft delete", {
        type: type,
        id: instrumentId,
        reason: safeStr(msg, 120),
      });

      if (canSoftDeleteMsg(msg)) {
        var sd = softDelete(type, instrumentId);
        if (sd.ok) {
          log.audit("Payment instrument inactivated (soft delete)", {
            type: type,
            id: instrumentId,
          });
          return {
            success: true,
            action: "inactivated",
            reason: safeStr(msg, 120),
            type: type,
            instrumentId: instrumentId,
            customerId: customerId,
          };
        }
        return {
          success: false,
          message: "Unable to delete or inactivate instrument",
          type: type,
          instrumentId: instrumentId,
          customerId: customerId,
          error: safeStr(sd.err && sd.err.message, 160),
        };
      }

      return {
        success: false,
        message: "Delete failed",
        type: type,
        instrumentId: instrumentId,
        customerId: customerId,
        error: safeStr(msg, 160),
      };
    }
  }

  return {
    post: handleDelete,
    delete: handleDelete,
  };
});
