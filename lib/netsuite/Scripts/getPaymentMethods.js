/**
 *@NApiVersion 2.x
 *@NScriptType Restlet
 */
define(["N/record", "N/runtime"], function (record, runtime) {
  function truthy(v) {
    return v === true || v === "true" || v === "T" || v === 1 || v === "1";
  }

  function post(request) {
    var customerId = Number(request.customerId);
    if (!customerId)
      return { success: false, message: "customerId is required" };

    var user = runtime.getCurrentUser();
    var userId = user && user.id;
    var roleId = user && user.role;

    if (roleId !== 3)
      return {
        success: false,
        message:
          "Not authorized only certain administartors can call this script",
        roleId: roleId,
        userId: userId,
      };

    var includeTokens =
      request.includeTokens === true || request.includeTokens === "true";

    var includeDefault =
      request.includeDefault === true || request.includeDefault === "true";

    var cust = record.load({
      type: record.Type.CUSTOMER,
      id: customerId,
      isDynamic: false,
    });

    var sublists = cust.getSublists();
    var sublistId = null;
    [
      "paymentinstruments",
      "paymentinstrument",
      "custentity_paymentinstruments",
    ].some(function (id) {
      if (sublists && sublists.indexOf(id) !== -1) {
        sublistId = id;
        return true;
      }
      return false;
    });
    if (!sublistId && sublists && sublists.length) {
      for (var i = 0; i < sublists.length; i++) {
        var id = sublists[i] || "";
        if (id.indexOf("payment") !== -1 && id.indexOf("instrument") !== -1) {
          sublistId = id;
          break;
        }
      }
    }
    if (!sublistId) {
      return {
        success: false,
        message: "Payment Instruments sublist not found on customer",
        sublists: sublists,
      };
    }

    var lineCount = cust.getLineCount({ sublistId: sublistId });
    if (!lineCount) return { success: true, count: 0, instruments: [] };

    var fields = cust.getSublistFields({ sublistId: sublistId }) || [];
    var idField = null;

    function tryFieldAsId(fieldId) {
      try {
        var v = cust.getSublistValue({
          sublistId: sublistId,
          fieldId: fieldId,
          line: 0,
        });
        if (v && String(v).match(/^\d+$/)) {
          try {
            record.load({ type: "paymentcardtoken", id: Number(v) });
            return true;
          } catch (e) {
            /* not the id */
          }
        }
      } catch (e2) {}
      return false;
    }

    var candidates = [
      "internalid",
      "id",
      "piinternalid",
      "paymentcardtoken",
      "instrumentid",
    ];
    for (var c = 0; c < candidates.length && !idField; c++) {
      if (fields.indexOf(candidates[c]) !== -1 && tryFieldAsId(candidates[c]))
        idField = candidates[c];
    }
    if (!idField) {
      for (var i = 0; i < fields.length && !idField; i++) {
        var f = fields[i];
        if (/id$/i.test(f) || /internal/i.test(f)) {
          if (tryFieldAsId(f)) idField = f;
        }
      }
    }
    if (!idField) {
      return {
        success: false,
        message: "Could not determine instrument id field",
        sublistId: sublistId,
        fields: fields,
      };
    }

    var instruments = [];
    var defaultInstrumentId = null;

    for (var line = 0; line < lineCount; line++) {
      var instrId = cust.getSublistValue({
        sublistId: sublistId,
        fieldId: idField,
        line: line,
      });
      if (!instrId) continue;

      try {
        var rec = record.load({
          type: "paymentcardtoken",
          id: Number(instrId),
        });

        var item = {
          id: String(instrId),
          paymentMethod: rec.getText({ fieldId: "paymentmethod" }) || null,
          brand:
            rec.getText({ fieldId: "cardbrand" }) ||
            rec.getValue({ fieldId: "cardbrand" }) ||
            null,
          last4: rec.getValue({ fieldId: "cardlastfourdigits" }) || null,
          expiry: rec.getValue({ fieldId: "tokenexpirationdate" }) || null,
          tokenFamily:
            rec.getText({ fieldId: "tokenfamily" }) ||
            rec.getValue({ fieldId: "tokenfamily" }) ||
            null,
          tokenNamespace: rec.getValue({ fieldId: "tokennamespace" }) || null,
        };

        if (includeDefault) {
          var defVal = false;
          try {
            defVal = truthy(rec.getValue({ fieldId: "isdefault" }));
          } catch (eD) {}
          item.isDefault = !!defVal;
          if (defVal && !defaultInstrumentId)
            defaultInstrumentId = String(instrId);
        }

        if (includeTokens) {
          item.token = rec.getValue({ fieldId: "token" }) || null; // sensitive
        }

        instruments.push(item);
      } catch (e3) {
        var errItem = {
          id: String(instrId),
          loadError: String((e3 && e3.message) || e3),
        };
        if (includeDefault) errItem.isDefault = false;
        instruments.push(errItem);
      }
    }

    var resp = {
      success: true,
      count: instruments.length,
      instruments: instruments,
      sublistId: sublistId,
      idField: idField,
    };

    if (includeDefault) {
      resp.defaultInstrumentId = defaultInstrumentId;
    }

    return resp;
  }

  return { post: post };
});
