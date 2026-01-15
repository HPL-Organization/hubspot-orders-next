/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 *
 * HPL_Invoice_AutoPay_GiveawayWarranty_UE
 *
 * On Invoice CREATE/EDIT:
 * - If created from a Sales Order with custbody_hpl_giveaway OR custbody_hpl_warranty checked,
 *   then create a Customer Payment (NO payment option/method) and apply it to this invoice
 *   for the current remaining balance.
 *
 * Giveaway -> account 227
 * Warranty -> account 264
 */

define(["N/record", "N/log"], function (record, log) {
  var SO_FIELD_GIVEAWAY = "custbody_hpl_giveaway";
  var SO_FIELD_WARRANTY = "custbody_hpl_warranty";

  var ACCOUNT_GIVEAWAY = "227";
  var ACCOUNT_WARRANTY = "264";

  function asNumber(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function isTruthy(v) {
    return v === true || v === "T";
  }

  function safeSet(rec, fieldId, value) {
    try {
      rec.setValue({ fieldId: fieldId, value: value });
      return true;
    } catch (e) {
      return false;
    }
  }

  function afterSubmit(context) {
    try {
      if (
        context.type !== context.UserEventType.CREATE &&
        context.type !== context.UserEventType.EDIT &&
        context.type !== context.UserEventType.XEDIT
      ) {
        return;
      }

      var invoiceId = context.newRecord.id;
      if (!invoiceId) return;

      var inv = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: false,
      });

      var amountRemaining = asNumber(
        inv.getValue({ fieldId: "amountremaining" })
      );
      if (amountRemaining <= 0) {
        return;
      }

      var createdFrom = inv.getValue({ fieldId: "createdfrom" });
      if (!createdFrom) {
        return;
      }

      var so = record.load({
        type: record.Type.SALES_ORDER,
        id: createdFrom,
        isDynamic: false,
      });

      var isGiveaway = isTruthy(so.getValue({ fieldId: SO_FIELD_GIVEAWAY }));
      var isWarranty = isTruthy(so.getValue({ fieldId: SO_FIELD_WARRANTY }));

      if (!isGiveaway && !isWarranty) {
        return;
      }

      var reason = isGiveaway ? "giveaway" : "warranty";
      var accountId = isGiveaway ? ACCOUNT_GIVEAWAY : ACCOUNT_WARRANTY;

      var pay = record.transform({
        fromType: record.Type.INVOICE,
        fromId: invoiceId,
        toType: record.Type.CUSTOMER_PAYMENT,
        isDynamic: true,
      });

      safeSet(pay, "undepfunds", false);
      safeSet(pay, "account", accountId);

      safeSet(pay, "paymentoption", "");
      safeSet(pay, "paymentmethod", "");

      safeSet(pay, "payment", amountRemaining);

      var sublistId = "apply";
      var lineCount = pay.getLineCount({ sublistId: sublistId });
      var applied = false;

      for (var i = 0; i < lineCount; i++) {
        var lineInvId = pay.getSublistValue({
          sublistId: sublistId,
          fieldId: "internalid",
          line: i,
        });

        if (String(lineInvId) === String(invoiceId)) {
          pay.selectLine({ sublistId: sublistId, line: i });
          pay.setCurrentSublistValue({
            sublistId: sublistId,
            fieldId: "apply",
            value: true,
          });
          pay.setCurrentSublistValue({
            sublistId: sublistId,
            fieldId: "amount",
            value: amountRemaining,
          });
          pay.commitLine({ sublistId: sublistId });
          applied = true;
          break;
        }
      }

      if (!applied) {
        log.audit({
          title: "HPL AutoPay: Invoice not found on apply sublist",
          details:
            "Invoice " +
            invoiceId +
            " (reason=" +
            reason +
            ") did not appear on Customer Payment apply sublist.",
        });
        return;
      }

      safeSet(
        pay,
        "memo",
        "HPL AutoPay (" + reason + ") - Invoice " + invoiceId
      );

      var paymentId = pay.save({
        enableSourcing: true,
        ignoreMandatoryFields: false,
      });

      log.audit({
        title: "HPL AutoPay: Customer Payment created",
        details:
          "Created Customer Payment " +
          paymentId +
          " for Invoice " +
          invoiceId +
          " amountRemaining=" +
          amountRemaining +
          " reason=" +
          reason +
          " account=" +
          accountId,
      });
    } catch (e) {
      log.error({
        title: "HPL AutoPay: Failed",
        details: e && e.stack ? e.stack : String(e),
      });
    }
  }

  return {
    afterSubmit: afterSubmit,
  };
});
