// /**
//  *@NApiVersion 2.x
//  *@NScriptType Restlet
//  */
// define(["N/record", "N/format"], function (record, format) {
//   function post(request) {
//     var customerId = Number(request.customerId);
//     var paymentMethodId = Number(request.paymentMethodId);
//     var token = request.token;

//     if (!customerId || !paymentMethodId || !token) {
//       return {
//         success: false,
//         message: "customerId, paymentMethodId, and token are required",
//       };
//     }

//     var tokenExpirationDate = request.tokenExpirationDate; // "YYYY-MM-DD" or "MM/YYYY"
//     var tokenFamilyLabel = request.tokenFamilyLabel;
//     var tokenNamespace = request.tokenNamespace;
//     var issuerIdentificationNumber = request.issuerIdentificationNumber;

//     var rec = record.create({ type: "paymentcardtoken", isDynamic: true });
//     if (tokenFamilyLabel)
//       rec.setText({ fieldId: "tokenfamily", text: tokenFamilyLabel });

//     rec.setValue({ fieldId: "entity", value: customerId });
//     rec.setValue({ fieldId: "paymentmethod", value: paymentMethodId });
//     rec.setValue({ fieldId: "token", value: token });

//     if (request.cardNameOnCard) {
//       rec.setValue({
//         fieldId: "cardnameoncard",
//         value: String(request.cardNameOnCard).trim(),
//       });
//     }

//     if (request.accountNumberLastFour) {
//       var last4 = String(request.accountNumberLastFour)
//         .replace(/\D/g, "")
//         .slice(-4);
//       if (last4 && last4.length === 4) {
//         rec.setValue({ fieldId: "cardlastfourdigits", value: last4 });
//       }
//     }

//     var brandInput = request.cardBrand || request.accountType;
//     var brand = normalizeBrand(brandInput);
//     if (brand) {
//       try {
//         rec.setText({ fieldId: "cardbrand", text: brand });
//       } catch (e1) {
//         try {
//           rec.setValue({ fieldId: "cardbrand", value: brand });
//         } catch (e2) {}
//       }
//     }

//     if (tokenExpirationDate) {
//       var d;
//       if (/^\d{1,2}[/-]\d{4}$/.test(tokenExpirationDate)) {
//         var p = tokenExpirationDate.split(/[/-]/);
//         var mm = parseInt(p[0], 10) - 1,
//           yyyy = parseInt(p[1], 10);
//         d = new Date(yyyy, mm + 1, 0);
//       } else {
//         d = new Date(tokenExpirationDate);
//       }
//       if (!isNaN(d.getTime())) {
//         var text = format.format({ value: d, type: format.Type.DATE });
//         var nsDate = format.parse({ value: text, type: format.Type.DATE });
//         rec.setValue({ fieldId: "tokenexpirationdate", value: nsDate });
//       }
//     }

//     if (tokenNamespace)
//       rec.setValue({ fieldId: "tokennamespace", value: tokenNamespace });
//     if (issuerIdentificationNumber) {
//       rec.setValue({
//         fieldId: "issueridentificationnumber",
//         value: issuerIdentificationNumber,
//       });
//     }

//     var id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
//     return { success: true, paymentCardTokenId: id };
//   }
//   function normalizeBrand(input) {
//     if (!input) return null;
//     var s = String(input).trim().toLowerCase();
//     if (!s) return null;
//     if (s.indexOf("visa") === 0) return "VISA";
//     if (s.indexOf("master") === 0 || s === "mc") return "MASTERCARD";
//     if (s.indexOf("amex") === 0 || s.indexOf("american express") === 0)
//       return "AMEX";
//     if (s.indexOf("discover") === 0) return "DISCOVER";
//     if (s.indexOf("diners") === 0) return "DINERS_CLUB";
//     if (s.indexOf("jcb") === 0) return "JCB";
//     if (s.indexOf("maestro") === 0) return "MAESTRO";
//     if (s.indexOf("cirrus") === 0) return "CIRRUS";
//     return null; // unknown → skip
//   }

