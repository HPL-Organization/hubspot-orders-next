/**
 *@NApiVersion 2.x
 *@NScriptType Restlet
 */
define(["N/record", "N/format"], function (record, format) {
  function post(request) {
    var customerId = Number(request.customerId);
    var paymentMethodId = Number(request.paymentMethodId);
    var token = request.token;

    if (!customerId || !paymentMethodId || !token) {
      return {
        success: false,
        message: "customerId, paymentMethodId, and token are required",
      };
    }

    var tokenExpirationDate = request.tokenExpirationDate; // "YYYY-MM-DD" or "MM/YYYY"
    var tokenFamilyLabel = request.tokenFamilyLabel;
    var tokenNamespace = request.tokenNamespace;
    var issuerIdentificationNumber = request.issuerIdentificationNumber;

    var rec = record.create({ type: "paymentcardtoken", isDynamic: true });
    if (tokenFamilyLabel)
      rec.setText({ fieldId: "tokenfamily", text: tokenFamilyLabel });

    rec.setValue({ fieldId: "entity", value: customerId });
    rec.setValue({ fieldId: "paymentmethod", value: paymentMethodId });
    rec.setValue({ fieldId: "token", value: token });

    if (request.cardNameOnCard) {
      rec.setValue({
        fieldId: "cardnameoncard",
        value: String(request.cardNameOnCard).trim(),
      });
    }

    if (request.accountNumberLastFour) {
      var last4 = String(request.accountNumberLastFour)
        .replace(/\D/g, "")
        .slice(-4);
      if (last4 && last4.length === 4) {
        rec.setValue({ fieldId: "cardlastfourdigits", value: last4 });
      }
    }

    var brandInput = request.cardBrand || request.accountType;
    var brand = normalizeBrand(brandInput);
    if (brand) {
      try {
        rec.setText({ fieldId: "cardbrand", text: brand });
      } catch (e1) {
        try {
          rec.setValue({ fieldId: "cardbrand", value: brand });
        } catch (e2) {}
      }
    }

    if (tokenExpirationDate) {
      var d;
      if (/^\d{1,2}[/-]\d{4}$/.test(tokenExpirationDate)) {
        var p = tokenExpirationDate.split(/[/-]/);
        var mm = parseInt(p[0], 10) - 1,
          yyyy = parseInt(p[1], 10);
        d = new Date(yyyy, mm + 1, 0);
      } else {
        d = new Date(tokenExpirationDate);
      }
      if (!isNaN(d.getTime())) {
        var text = format.format({ value: d, type: format.Type.DATE });
        var nsDate = format.parse({ value: text, type: format.Type.DATE });
        rec.setValue({ fieldId: "tokenexpirationdate", value: nsDate });
      }
    }

    if (tokenNamespace)
      rec.setValue({ fieldId: "tokennamespace", value: tokenNamespace });
    if (issuerIdentificationNumber) {
      rec.setValue({
        fieldId: "issueridentificationnumber",
        value: issuerIdentificationNumber,
      });
    }

    var id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return { success: true, paymentCardTokenId: id };
  }
  function normalizeBrand(input) {
    if (!input) return null;
    var s = String(input).trim().toLowerCase();
    if (!s) return null;
    if (s.indexOf("visa") === 0) return "VISA";
    if (s.indexOf("master") === 0 || s === "mc") return "MASTERCARD";
    if (s.indexOf("amex") === 0 || s.indexOf("american express") === 0)
      return "AMEX";
    if (s.indexOf("discover") === 0) return "DISCOVER";
    if (s.indexOf("diners") === 0) return "DINERS_CLUB";
    if (s.indexOf("jcb") === 0) return "JCB";
    if (s.indexOf("maestro") === 0) return "MAESTRO";
    if (s.indexOf("cirrus") === 0) return "CIRRUS";
    return null; // unknown → skip
  }

  return { post: post };
});
