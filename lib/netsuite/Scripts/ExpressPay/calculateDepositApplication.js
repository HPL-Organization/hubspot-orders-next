/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/search", "N/log"], function (record, search, log) {
  var FLD_USED = "custcol_hpl_line_deposit_already_used";
  var FLD_BO_QTY = "custcol_hpl_line_backorder_qty_at_dep";
  var FLD_DEP_TOTAL = "custcol_hpl_line_deposit_total";

  function afterSubmit(context) {
    try {
      if (context.type !== context.UserEventType.CREATE) return;

      var invoiceId = context.newRecord.id;
      if (!invoiceId) return;

      var invoiceRec = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: false,
      });

      var invoiceTranId = safeString(
        invoiceRec.getValue({ fieldId: "tranid" }),
      );

      var soId = invoiceRec.getValue({ fieldId: "createdfrom" });
      if (!soId) {
        log.audit(
          "Invoice has no createdfrom SO, skipping deposit application",
          {
            invoiceId: invoiceId,
          },
        );
        return;
      }

      var depositId = findCustomerDepositForSalesOrder(soId);
      if (!depositId) {
        log.audit("No customer deposit found for SO", {
          invoiceId: invoiceId,
          soId: soId,
        });
        return;
      }

      var soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });

      var soLineMap = buildSalesOrderLineMap(soRec);
      var calc = calculateInvoiceDeposit(invoiceRec, soLineMap);

      if (calc.totalToApply <= 0) {
        log.audit("No eligible deposit amount for invoice", {
          invoiceId: invoiceId,
          soId: soId,
          depositId: depositId,
          lineDetails: calc.lineDetails,
        });
        return;
      }

      var depAppId = createDepositApplication(
        depositId,
        invoiceId,
        invoiceTranId,
        calc.totalToApply,
      );

      if (!depAppId) {
        log.error("Deposit application could not be created", {
          invoiceId: invoiceId,
          soId: soId,
          depositId: depositId,
          amount: calc.totalToApply,
        });
        return;
      }

      applyUsedAmountsBackToSalesOrder(soRec, calc.soLineDeltas);

      log.audit("Deposit application created for invoice", {
        invoiceId: invoiceId,
        soId: soId,
        depositId: depositId,
        depositApplicationId: depAppId,
        totalApplied: calc.totalToApply,
        lineDetails: calc.lineDetails,
      });
    } catch (e) {
      log.error("Invoice deposit application script failed", {
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
      throw e;
    }
  }

  function findCustomerDepositForSalesOrder(soId) {
    var depSearch = search.create({
      type: search.Type.CUSTOMER_DEPOSIT,
      filters: [["mainline", "is", "T"], "and", ["salesorder", "anyof", soId]],
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
      ],
    });

    var results = depSearch.run().getRange({ start: 0, end: 10 }) || [];
    if (!results.length) return null;

    return results[0].getValue({ name: "internalid" });
  }

  function buildSalesOrderLineMap(soRec) {
    var map = Object.create(null);
    var lineCount = soRec.getLineCount({ sublistId: "item" });

    for (var i = 0; i < lineCount; i++) {
      var orderLine = safeString(
        soRec.getSublistValue({
          sublistId: "item",
          fieldId: "line",
          line: i,
        }),
      );

      if (!orderLine) continue;

      map[orderLine] = {
        soLineIndex: i,
        depositTotal: round2(
          soRec.getSublistValue({
            sublistId: "item",
            fieldId: FLD_DEP_TOTAL,
            line: i,
          }),
        ),
        backorderQtyAtDep: toNum(
          soRec.getSublistValue({
            sublistId: "item",
            fieldId: FLD_BO_QTY,
            line: i,
          }),
        ),
        alreadyUsed: round2(
          soRec.getSublistValue({
            sublistId: "item",
            fieldId: FLD_USED,
            line: i,
          }),
        ),
        itemText: safeString(
          soRec.getSublistText({
            sublistId: "item",
            fieldId: "item",
            line: i,
          }),
        ),
      };
    }

    return map;
  }

  function calculateInvoiceDeposit(invoiceRec, soLineMap) {
    var invoiceLineCount = invoiceRec.getLineCount({ sublistId: "item" });
    var totalToApply = 0;
    var soLineDeltas = Object.create(null);
    var lineDetails = [];

    for (var i = 0; i < invoiceLineCount; i++) {
      var orderLine = safeString(
        invoiceRec.getSublistValue({
          sublistId: "item",
          fieldId: "orderline",
          line: i,
        }),
      );

      var qty = Math.abs(
        toNum(
          invoiceRec.getSublistValue({
            sublistId: "item",
            fieldId: "quantity",
            line: i,
          }),
        ),
      );

      var itemText = safeString(
        invoiceRec.getSublistText({
          sublistId: "item",
          fieldId: "item",
          line: i,
        }),
      );

      if (!orderLine || qty <= 0) {
        lineDetails.push({
          invoiceLine: i,
          item: itemText,
          orderLine: orderLine,
          qty: qty,
          applied: 0,
          reason: "missing orderline or qty <= 0",
        });
        continue;
      }

      var soLine = soLineMap[orderLine];
      if (!soLine) {
        lineDetails.push({
          invoiceLine: i,
          item: itemText,
          orderLine: orderLine,
          qty: qty,
          applied: 0,
          reason: "no matching SO line",
        });
        continue;
      }

      var depTotal = round2(soLine.depositTotal);
      var boQty = toNum(soLine.backorderQtyAtDep);
      var alreadyUsed = round2(
        soLine.alreadyUsed + round2(soLineDeltas[orderLine] || 0),
      );

      if (depTotal <= 0 || boQty <= 0) {
        lineDetails.push({
          invoiceLine: i,
          item: itemText || soLine.itemText,
          orderLine: orderLine,
          qty: qty,
          applied: 0,
          reason: "no deposit total or no backorder qty at deposit",
        });
        continue;
      }

      var perUnit = depTotal / boQty;
      var rawAmount = round2(perUnit * qty);
      var remaining = round2(depTotal - alreadyUsed);
      if (remaining < 0) remaining = 0;

      var applyAmount = Math.min(rawAmount, remaining);
      applyAmount = round2(applyAmount);

      if (applyAmount <= 0) {
        lineDetails.push({
          invoiceLine: i,
          item: itemText || soLine.itemText,
          orderLine: orderLine,
          qty: qty,
          applied: 0,
          reason: "remaining line deposit is 0",
        });
        continue;
      }

      totalToApply += applyAmount;
      totalToApply = round2(totalToApply);

      soLineDeltas[orderLine] = round2(
        (soLineDeltas[orderLine] || 0) + applyAmount,
      );

      lineDetails.push({
        invoiceLine: i,
        item: itemText || soLine.itemText,
        orderLine: orderLine,
        qty: qty,
        perUnitDeposit: round2(perUnit),
        rawAmount: rawAmount,
        remainingBeforeApply: remaining,
        applied: applyAmount,
      });
    }

    return {
      totalToApply: round2(totalToApply),
      soLineDeltas: soLineDeltas,
      lineDetails: lineDetails,
    };
  }

  function createDepositApplication(
    depositId,
    invoiceId,
    invoiceTranId,
    amountToApply,
  ) {
    var depAppRec = record.transform({
      fromType: record.Type.CUSTOMER_DEPOSIT,
      fromId: depositId,
      toType: record.Type.DEPOSIT_APPLICATION,
      isDynamic: true,
    });

    try {
      depAppRec.setValue({
        fieldId: "autoapply",
        value: false,
      });
    } catch (e) {}

    try {
      depAppRec.setValue({
        fieldId: "payment",
        value: round2(amountToApply),
      });
    } catch (e) {}

    try {
      depAppRec.setValue({
        fieldId: "applied",
        value: round2(amountToApply),
      });
    } catch (e) {}

    var applyCount = depAppRec.getLineCount({ sublistId: "apply" });
    var matched = false;
    var debugLines = [];

    for (var i = 0; i < applyCount; i++) {
      depAppRec.selectLine({
        sublistId: "apply",
        line: i,
      });

      depAppRec.setCurrentSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        value: false,
      });

      depAppRec.commitLine({
        sublistId: "apply",
      });
    }

    for (var j = 0; j < applyCount; j++) {
      var doc = safeString(
        depAppRec.getSublistValue({
          sublistId: "apply",
          fieldId: "doc",
          line: j,
        }),
      );

      var refnum = safeString(
        depAppRec.getSublistValue({
          sublistId: "apply",
          fieldId: "refnum",
          line: j,
        }),
      );

      var internalId = safeString(
        depAppRec.getSublistValue({
          sublistId: "apply",
          fieldId: "internalid",
          line: j,
        }),
      );

      debugLines.push({
        line: j,
        doc: doc,
        refnum: refnum,
        internalid: internalId,
      });

      var isTarget =
        internalId === safeString(invoiceId) ||
        doc === safeString(invoiceTranId) ||
        refnum === safeString(invoiceTranId);

      if (!isTarget) continue;

      depAppRec.selectLine({
        sublistId: "apply",
        line: j,
      });

      depAppRec.setCurrentSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        value: true,
      });

      depAppRec.setCurrentSublistValue({
        sublistId: "apply",
        fieldId: "amount",
        value: round2(amountToApply),
      });

      depAppRec.commitLine({
        sublistId: "apply",
      });

      matched = true;
      break;
    }

    if (!matched) {
      log.error("Invoice not found on deposit application apply sublist", {
        depositId: depositId,
        invoiceId: invoiceId,
        invoiceTranId: invoiceTranId,
        amountToApply: amountToApply,
        applyLines: debugLines,
      });
      return null;
    }

    var appliedCount = 0;
    for (var k = 0; k < applyCount; k++) {
      var isApplied = depAppRec.getSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        line: k,
      });
      if (isApplied) appliedCount++;
    }

    if (appliedCount <= 0) {
      log.error("Deposit application has no applied lines before save", {
        depositId: depositId,
        invoiceId: invoiceId,
        invoiceTranId: invoiceTranId,
        amountToApply: amountToApply,
        applyLines: debugLines,
      });
      return null;
    }

    log.audit("Saving deposit application", {
      depositId: depositId,
      invoiceId: invoiceId,
      invoiceTranId: invoiceTranId,
      amountToApply: amountToApply,
      applyLines: debugLines,
      appliedCount: appliedCount,
    });

    return depAppRec.save({
      enableSourcing: true,
      ignoreMandatoryFields: false,
    });
  }

  function applyUsedAmountsBackToSalesOrder(soRec, soLineDeltas) {
    var changed = 0;
    var orderLines = Object.keys(soLineDeltas);

    for (var i = 0; i < orderLines.length; i++) {
      var orderLine = orderLines[i];
      var delta = round2(soLineDeltas[orderLine] || 0);
      if (delta <= 0) continue;

      var lineInfo = findSoLineByOrderLine(soRec, orderLine);
      if (!lineInfo) continue;

      var currentUsed = round2(
        soRec.getSublistValue({
          sublistId: "item",
          fieldId: FLD_USED,
          line: lineInfo.line,
        }),
      );

      soRec.setSublistValue({
        sublistId: "item",
        fieldId: FLD_USED,
        line: lineInfo.line,
        value: round2(currentUsed + delta),
      });

      changed++;
    }

    if (changed > 0) {
      soRec.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });
    }
  }

  function findSoLineByOrderLine(soRec, targetOrderLine) {
    var lineCount = soRec.getLineCount({ sublistId: "item" });

    for (var i = 0; i < lineCount; i++) {
      var orderLine = safeString(
        soRec.getSublistValue({
          sublistId: "item",
          fieldId: "line",
          line: i,
        }),
      );
      if (orderLine === safeString(targetOrderLine)) {
        return { line: i };
      }
    }

    return null;
  }

  function safeString(v) {
    return v === null || v === undefined ? "" : String(v).trim();
  }

  function toNum(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function round2(v) {
    return Math.round(toNum(v) * 100) / 100;
  }

  return {
    afterSubmit: afterSubmit,
  };
});