//   return { post: post };
// });

/**
 *@NApiVersion 2.x
 *@NScriptType Restlet
 */
define(["N/record", "N/format", "N/log"], function (record, format, log) {
  // --- helpers (ES5-safe) ---
  function safeStr(v, max) {
    if (typeof max !== "number") max = 80;
    try {
      var s = String(v == null ? "" : v);
      return s.length > max ? s.slice(0, max) + "..." : s;
    } catch (e) {
      return "";
    }
  }

  function redactToken(tok) {
    if (!tok) return "(none)";
    var s = String(tok);
    return "[redacted token len=" + s.length + "]";
  }

  function redactName(name) {
    if (!name) return "(none)";
    var s = String(name).trim();
    if (!s) return "(none)";
    return s.charAt(0) + "*** (" + s.length + " chars)";
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
    return null;
  }

  function post(request) {
    try {
      log.audit(
        "paymentcardtoken: request received",
        JSON.stringify({
          customerId: Number(request && request.customerId),
          paymentMethodId: Number(request && request.paymentMethodId),
          token: redactToken(request && request.token),
          tokenFamilyLabel: safeStr(request && request.tokenFamilyLabel, 40),
          tokenNamespace: safeStr(request && request.tokenNamespace, 40),
          issuerIdentificationNumber: safeStr(
            request && request.issuerIdentificationNumber,
            20
          ),
          cardNameOnCard: redactName(request && request.cardNameOnCard),
          accountNumberLastFour:
            request && request.accountNumberLastFour
              ? String(request.accountNumberLastFour)
                  .replace(/\D/g, "")
                  .slice(-4)
              : "(none)",
          accountType: safeStr(request && request.accountType, 20),
          cardBrand: safeStr(request && request.cardBrand, 20),
          tokenExpirationDate: safeStr(
            request && request.tokenExpirationDate,
            20
          ),
        })
      );
    } catch (e0) {
      log.debug("log.audit failed (ignored)", e0 && e0.message);
    }

    try {
      var customerId = Number(request.customerId);
      var paymentMethodId = Number(request.paymentMethodId);
      var token = request.token;

      if (!customerId || !paymentMethodId || !token) {
        log.error(
          "validation failed",
          JSON.stringify({
            customerId: customerId,
            paymentMethodId: paymentMethodId,
            tokenPresent: !!token,
          })
        );
        return {
          success: false,
          message: "customerId, paymentMethodId, and token are required",
        };
      }

      var tokenExpirationDate = request.tokenExpirationDate; // "YYYY-MM-DD" or "MM/YYYY"
      var tokenFamilyLabel = request.tokenFamilyLabel;
      var tokenNamespace = request.tokenNamespace;
      var issuerIdentificationNumber = request.issuerIdentificationNumber;

      log.debug(
        "record.create",
        JSON.stringify({ type: "paymentcardtoken", isDynamic: true })
      );
      var rec = record.create({ type: "paymentcardtoken", isDynamic: true });

      if (tokenFamilyLabel) {
        log.debug(
          "setText tokenfamily",
          JSON.stringify({ text: tokenFamilyLabel })
        );
        rec.setText({ fieldId: "tokenfamily", text: tokenFamilyLabel });
      }

      log.debug("setValue entity", JSON.stringify({ value: customerId }));
      rec.setValue({ fieldId: "entity", value: customerId });

      log.debug(
        "setValue paymentmethod",
        JSON.stringify({ value: paymentMethodId })
      );
      rec.setValue({ fieldId: "paymentmethod", value: paymentMethodId });

      log.debug("setValue token", "[redacted]");
      rec.setValue({ fieldId: "token", value: token });

      if (request.cardNameOnCard) {
        var trimmedName = String(request.cardNameOnCard).trim();
        log.debug(
          "setValue cardnameoncard",
          JSON.stringify({ value: redactName(trimmedName) })
        );
        rec.setValue({ fieldId: "cardnameoncard", value: trimmedName });
      }

      if (request.accountNumberLastFour) {
        var last4 = String(request.accountNumberLastFour)
          .replace(/\D/g, "")
          .slice(-4);
        if (last4 && last4.length === 4) {
          log.debug(
            "setValue cardlastfourdigits",
            JSON.stringify({ value: last4 })
          );
          rec.setValue({ fieldId: "cardlastfourdigits", value: last4 });
        } else {
          log.debug(
            "skip cardlastfourdigits",
            JSON.stringify({
              provided: safeStr(request.accountNumberLastFour, 12),
            })
          );
        }
      }

      var brandInput = request.cardBrand || request.accountType;
      var brand = normalizeBrand(brandInput);
      log.debug(
        "brand normalization",
        JSON.stringify({
          input: safeStr(brandInput, 20),
          normalized: brand || "(none)",
        })
      );
      if (brand) {
        try {
          log.debug("setText cardbrand", JSON.stringify({ text: brand }));
          rec.setText({ fieldId: "cardbrand", text: brand });
        } catch (e1) {
          log.debug(
            "setText cardbrand failed, fallback to setValue",
            JSON.stringify({
              name: e1.name,
              message: e1.message,
            })
          );
          try {
            log.debug("setValue cardbrand", JSON.stringify({ value: brand }));
            rec.setValue({ fieldId: "cardbrand", value: brand });
          } catch (e2) {
            log.error(
              "cardbrand setValue failed",
              JSON.stringify({
                name: e2.name,
                message: e2.message,
              })
            );
          }
        }
      }

      if (tokenExpirationDate) {
        var d;
        if (/^\d{1,2}[/-]\d{4}$/.test(tokenExpirationDate)) {
          var p = tokenExpirationDate.split(/[/-]/);
          var mm = parseInt(p[0], 10) - 1;
          var yyyy = parseInt(p[1], 10);
          d = new Date(yyyy, mm + 1, 0);
          log.debug(
            "parsed expiration (MM/YYYY)",
            JSON.stringify({
              input: tokenExpirationDate,
              jsDate: d.toISOString(),
            })
          );
        } else {
          d = new Date(tokenExpirationDate);
          log.debug(
            "parsed expiration (Date parse)",
            JSON.stringify({
              input: tokenExpirationDate,
              jsDate: isNaN(d.getTime()) ? "(invalid)" : d.toISOString(),
            })
          );
        }
        if (!isNaN(d.getTime())) {
          var text = format.format({ value: d, type: format.Type.DATE });
          var nsDate = format.parse({ value: text, type: format.Type.DATE });
          log.debug(
            "setValue tokenexpirationdate",
            JSON.stringify({ text: text })
          );
          rec.setValue({ fieldId: "tokenexpirationdate", value: nsDate });
        } else {
          log.debug(
            "skip tokenexpirationdate (invalid date)",
            JSON.stringify({
              input: tokenExpirationDate,
            })
          );
        }
      }

      if (tokenNamespace) {
        log.debug(
          "setValue tokennamespace",
          JSON.stringify({ value: safeStr(tokenNamespace, 40) })
        );
        rec.setValue({ fieldId: "tokennamespace", value: tokenNamespace });
      }
      if (issuerIdentificationNumber) {
        log.debug(
          "setValue issueridentificationnumber",
          JSON.stringify({
            value: safeStr(issuerIdentificationNumber, 20),
          })
        );
        rec.setValue({
          fieldId: "issueridentificationnumber",
          value: issuerIdentificationNumber,
        });
      }

      log.audit("saving paymentcardtoken...", "");
      var id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
      log.audit("paymentcardtoken saved", JSON.stringify({ id: id }));

      return { success: true, paymentCardTokenId: id };
    } catch (e) {
      log.error(
        "paymentcardtoken save failed",
        JSON.stringify({
          name: e && e.name,
          message: e && e.message,
          stack: e && e.stack,
        })
      );
      throw e;
    }
  }

  return { post: post };
});
