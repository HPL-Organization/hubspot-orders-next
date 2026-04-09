/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/search", "N/log"], function (record, search, log) {
  var CUSTOMER_EXPRESS_PAY_FIELD = "custentity_hpl_express_pay";
  var DELAYED_CHECKBOX_FIELD = "custbody_hpl_express_pay_pay_delayed";
  var PORTAL_MEMO_KEYWORD = "order portal";

  // ---------------- TEST GUARD ----------------
  var TEST_MODE_ONLY = true;
  var TEST_CUSTOMER_IDS = [48985, 106907, 239418, 3980, 21483, 67900];
  // --------------------------------------------

  function afterSubmit(context) {
    log.audit("EXPRESS PAY UE ENTERED", {
      contextType: context.type,
      recordType: context.newRecord && context.newRecord.type,
      invoiceId: context.newRecord && context.newRecord.id,
    });

    try {
      if (context.type !== context.UserEventType.CREATE) {
        log.audit("EXPRESS PAY SKIP - NOT CREATE", {
          contextType: context.type,
          invoiceId: context.newRecord && context.newRecord.id,
        });
        return;
      }

      var invoiceId = context.newRecord.id;
      if (!invoiceId) {
        log.audit("EXPRESS PAY SKIP - NO INVOICE ID", {});
        return;
      }

      var invoiceRec = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: false,
      });

      var customerId = invoiceRec.getValue({ fieldId: "entity" });
      var memo = invoiceRec.getValue({ fieldId: "memo" }) || "";
      var createdFrom = invoiceRec.getValue({ fieldId: "createdfrom" });
      var amountRemaining = round2(
        toNum(invoiceRec.getValue({ fieldId: "amountremaining" })),
      );

      log.audit("EXPRESS PAY HEADER DEBUG", {
        invoiceId: invoiceId,
        customerId: customerId,
        createdFrom: createdFrom,
        amountRemaining: amountRemaining,
        memo: memo,
      });

      if (!customerId || !createdFrom || amountRemaining <= 0) {
        log.audit("EXPRESS PAY SKIP - BASIC HEADER CHECK", {
          invoiceId: invoiceId,
          customerId: customerId,
          createdFrom: createdFrom,
          amountRemaining: amountRemaining,
        });
        return;
      }

      log.audit("EXPRESS PAY CUSTOMER CHECK", {
        invoiceId: invoiceId,
        customerId: customerId,
        testModeOnly: TEST_MODE_ONLY,
        testCustomerIds: TEST_CUSTOMER_IDS,
      });

      if (!passesTestGuard(customerId)) {
        log.audit("EXPRESS PAY SKIP - TEST GUARD", {
          invoiceId: invoiceId,
          customerId: customerId,
          createdFrom: createdFrom,
          testModeOnly: TEST_MODE_ONLY,
          testCustomerIds: TEST_CUSTOMER_IDS,
        });
        return;
      }

      var expressPayId = getCustomerExpressPay(customerId);
      if (!expressPayId) {
        log.audit("EXPRESS PAY SKIP - CUSTOMER NOT ENROLLED", {
          invoiceId: invoiceId,
          customerId: customerId,
        });
        return;
      }

      var memoLower = String(memo).toLowerCase();
      var isOrderPortalInvoice = memoLower.indexOf(PORTAL_MEMO_KEYWORD) !== -1;

      if (isOrderPortalInvoice) {
        record.submitFields({
          type: record.Type.INVOICE,
          id: invoiceId,
          values: (function () {
            var x = {};
            x[DELAYED_CHECKBOX_FIELD] = true;
            return x;
          })(),
          options: {
            enableSourcing: false,
            ignoreMandatoryFields: true,
          },
        });

        log.audit("EXPRESS PAY DELAYED", {
          invoiceId: invoiceId,
          customerId: customerId,
          reason: "order portal memo detected",
        });
        return;
      }

      var chargeAmount = getEligibleInvoiceCharge(invoiceRec, createdFrom);

      if (chargeAmount <= 0) {
        log.audit("EXPRESS PAY SKIP - NO ELIGIBLE AMOUNT", {
          invoiceId: invoiceId,
          customerId: customerId,
          chargeAmount: chargeAmount,
        });
        return;
      }

      if (chargeAmount > amountRemaining) {
        chargeAmount = amountRemaining;
      }
      chargeAmount = round2(chargeAmount);

      if (chargeAmount <= 0) {
        log.audit("EXPRESS PAY SKIP - AMOUNT AFTER CAPPING IS ZERO", {
          invoiceId: invoiceId,
          amountRemaining: amountRemaining,
          chargeAmount: chargeAmount,
        });
        return;
      }

      var paymentId = createCustomerPayment({
        customerId: customerId,
        invoiceId: invoiceId,
        expressPayId: expressPayId,
        amount: chargeAmount,
      });

      log.audit("EXPRESS PAY PAYMENT CREATED", {
        invoiceId: invoiceId,
        customerId: customerId,
        paymentId: paymentId,
        chargeAmount: chargeAmount,
      });
    } catch (e) {
      log.error("EXPRESS PAY UE FAILED", {
        message: e.message,
        stack: e.stack,
      });
    }
  }

  function passesTestGuard(customerId) {
    if (!TEST_MODE_ONLY) return true;
    return TEST_CUSTOMER_IDS.indexOf(Number(customerId)) !== -1;
  }

  function getEligibleInvoiceCharge(invoiceRec, salesOrderId) {
    var soLineMap = buildSalesOrderLineMap(salesOrderId);
    var count = invoiceRec.getLineCount({ sublistId: "item" });
    var total = 0;
    var debugLines = [];

    for (var i = 0; i < count; i++) {
      var itemType = invoiceRec.getSublistValue({
        sublistId: "item",
        fieldId: "itemtype",
        line: i,
      });

      var qty = Math.abs(
        toNum(
          invoiceRec.getSublistValue({
            sublistId: "item",
            fieldId: "quantity",
            line: i,
          }),
        ),
      );

      var amount = Math.abs(
        toNum(
          invoiceRec.getSublistValue({
            sublistId: "item",
            fieldId: "amount",
            line: i,
          }),
        ),
      );

      var orderLine = invoiceRec.getSublistValue({
        sublistId: "item",
        fieldId: "orderline",
        line: i,
      });

      var itemId = invoiceRec.getSublistValue({
        sublistId: "item",
        fieldId: "item",
        line: i,
      });

      var eligibleLineAmount = 0;
      var skipped = false;
      var reason = "";
      var soLineData = null;

      if (
        itemType === "Description" ||
        itemType === "Subtotal" ||
        itemType === "Discount" ||
        itemType === "Markup" ||
        itemType === "Payment" ||
        itemType === "Group" ||
        itemType === "EndGroup"
      ) {
        skipped = true;
        reason = "non-item line";
      } else if (qty <= 0 || amount <= 0) {
        skipped = true;
        reason = "no positive qty/amount";
      } else if (!orderLine) {
        skipped = true;
        reason = "missing orderline link";
      } else {
        soLineData = soLineMap[String(orderLine)] || null;

        if (!soLineData) {
          skipped = true;
          reason = "sales order line not found";
        } else if (toNum(soLineData.quantityFulfilled) > 0) {
          skipped = true;
          reason = "already fulfilled";
        } else if (toNum(soLineData.quantityCommitted) < qty) {
          skipped = true;
          reason = "not fully committed / backordered";
        } else {
          eligibleLineAmount = round2(amount);
        }
      }

      total += eligibleLineAmount;

      debugLines.push({
        line: i,
        itemId: itemId,
        itemType: itemType,
        invoiceQty: qty,
        invoiceAmount: amount,
        orderLine: orderLine,
        soCommittedQty: soLineData ? soLineData.quantityCommitted : "",
        soFulfilledQty: soLineData ? soLineData.quantityFulfilled : "",
        eligibleLineAmount: eligibleLineAmount,
        skipped: skipped,
        reason: reason,
      });
    }

    log.audit("EXPRESS PAY UE LINE BREAKDOWN", debugLines);
    log.audit("EXPRESS PAY CHARGE DEBUG", {
      invoiceId: invoiceRec.id,
      salesOrderId: salesOrderId,
      totalEligible: total,
    });

    return round2(total);
  }

  function buildSalesOrderLineMap(soId) {
    var soRec = record.load({
      type: record.Type.SALES_ORDER,
      id: Number(soId),
      isDynamic: false,
    });

    var count = soRec.getLineCount({ sublistId: "item" });
    var map = {};

    for (var i = 0; i < count; i++) {
      var soLineId = tryGetSublistValue(soRec, "item", "line", i);
      var quantityCommitted = toNum(
        tryGetSublistValue(soRec, "item", "quantitycommitted", i),
      );

      var quantityFulfilled = toNum(
        tryGetSublistValue(soRec, "item", "quantityfulfilled", i),
      );

      if (!quantityFulfilled) {
        quantityFulfilled = toNum(
          tryGetSublistValue(soRec, "item", "quantityshiprecv", i),
        );
      }

      map[String(soLineId)] = {
        soLineId: soLineId,
        quantityCommitted: quantityCommitted,
        quantityFulfilled: quantityFulfilled,
      };
    }

    return map;
  }

  function getCustomerExpressPay(customerId) {
    var customerFields = search.lookupFields({
      type: search.Type.CUSTOMER,
      id: customerId,
      columns: [CUSTOMER_EXPRESS_PAY_FIELD],
    });

    var raw = customerFields[CUSTOMER_EXPRESS_PAY_FIELD];

    if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
      return raw.value || raw.text || "";
    }
    if (Array.isArray(raw)) {
      if (raw.length) return raw[0].value || raw[0].text || raw[0] || "";
      return "";
    }
    return raw || "";
  }

  function createCustomerPayment(opts) {
    var payRec = record.transform({
      fromType: record.Type.CUSTOMER,
      fromId: Number(opts.customerId),
      toType: record.Type.CUSTOMER_PAYMENT,
      isDynamic: true,
    });

    payRec.setValue({
      fieldId: "paymentoption",
      value: Number(opts.expressPayId),
    });

    payRec.setValue({
      fieldId: "autoapply",
      value: false,
    });

    var applyCount = payRec.getLineCount({ sublistId: "apply" });
    var found = false;

    for (var i = 0; i < applyCount; i++) {
      var docId = payRec.getSublistValue({
        sublistId: "apply",
        fieldId: "internalid",
        line: i,
      });

      if (String(docId) === String(opts.invoiceId)) {
        payRec.selectLine({ sublistId: "apply", line: i });
        payRec.setCurrentSublistValue({
          sublistId: "apply",
          fieldId: "apply",
          value: true,
        });
        payRec.setCurrentSublistValue({
          sublistId: "apply",
          fieldId: "amount",
          value: round2(opts.amount),
        });
        payRec.commitLine({ sublistId: "apply" });
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error("Invoice not found on customer payment apply sublist");
    }

    payRec.setValue({
      fieldId: "payment",
      value: round2(opts.amount),
    });

    return payRec.save({
      enableSourcing: true,
      ignoreMandatoryFields: false,
    });
  }

  function tryGetSublistValue(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line,
      });
    } catch (e) {
      return "";
    }
  }

  function toNum(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function round2(v) {
    return Math.round((toNum(v) + Number.EPSILON) * 100) / 100;
  }

  return {
    afterSubmit: afterSubmit,
  };
});
