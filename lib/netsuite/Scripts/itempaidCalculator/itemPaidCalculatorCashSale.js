/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 */
define(["N/record", "N/search", "N/log"], (record, search, log) => {
  const ITEM_SUBLIST = "item";
  const PAID_FLAG = "custcol_hpl_itempaid";
  const HEADER_FLAG = "custbody_hpl_paidreleased";
  const EPS = 1e-6;

  const EXCLUDE_ITEMTYPES = new Set([
    "Subtotal",
    "Discount",
    "Description",
    "ShipItem",
    "TaxItem",
    "Group",
    "EndGroup",
    "Markup",
    "OthCharge",
    "Payment",
  ]);

  function afterSubmit(ctx) {
    try {
      const rec =
        ctx.type === ctx.UserEventType.DELETE ? ctx.oldRecord : ctx.newRecord;

      if (rec.type !== record.Type.CASH_SALE) {
        log.debug("Skipping non-cashsale record", {
          type: rec.type,
          id: rec.id,
        });
        return;
      }

      const soId = rec.getValue("createdfrom");
      if (!soId) {
        log.debug("Cash Sale has no Created From SO; nothing to do.", {
          id: rec.id,
        });
        return;
      }

      const budget = sumBudgetForSO(String(soId));
      log.audit("Recompute start (Cash Sale UE)", { soId, budget });
      recomputePaidFlags(String(soId), budget);
    } catch (e) {
      log.error("Cash Sale afterSubmit error", e);
    }
  }

  function sumBudgetForSO(soId) {
    const paidFromInvoices = sumInvoiceAmountPaidForSO(soId);
    const totalFromCashSales = sumCashSaleTotalsForSO(soId);
    const budget = money(paidFromInvoices + totalFromCashSales);
    log.debug("Budget components", {
      soId,
      paidFromInvoices,
      totalFromCashSales,
      budget,
    });
    return budget;
  }

  function sumInvoiceAmountPaidForSO(soId) {
    let paid = 0;
    const s = search.create({
      type: search.Type.INVOICE,
      filters: [
        ["mainline", "is", "T"],
        "and",
        ["createdfrom", "anyof", soId],
        "and",
        ["amountpaid", "greaterthan", 0],
      ],
      columns: [
        search.createColumn({
          name: "amountpaid",
          summary: search.Summary.SUM,
        }),
      ],
    });
    const res = s.run().getRange({ start: 0, end: 1 });
    if (res && res[0]) {
      paid =
        parseFloat(
          res[0].getValue({
            name: "amountpaid",
            summary: search.Summary.SUM,
          })
        ) || 0;
    }
    return money(paid);
  }

  function sumCashSaleTotalsForSO(soId) {
    let total = 0;
    const s = search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["mainline", "is", "T"],
        "and",
        ["type", "anyof", "CashSale"],
        "and",
        ["createdfrom", "anyof", soId],
        "and",
        ["status", "noneof", "Voided"],
      ],
      columns: [
        search.createColumn({ name: "total", summary: search.Summary.SUM }),
      ],
    });
    const res = s.run().getRange({ start: 0, end: 1 });
    if (res && res[0]) {
      total =
        parseFloat(
          res[0].getValue({
            name: "total",
            summary: search.Summary.SUM,
          })
        ) || 0;
    }
    return money(total);
  }

  function recomputePaidFlags(soId, budget) {
    const so = record.load({
      type: record.Type.SALES_ORDER,
      id: soId,
      isDynamic: false,
    });
    const n = so.getLineCount({ sublistId: ITEM_SUBLIST });

    const lines = [];
    let taxableSubtotal = 0;

    for (let i = 0; i < n; i++) {
      const itemType =
        so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: "itemtype",
          line: i,
        }) || "";
      if (EXCLUDE_ITEMTYPES.has(itemType)) continue;

      const qty =
        +so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: "quantity",
          line: i,
        }) || 0;
      const ful =
        +so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: "quantityfulfilled",
          line: i,
        }) || 0;
      const closed = !!so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: "isclosed",
        line: i,
      });
      if (closed || qty <= ful) continue;

      const net =
        +so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: "amount",
          line: i,
        }) || 0;

      const taxable = so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: "istaxable",
        line: i,
      });
      const rateFieldRaw = so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: "taxrate",
        line: i,
      });
      const lineRatePct = parsePct(rateFieldRaw);

      const isTaxable = !(taxable === "F" || taxable === false);
      lines.push({
        line: i,
        net,
        taxable: isTaxable,
        lineRatePct,
        rateFieldRaw,
      });
      if (isTaxable) taxableSubtotal += net;
    }

    const headerRatePct = parsePct(so.getValue("taxrate"));
    const headerTaxTotal = money(+so.getValue("taxtotal") || 0);
    let effectiveHeaderPct = headerRatePct;

    if (
      (!effectiveHeaderPct || effectiveHeaderPct === 0) &&
      headerTaxTotal > 0 &&
      taxableSubtotal > 0
    ) {
      effectiveHeaderPct = (headerTaxTotal / taxableSubtotal) * 100;
    }

    log.audit("Header tax snapshot", {
      soId,
      headerRatePct,
      headerTaxTotal,
      taxableSubtotal: money(taxableSubtotal),
      effectiveHeaderPct: Math.round(effectiveHeaderPct * 1000) / 1000,
    });

    const eligible = [];
    let sumNet = 0,
      sumGross = 0;

    for (const L of lines) {
      let usedSource = "none";
      let taxPct = 0;
      let taxAmt = 0;
      let gross = L.net;

      if (L.taxable) {
        if (L.lineRatePct && L.lineRatePct > 0) {
          usedSource = "line_taxrate";
          taxPct = L.lineRatePct;
          taxAmt = money(L.net * (taxPct / 100));
          gross = money(L.net + taxAmt);
        } else if (effectiveHeaderPct && effectiveHeaderPct > 0) {
          usedSource = headerRatePct
            ? "header_taxrate"
            : "header_taxtotal_derived_pct";
          taxPct = effectiveHeaderPct;
          taxAmt = money(L.net * (taxPct / 100));
          gross = money(L.net + taxAmt);
        } else if (headerTaxTotal > 0 && taxableSubtotal > 0) {
          usedSource = "header_taxtotal_proration";
          taxAmt = money((L.net / taxableSubtotal) * headerTaxTotal);
          gross = money(L.net + taxAmt);
        } else {
          usedSource = "no_tax_info";
        }
      } else {
        usedSource = "nontaxable";
      }

      log.debug("Line tax trace", {
        soId,
        line: L.line,
        net: L.net,
        taxable: L.taxable,
        lineRateRaw: L.rateFieldRaw,
        lineRatePct: L.lineRatePct,
        taxPctUsed: Math.round(taxPct * 1000) / 1000,
        taxAmt,
        gross,
        usedSource,
      });

      eligible.push({ line: L.line, net: L.net, gross });
      sumNet += L.net;
      sumGross += gross;
    }

    const discountTotal = Math.abs(+so.getValue("discounttotal") || 0);
    if (discountTotal > 0 && sumNet > 0) {
      for (const e of eligible) {
        const share = money((e.net / sumNet) * discountTotal);
        e.gross = money(Math.max(0, e.gross - share));
      }
      sumGross = eligible.reduce((a, b) => a + b.gross, 0);
    }

    log.audit("Coverage snapshot", {
      soId,
      eligibleLines: eligible.length,
      sumNet: money(sumNet),
      sumGross: money(sumGross),
      budget,
    });

    let remaining = money(budget);
    let changed = false;

    for (const { line, net, gross } of eligible) {
      const before = remaining;
      const current = !!so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: PAID_FLAG,
        line,
      });
      const should = remaining + EPS >= gross;

      log.debug("Coverage decision", {
        soId,
        line,
        net,
        gross,
        remainingBefore: before,
        willMarkPaid: should,
        wasPaid: current,
      });

      if (should !== current) {
        so.setSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line,
          value: should,
        });
        changed = true;
      }
      if (should) remaining = money(remaining - gross);
    }

    for (let i = 0; i < n; i++) {
      const inEligible = eligible.find((e) => e.line === i) !== undefined;
      if (!inEligible) {
        const cur = !!so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line: i,
        });
        if (cur) {
          so.setSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: PAID_FLAG,
            line: i,
            value: false,
          });
          changed = true;
        }
      }
    }

    const headerChanged = syncHeaderFromLines(so);

    if (changed || headerChanged) {
      so.save({ ignoreMandatoryFields: true, enableSourcing: false });
      log.audit("SO updated", { soId, remainingBudget: remaining });
    } else {
      log.audit("SO unchanged", { soId, remainingBudget: remaining });
    }
  }

  function syncHeaderFromLines(so) {
    const n = so.getLineCount({ sublistId: ITEM_SUBLIST }) || 0;
    let anyPaid = false;

    for (let i = 0; i < n; i++) {
      const v = so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: PAID_FLAG,
        line: i,
      });
      if (v === true || v === "T") {
        anyPaid = true;
        break;
      }
    }

    const currentHeader = !!so.getValue({ fieldId: HEADER_FLAG });
    if (currentHeader !== anyPaid) {
      so.setValue({ fieldId: HEADER_FLAG, value: anyPaid });
      log.debug("Header paidReleased updated", { anyPaid, lineCount: n });
      return true;
    }
    log.debug("Header paidReleased unchanged", { anyPaid, lineCount: n });
    return false;
  }

  function parsePct(v) {
    if (v == null || v === "") return 0;
    const cleaned = String(v).replace("%", "").trim();
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  function money(n) {
    return Math.round((+n || 0) * 100) / 100;
  }

  return { afterSubmit };
});
