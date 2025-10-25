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

      const recType = (
        rec && rec.type ? String(rec.type) : String(ctx.newRecord.type || "")
      ).toLowerCase();

      log.audit("Customer Payment/Deposit UE fired", {
        eventType: ctx.type,
        recType,
        id: rec.id,
      });

      const soIds = getRelatedSOIds(rec, recType);
      if (!soIds.size) {
        log.debug("No related SOs found; nothing to do.", {
          recType,
          id: rec.id,
        });
        return;
      }

      soIds.forEach((soId) => {
        const budget = coverageBudget(soId);
        log.audit("Recompute start (unified budget)", {
          soId,
          totalBudget: budget,
        });
        recomputePaidFlags(soId, budget);
      });
    } catch (e) {
      log.error("UE afterSubmit error", e);
    }
  }

  function getRelatedSOIds(rec, recType) {
    const soIds = new Set();

    if (recType.indexOf("customerpayment") !== -1) {
      const lc = Number(rec.getLineCount({ sublistId: "apply" }) || 0);
      for (let i = 0; i < lc; i++) {
        const applied = !!rec.getSublistValue({
          sublistId: "apply",
          fieldId: "apply",
          line: i,
        });
        if (!applied) continue;

        const invId = rec.getSublistValue({
          sublistId: "apply",
          fieldId: "doc",
          line: i,
        });
        if (!invId) continue;

        try {
          const inv = record.load({
            type: record.Type.INVOICE,
            id: invId,
            isDynamic: false,
          });
          const soId = inv.getValue("createdfrom");
          if (soId) soIds.add(String(soId));
        } catch (err) {
          log.debug("Skipped non-invoice doc on apply line", {
            invId,
            err: err && err.message,
          });
        }
      }
    }

    if (recType.indexOf("customerdeposit") !== -1) {
      const maybeSO =
        rec.getValue({ fieldId: "salesorder" }) ||
        rec.getValue({ fieldId: "createdfrom" });
      if (maybeSO) soIds.add(String(maybeSO));
    }
    if (recType.indexOf("depositapplication") !== -1) {
      collectSOIdsFromApply(rec).forEach((id) => soIds.add(id));
    }

    return soIds;
  }

  function collectSOIdsFromApply(rec) {
    const soIds = new Set();
    const lc = Number(rec.getLineCount({ sublistId: "apply" }) || 0);

    for (let i = 0; i < lc; i++) {
      const applied = !!rec.getSublistValue({
        sublistId: "apply",
        fieldId: "apply",
        line: i,
      });
      if (!applied) continue;

      const docId = rec.getSublistValue({
        sublistId: "apply",
        fieldId: "doc",
        line: i,
      });
      if (!docId) continue;

      let soId = null;
      try {
        const inv = record.load({
          type: record.Type.INVOICE,
          id: docId,
          isDynamic: false,
        });
        soId = inv.getValue("createdfrom");
      } catch (err1) {
        try {
          const cs = record.load({
            type: record.Type.CASH_SALE,
            id: docId,
            isDynamic: false,
          });
          soId = cs.getValue("createdfrom");
        } catch (err2) {
          log.debug("Skipped non-invoice/cashsale doc on apply line", {
            docId,
            err: err2 && err2.message,
          });
        }
      }
      if (soId) soIds.add(String(soId));
    }

    return soIds;
  }

  function coverageBudget(soId) {
    const paidFromInvoices = sumAmountPaidForSO(soId);
    const unappliedDeposits = sumUnappliedDepositsForSO(soId);
    const total = money(paidFromInvoices);
    log.audit("Coverage budget snapshot", {
      soId,
      paidFromInvoices,
      unappliedDeposits,
      total,
    });
    return total;
  }

  function sumAmountPaidForSO(soId) {
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
          res[0].getValue({ name: "amountpaid", summary: search.Summary.SUM })
        ) || 0;
    }
    return money(paid);
  }

  function sumUnappliedDepositsForSO(soId) {
    let total = 0;
    const s = search.create({
      type: "customerdeposit",
      filters: [["mainline", "is", "T"], "and", ["salesorder", "anyof", soId]],
      columns: [
        search.createColumn({
          name: "amountremaining",
          summary: search.Summary.SUM,
        }),
        search.createColumn({ name: "amount", summary: search.Summary.SUM }),
      ],
    });

    const res = s.run().getRange({ start: 0, end: 1 });
    if (res && res[0]) {
      const remStr = res[0].getValue({
        name: "amountremaining",
        summary: search.Summary.SUM,
      });
      const rem = remStr === null || remStr === "" ? NaN : parseFloat(remStr);
      if (isFinite(rem)) {
        total = rem;
      } else {
        const amt =
          parseFloat(
            res[0].getValue({ name: "amount", summary: search.Summary.SUM })
          ) || 0;
        total = amt;
      }
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

    const candidates = [];
    let taxableSubtotal = 0;

    for (let i = 0; i < n; i++) {
      const itemType =
        so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: "itemtype",
          line: i,
        }) || "";
      if (EXCLUDE_ITEMTYPES.has(itemType)) continue;

      const closed = !!so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: "isclosed",
        line: i,
      });
      if (closed) continue;

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

      const isTaxable = !(taxable === "F" || taxable === false);
      candidates.push({
        line: i,
        net,
        isTaxable,
        rateFieldRaw,
        qty,
        ful,
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

    const fulfilled = [];
    const pending = [];

    for (const L of candidates) {
      const lineRatePct = parsePct(L.rateFieldRaw);
      let gross = L.net;

      if (L.isTaxable) {
        if (lineRatePct && lineRatePct > 0) {
          gross = money(L.net + money(L.net * (lineRatePct / 100)));
        } else if (effectiveHeaderPct && effectiveHeaderPct > 0) {
          gross = money(L.net + money(L.net * (effectiveHeaderPct / 100)));
        } else if (headerTaxTotal > 0 && taxableSubtotal > 0) {
          gross = money(
            L.net + money((L.net / taxableSubtotal) * headerTaxTotal)
          );
        }
      }

      const isFulfilled = L.qty <= L.ful;
      (isFulfilled ? fulfilled : pending).push({
        line: L.line,
        net: L.net,
        gross,
      });
    }

    let remaining = money(budget);
    let changed = false;

    function setPaidFlag(line, val) {
      const cur = !!so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: PAID_FLAG,
        line,
      });
      if (cur !== val) {
        so.setSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line,
          value: val,
        });
        changed = true;
      }
    }

    function cover(list) {
      for (const { line, gross } of list) {
        const canCover = remaining + EPS >= gross;
        setPaidFlag(line, canCover);
        if (canCover) remaining = money(remaining - gross);
      }
    }

    cover(fulfilled);
    cover(pending);

    const candidateLines = new Set(candidates.map((c) => c.line));
    for (let i = 0; i < n; i++) {
      if (!candidateLines.has(i)) {
        setPaidFlag(i, false);
      }
    }

    const headerChanged = syncHeaderFromLines(so);

    log.audit("Coverage snapshot", {
      soId,
      eligibleLines: candidates.length,
      budget,
      remaining,
    });

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
