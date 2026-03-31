/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/log"], function (record, log) {
  var FLD_USED = "custcol_hpl_line_deposit_already_used";
  var FLD_BO_QTY = "custcol_hpl_line_backorder_qty_at_dep";
  var FLD_DEP_TOTAL = "custcol_hpl_line_deposit_total";

  function beforeSubmit(context) {
    try {
      if (context.type !== context.UserEventType.CREATE) return;

      var depAppRec = context.newRecord;
      var invoiceInfo = findAppliedInvoiceLine(depAppRec);

      if (!invoiceInfo) {
        log.audit("No applied invoice found on deposit application", {});
        return;
      }

      var invoiceId = invoiceInfo.invoiceId;

      var invoiceRec = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: false,
      });

      var soId = invoiceRec.getValue({ fieldId: "createdfrom" });
      if (!soId) {
        log.audit("Invoice has no createdfrom SO, skipping", {
          invoiceId: invoiceId,
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
        log.audit("Calculated deposit amount is 0, clearing apply", {
          invoiceId: invoiceId,
          soId: soId,
          lineDetails: calc.lineDetails,
        });

        clearAllApplyLines(depAppRec);
        trySetBody(depAppRec, "autoapply", false);
        trySetBody(depAppRec, "payment", 0);

        return;
      }

      trySetBody(depAppRec, "autoapply", false);
      trySetBody(depAppRec, "payment", round2(calc.totalToApply));

      clearAllApplyLines(depAppRec);

      depAppRec.setSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        line: invoiceInfo.line,
        value: true,
      });

      depAppRec.setSublistValue({
        sublistId: "apply",
        fieldId: "amount",
        line: invoiceInfo.line,
        value: round2(calc.totalToApply),
      });

      log.audit("Deposit application overridden from invoice/SO calc", {
        invoiceId: invoiceId,
        soId: soId,
        depositApplicationId: depAppRec.id || null,
        line: invoiceInfo.line,
        totalApplied: calc.totalToApply,
        lineDetails: calc.lineDetails,
      });
    } catch (e) {
      log.error("Deposit application beforeSubmit failed", {
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
      throw e;
    }
  }

  function afterSubmit(context) {
    try {
      if (context.type !== context.UserEventType.CREATE) return;

      var depAppRec = record.load({
        type: record.Type.DEPOSIT_APPLICATION,
        id: context.newRecord.id,
        isDynamic: false,
      });

      var invoiceInfo = findAppliedInvoiceLine(depAppRec);
      if (!invoiceInfo) {
        log.audit(
          "No applied invoice found on deposit application after save",
          {
            depositApplicationId: context.newRecord.id,
          },
        );
        return;
      }

      var invoiceId = invoiceInfo.invoiceId;

      var invoiceRec = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: false,
      });

      var soId = invoiceRec.getValue({ fieldId: "createdfrom" });
      if (!soId) {
        log.audit("Invoice has no createdfrom SO, skipping SO writeback", {
          depositApplicationId: context.newRecord.id,
          invoiceId: invoiceId,
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
        log.audit("Calculated deposit amount is 0, skipping SO writeback", {
          depositApplicationId: context.newRecord.id,
          invoiceId: invoiceId,
          soId: soId,
        });
        return;
      }

      applyUsedAmountsBackToSalesOrder(soRec, calc.soLineDeltas);

      log.audit("Wrote deposit application usage back to SO", {
        depositApplicationId: context.newRecord.id,
        invoiceId: invoiceId,
        soId: soId,
        totalApplied: calc.totalToApply,
        lineDetails: calc.lineDetails,
      });
    } catch (e) {
      log.error("Deposit application afterSubmit failed", {
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
      throw e;
    }
  }

  function findAppliedInvoiceLine(depAppRec) {
    var applyCount = depAppRec.getLineCount({ sublistId: "apply" });

    for (var i = 0; i < applyCount; i++) {
      var isApplied = depAppRec.getSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        line: i,
      });

      if (!isApplied) continue;

      var invoiceId = safeString(
        depAppRec.getSublistValue({
          sublistId: "apply",
          fieldId: "doc",
          line: i,
        }),
      );

      if (!invoiceId) continue;

      return {
        line: i,
        invoiceId: invoiceId,
      };
    }

    return null;
  }

  function clearAllApplyLines(depAppRec) {
    var applyCount = depAppRec.getLineCount({ sublistId: "apply" });

    for (var i = 0; i < applyCount; i++) {
      depAppRec.setSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        line: i,
        value: false,
      });
    }
  }

  function trySetBody(rec, fieldId, value) {
    try {
      rec.setValue({
        fieldId: fieldId,
        value: value,
      });
    } catch (e) {}
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
        totalQty: Math.abs(
          toNum(
            soRec.getSublistValue({
              sublistId: "item",
              fieldId: "quantity",
              line: i,
            }),
          ),
        ),
        invoicedQty: Math.abs(
          toNum(
            soRec.getSublistValue({
              sublistId: "item",
              fieldId: "invoiced",
              line: i,
            }),
          ),
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

  function collectInvoiceLineGroups(invoiceRec) {
    var map = Object.create(null);
    var lineCount = invoiceRec.getLineCount({ sublistId: "item" });
    var details = [];

    for (var i = 0; i < lineCount; i++) {
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
        details.push({
          invoiceLine: i,
          item: itemText,
          orderLine: orderLine,
          qty: qty,
          applied: 0,
          reason: "missing orderline or qty <= 0",
        });
        continue;
      }

      if (!map[orderLine]) {
        map[orderLine] = {
          orderLine: orderLine,
          qty: 0,
          itemText: itemText,
          invoiceLines: [],
        };
      }

      map[orderLine].qty = round2(map[orderLine].qty + qty);
      map[orderLine].invoiceLines.push(i);

      if (!map[orderLine].itemText && itemText) {
        map[orderLine].itemText = itemText;
      }
    }

    return {
      groups: map,
      details: details,
    };
  }

  function calculateInvoiceDeposit(invoiceRec, soLineMap) {
    var collected = collectInvoiceLineGroups(invoiceRec);
    var invoiceGroups = collected.groups;
    var lineDetails = collected.details.slice();
    var totalToApply = 0;
    var soLineDeltas = Object.create(null);
    var orderLines = Object.keys(invoiceGroups);

    for (var i = 0; i < orderLines.length; i++) {
      var orderLine = orderLines[i];
      var invoiceGroup = invoiceGroups[orderLine];
      var qty = Math.abs(toNum(invoiceGroup.qty));
      var itemText = safeString(invoiceGroup.itemText);

      var soLine = soLineMap[orderLine];
      if (!soLine) {
        lineDetails.push({
          invoiceLines: invoiceGroup.invoiceLines,
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
      var alreadyUsed = round2(soLine.alreadyUsed);
      var totalQty = Math.abs(toNum(soLine.totalQty));
      var soInvoicedQty = Math.abs(toNum(soLine.invoicedQty));

      if (depTotal <= 0 || boQty <= 0) {
        lineDetails.push({
          invoiceLines: invoiceGroup.invoiceLines,
          item: itemText || soLine.itemText,
          orderLine: orderLine,
          qty: qty,
          applied: 0,
          reason: "no deposit total or no backorder qty at deposit",
        });
        continue;
      }

      var nonBoQtyAtDep = Math.max(0, round2(totalQty - boQty));
      var prevInvoicedQty = Math.max(0, round2(soInvoicedQty - qty));
      var remainingNonBoBeforeThisInvoice = Math.max(
        0,
        round2(nonBoQtyAtDep - prevInvoicedQty),
      );
      var eligibleBoQty = Math.max(
        0,
        round2(qty - remainingNonBoBeforeThisInvoice),
      );

      var perUnit = round2(depTotal / boQty);
      var rawAmount = round2(perUnit * eligibleBoQty);
      var remaining = round2(depTotal - alreadyUsed);
      if (remaining < 0) remaining = 0;

      var applyAmount = Math.min(rawAmount, remaining);
      applyAmount = round2(applyAmount);

      if (applyAmount <= 0) {
        lineDetails.push({
          invoiceLines: invoiceGroup.invoiceLines,
          item: itemText || soLine.itemText,
          orderLine: orderLine,
          qty: qty,
          soLineQty: totalQty,
          soLineInvoicedQty: soInvoicedQty,
          prevInvoicedQty: prevInvoicedQty,
          nonBoQtyAtDep: nonBoQtyAtDep,
          remainingNonBoBeforeThisInvoice: remainingNonBoBeforeThisInvoice,
          eligibleBoQty: eligibleBoQty,
          applied: 0,
          reason:
            eligibleBoQty <= 0
              ? "invoice did not reach backordered portion"
              : "remaining line deposit is 0",
        });
        continue;
      }

      totalToApply = round2(totalToApply + applyAmount);
      soLineDeltas[orderLine] = round2(
        (soLineDeltas[orderLine] || 0) + applyAmount,
      );

      lineDetails.push({
        invoiceLines: invoiceGroup.invoiceLines,
        item: itemText || soLine.itemText,
        orderLine: orderLine,
        qty: qty,
        soLineQty: totalQty,
        soLineInvoicedQty: soInvoicedQty,
        prevInvoicedQty: prevInvoicedQty,
        nonBoQtyAtDep: nonBoQtyAtDep,
        remainingNonBoBeforeThisInvoice: remainingNonBoBeforeThisInvoice,
        eligibleBoQty: eligibleBoQty,
        perUnitDeposit: perUnit,
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
    beforeSubmit: beforeSubmit,
    afterSubmit: afterSubmit,
  };
});
