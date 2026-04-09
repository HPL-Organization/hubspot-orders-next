/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/log", "N/record"], function (search, log, record) {
  var CUSTOMER_EXPRESS_PAY_FIELD = "custentity_hpl_express_pay";
  var DELAYED_CHECKBOX_FIELD = "custbody_hpl_express_pay_pay_delayed";
  var PORTAL_DELAY_MINUTES = 15;

  // ---------------- TEST GUARD ----------------
  var TEST_MODE_ONLY = true;
  var TEST_CUSTOMER_IDS = [48985, 106907, 239418, 3980, 21483];
  // --------------------------------------------

  function getInputData() {
    return search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["type", "anyof", "CustInvc"],
        "and",
        ["mainline", "is", "T"],
        "and",
        ["amountremaining", "greaterthan", "0.00"],
        "and",
        ["createdfrom.type", "anyof", "SalesOrd"],
        "and",
        [DELAYED_CHECKBOX_FIELD, "is", "T"],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "tranid" }),
        search.createColumn({ name: "entity" }),
        search.createColumn({ name: "memo" }),
        search.createColumn({ name: "datecreated" }),
        search.createColumn({ name: "createdfrom" }),
        search.createColumn({ name: "amountremaining" }),
      ],
    });
  }

  function map(context) {
    var row = JSON.parse(context.value);
    var v = row.values || {};

    try {
      var invoiceId = getAny(v, ["internalid"]);
      var tranId = getAny(v, ["tranid"]);
      var customerId = getValue(v.entity);
      var customerText = getText(v.entity);
      var memo = getAny(v, ["memo"]);
      var createdDate = getAny(v, ["datecreated"]);
      var salesOrderId = getValue(v.createdfrom);
      var salesOrderText = getText(v.createdfrom);
      var amountRemaining = round2(toNum(getAny(v, ["amountremaining"])));

      context.write({
        key: String(invoiceId),
        value: JSON.stringify({
          invoiceId: invoiceId,
          tranId: tranId,
          customerId: customerId,
          customer: customerText,
          memo: memo,
          createdDate: createdDate,
          salesOrderId: salesOrderId,
          salesOrderText: salesOrderText,
          amountRemaining: amountRemaining,
        }),
      });
    } catch (e) {
      log.error("MAP FAILED", {
        message: e.message,
        stack: e.stack,
        row: row,
      });
    }
  }

  function reduce(context) {
    var header = null;

    for (var i = 0; i < context.values.length; i++) {
      var row = JSON.parse(context.values[i]);
      if (!header) {
        header = row;
      }
    }

    if (
      !header ||
      !header.invoiceId ||
      !header.customerId ||
      !header.salesOrderId
    ) {
      log.audit("SKIP INVOICE - MISSING HEADER DATA", {
        invoiceId: header ? header.invoiceId : "",
        customerId: header ? header.customerId : "",
        salesOrderId: header ? header.salesOrderId : "",
      });
      return;
    }

    if (!passesTestGuard(header.customerId)) {
      log.audit("SKIP INVOICE - TEST GUARD", {
        invoiceId: header.invoiceId,
        tranId: header.tranId,
        customerId: header.customerId,
        salesOrderId: header.salesOrderId,
        testModeOnly: TEST_MODE_ONLY,
        testCustomerIds: TEST_CUSTOMER_IDS,
      });
      return;
    }

    var ageMinutes = minutesSince(header.createdDate);
    if (ageMinutes >= 0 && ageMinutes < PORTAL_DELAY_MINUTES) {
      log.audit("SKIP INVOICE - DELAY NOT REACHED", {
        invoiceId: header.invoiceId,
        tranId: header.tranId,
        ageMinutes: ageMinutes,
        requiredDelayMinutes: PORTAL_DELAY_MINUTES,
      });
      return;
    }

    var expressPayId = "";
    var customerLookupRaw = "";

    try {
      var customerFields = search.lookupFields({
        type: search.Type.CUSTOMER,
        id: header.customerId,
        columns: [CUSTOMER_EXPRESS_PAY_FIELD],
      });

      customerLookupRaw = customerFields[CUSTOMER_EXPRESS_PAY_FIELD];

      if (
        customerLookupRaw != null &&
        typeof customerLookupRaw === "object" &&
        !Array.isArray(customerLookupRaw)
      ) {
        expressPayId = customerLookupRaw.value || customerLookupRaw.text || "";
      } else if (Array.isArray(customerLookupRaw)) {
        if (customerLookupRaw.length) {
          expressPayId =
            customerLookupRaw[0].value ||
            customerLookupRaw[0].text ||
            customerLookupRaw[0] ||
            "";
        }
      } else {
        expressPayId = customerLookupRaw || "";
      }
    } catch (e) {
      log.error("CUSTOMER EXPRESS PAY LOOKUP FAILED", {
        invoiceId: header.invoiceId,
        customerId: header.customerId,
        message: e.message,
        stack: e.stack,
      });
      return;
    }

    if (!expressPayId) {
      log.audit("SKIP INVOICE - CUSTOMER NOT ENROLLED", {
        invoiceId: header.invoiceId,
        tranId: header.tranId,
        customerId: header.customerId,
        customer: header.customer,
        customerLookupRaw: customerLookupRaw,
      });
      return;
    }

    var invoiceRec;
    try {
      invoiceRec = record.load({
        type: record.Type.INVOICE,
        id: Number(header.invoiceId),
        isDynamic: false,
      });
    } catch (e) {
      log.error("INVOICE LOAD FAILED", {
        invoiceId: header.invoiceId,
        message: e.message,
        stack: e.stack,
      });
      return;
    }

    var chargeInfo;
    try {
      chargeInfo = getEligibleInvoiceCharge(invoiceRec, header.salesOrderId);
    } catch (e) {
      log.error("ELIGIBLE CHARGE CALC FAILED", {
        invoiceId: header.invoiceId,
        salesOrderId: header.salesOrderId,
        message: e.message,
        stack: e.stack,
      });
      return;
    }

    var chargeAmount = round2(chargeInfo.total);
    var debugLines = chargeInfo.debugLines || [];

    if (chargeAmount > header.amountRemaining) {
      chargeAmount = round2(header.amountRemaining);
    }

    var paymentId = "";
    var paymentCreated = false;
    var paymentError = "";

    if (chargeAmount > 0) {
      try {
        paymentId = createCustomerPayment({
          customerId: header.customerId,
          invoiceId: header.invoiceId,
          expressPayId: expressPayId,
          amount: chargeAmount,
        });

        paymentCreated = true;

        record.submitFields({
          type: record.Type.INVOICE,
          id: header.invoiceId,
          values: (function () {
            var x = {};
            x[DELAYED_CHECKBOX_FIELD] = false;
            return x;
          })(),
          options: {
            enableSourcing: false,
            ignoreMandatoryFields: true,
          },
        });
      } catch (e) {
        paymentError = e.message || String(e);
        log.error("CUSTOMER PAYMENT CREATE FAILED", {
          invoiceId: header.invoiceId,
          tranId: header.tranId,
          customerId: header.customerId,
          expressPayId: expressPayId,
          amountRemaining: header.amountRemaining,
          chargeAmount: chargeAmount,
          message: e.message,
          stack: e.stack,
        });
      }
    }

    log.audit("EXPRESS PAY DELAYED LINE BREAKDOWN", debugLines);

    log.audit("EXPRESS PAY DELAYED RESULT", {
      invoiceId: header.invoiceId,
      tranId: header.tranId,
      customerId: header.customerId,
      customer: header.customer,
      salesOrderId: header.salesOrderId,
      salesOrderText: header.salesOrderText,
      memo: header.memo,
      invoiceAgeMinutes: ageMinutes,
      expressPayId: expressPayId,
      amountRemaining: header.amountRemaining,
      chargeAmount: chargeAmount,
      paymentCreated: paymentCreated,
      paymentId: paymentId,
      paymentError: paymentError,
      customerLookupRaw: customerLookupRaw,
    });
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

    return {
      total: round2(total),
      debugLines: debugLines,
    };
  }

  function buildSalesOrderLineMap(soId) {
    var map = {};

    var soSearch = search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["internalid", "anyof", String(soId)],
        "and",
        ["mainline", "is", "F"],
        "and",
        ["taxline", "is", "F"],
        "and",
        ["shipping", "is", "F"],
        "and",
        ["cogs", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "line" }),
        search.createColumn({ name: "quantitycommitted" }),
        search.createColumn({ name: "quantityshiprecv" }),
      ],
    });

    soSearch.run().each(function (res) {
      var soLineId = res.getValue({ name: "line" });
      var quantityCommitted = toNum(
        res.getValue({ name: "quantitycommitted" }),
      );
      var quantityFulfilled = toNum(res.getValue({ name: "quantityshiprecv" }));

      map[String(soLineId)] = {
        soLineId: soLineId,
        quantityCommitted: quantityCommitted,
        quantityFulfilled: quantityFulfilled,
      };

      return true;
    });

    return map;
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

  function passesTestGuard(customerId) {
    if (!TEST_MODE_ONLY) return true;
    return TEST_CUSTOMER_IDS.indexOf(Number(customerId)) !== -1;
  }

  function summarize(summary) {
    if (summary.inputSummary && summary.inputSummary.error) {
      log.error("INPUT ERROR", summary.inputSummary.error);
    }

    if (summary.mapSummary && summary.mapSummary.errors) {
      summary.mapSummary.errors.iterator().each(function (key, error) {
        log.error("MAP ERROR " + key, error);
        return true;
      });
    }

    if (summary.reduceSummary && summary.reduceSummary.errors) {
      summary.reduceSummary.errors.iterator().each(function (key, error) {
        log.error("REDUCE ERROR " + key, error);
        return true;
      });
    }

    log.audit("SUMMARY", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
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

  function getAny(values, keys) {
    for (var i = 0; i < keys.length; i++) {
      var val = getTextOrValue(values[keys[i]]);
      if (val !== "" && val != null) return val;
    }
    return "";
  }

  function getValue(x) {
    if (x == null) return "";
    if (Array.isArray(x)) return x.length ? x[0].value || "" : "";
    if (typeof x === "object" && x.value != null) return x.value;
    return x;
  }

  function getText(x) {
    if (x == null) return "";
    if (Array.isArray(x)) return x.length ? x[0].text || "" : "";
    if (typeof x === "object" && x.text != null) return x.text;
    return x;
  }

  function getTextOrValue(x) {
    return getText(x) || getValue(x) || "";
  }

  function toNum(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function round2(v) {
    return Math.round((toNum(v) + Number.EPSILON) * 100) / 100;
  }

  function minutesSince(dateValue) {
    if (!dateValue) return -1;
    var d = new Date(dateValue);
    if (isNaN(d.getTime())) return -1;
    return (new Date().getTime() - d.getTime()) / 60000;
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
