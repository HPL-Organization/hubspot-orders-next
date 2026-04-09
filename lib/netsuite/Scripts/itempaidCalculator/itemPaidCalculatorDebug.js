/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 */
define(["N/record", "N/search", "N/log"], (record, search, log) => {
  const ITEM_SUBLIST = "item";
  const PAID_FLAG = "custcol_hpl_itempaid";
  const HEADER_FLAG = "custbody_hpl_paidreleased";
  const SOFT_CHILD_FLAG = "custcol_hpl_softbom_child";
  const SOFT_GROUPKEY = "custcol_hpl_softbom_groupkey";
  const EPS = 1e-6;

  const DEBUG_SO_ID = "624328";
  const DEBUG_FORCE_RUN = true;
  const DEBUG_VERBOSE_LINES = true;
  const DEBUG_MAX_INVOICE_ROWS = 50;

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
      )
        .toLowerCase()
        .trim();

      log.audit("UE fired (DEBUG build)", {
        eventType: ctx.type,
        recType,
        id: rec && rec.id,
        debugSoId: DEBUG_SO_ID,
        debugForceRun: DEBUG_FORCE_RUN,
      });

      const soIds = getRelatedSOIds(rec, recType);

      if (DEBUG_FORCE_RUN && DEBUG_SO_ID) {
        log.audit("DEBUG: forcing recompute for SO", { soId: DEBUG_SO_ID });
        debugBudgetAndRecompute(DEBUG_SO_ID, {
          triggerRecType: recType,
          triggerRecId: rec && rec.id,
          relatedSoIdsFound: Array.from(soIds),
        });
        return;
      }

      if (!soIds.size) {
        log.debug("No related SOs found; nothing to do.", {
          recType,
          id: rec && rec.id,
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
      log.error("UE afterSubmit error", {
        name: e && e.name,
        message: e && e.message,
        stack: e && e.stack,
      });
    }
  }

  function debugBudgetAndRecompute(soId, extra) {
    log.audit("DEBUG context", extra || {});
    const snap = coverageBudgetDebug(soId);
    log.audit("DEBUG budget result (final)", snap);

    const budget =
      snap && typeof snap.totalBudget === "number" ? snap.totalBudget : 0;

    log.audit("DEBUG recomputePaidFlags start", { soId, budget });
    recomputePaidFlags(soId, budget);
  }

  function getRelatedSOIds(rec, recType) {
    const soIds = new Set();

    if (!rec) return soIds;

    if (recType.indexOf("customerpayment") !== -1) {
      const lc = Number(rec.getLineCount({ sublistId: "apply" }) || 0);
      log.debug("Customer Payment apply lines", { lineCount: lc });

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
        const amt = rec.getSublistValue({
          sublistId: "apply",
          fieldId: "amount",
          line: i,
        });

        log.debug("Customer Payment apply line", {
          i,
          applied,
          invId,
          amount: amt,
        });

        if (!invId) continue;

        try {
          const inv = record.load({
            type: record.Type.INVOICE,
            id: invId,
            isDynamic: false,
          });
          const soId = inv.getValue("createdfrom");
          const invAmountPaid = inv.getValue("amountpaid");
          const invTotal = inv.getValue("total");

          log.debug("Loaded invoice from payment apply", {
            invId,
            createdfrom: soId,
            invAmountPaid,
            invTotal,
          });

          if (soId) soIds.add(String(soId));
        } catch (err) {
          log.debug("Failed loading invoice from customerpayment apply line", {
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
      log.debug("Customer Deposit linkage", {
        salesorder: rec.getValue({ fieldId: "salesorder" }),
        createdfrom: rec.getValue({ fieldId: "createdfrom" }),
      });
      if (maybeSO) soIds.add(String(maybeSO));
    }

    if (recType.indexOf("depositapplication") !== -1) {
      collectSOIdsFromApply(rec).forEach((id) => soIds.add(id));
    }

    if (recType.indexOf("invoice") !== -1) {
      const soId = rec.getValue({ fieldId: "createdfrom" });
      if (soId) soIds.add(String(soId));
    }

    if (recType.indexOf("cashsale") !== -1) {
      const soId = rec.getValue({ fieldId: "createdfrom" });
      if (soId) soIds.add(String(soId));
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
      note: "total intentionally uses ONLY paidFromInvoices in this implementation",
    });
    return total;
  }

  function coverageBudgetDebug(soId) {
    const snap = {
      soId: String(soId),
      invoicesSummarySumAmountPaid: 0,
      invoicesRowSumAmountPaid: 0,
      invoiceRows: [],
      invoiceSearchCount: 0,
      invoiceCreatedFromMismatchCount: 0,
      unappliedDeposits: 0,
      totalBudget: 0,
      warnings: [],
    };

    try {
      const summaryPaid = sumAmountPaidForSO_SummaryOnly(soId);
      snap.invoicesSummarySumAmountPaid = summaryPaid;

      const invRows = listInvoicesForSO(soId);
      snap.invoiceRows = invRows.rows;
      snap.invoiceSearchCount = invRows.count;
      snap.invoiceCreatedFromMismatchCount = invRows.createdFromMismatchCount;

      const rowSum = money(
        invRows.rows.reduce((a, r) => a + (r.amountpaidNum || 0), 0),
      );
      snap.invoicesRowSumAmountPaid = rowSum;

      if (money(summaryPaid) !== money(rowSum)) {
        snap.warnings.push(
          "SUMMARY SUM(amountpaid) != ROW SUM(amountpaid). This can indicate search filter/summary behavior differences or unexpected field values.",
        );
      }

      if (money(summaryPaid) === 0 && rowSum > 0) {
        snap.warnings.push(
          "Summary returned 0 but at least one invoice row shows amountpaid > 0. This is a strong signal the SUMMARY search is not matching what you think.",
        );
      }

      const dep = sumUnappliedDepositsForSO(soId);
      snap.unappliedDeposits = dep;

      snap.totalBudget = money(summaryPaid);

      if (snap.totalBudget === 0) {
        const anyPaidRow = invRows.rows.some((r) => (r.amountpaidNum || 0) > 0);
        if (!anyPaidRow) {
          snap.warnings.push(
            "No invoice rows show amountpaid > 0 for createdfrom=SO. Either the payment is not applied to invoices from this SO, or createdfrom linkage differs.",
          );
        }
        snap.warnings.push(
          "Note: deposits are computed but NOT included in totalBudget (by design in this code). If this SO is only funded via deposits, budget will be 0.",
        );
      }

      log.audit("DEBUG invoices breakdown (first batch)", {
        soId,
        invoiceCount: snap.invoiceSearchCount,
        invoicesSummarySumAmountPaid: snap.invoicesSummarySumAmountPaid,
        invoicesRowSumAmountPaid: snap.invoicesRowSumAmountPaid,
        unappliedDeposits: snap.unappliedDeposits,
        warnings: snap.warnings,
      });

      for (
        let i = 0;
        i < Math.min(snap.invoiceRows.length, DEBUG_MAX_INVOICE_ROWS);
        i++
      ) {
        log.debug("DEBUG invoice row", snap.invoiceRows[i]);
      }
    } catch (e) {
      snap.warnings.push(
        "Exception in coverageBudgetDebug: " + (e && e.message),
      );
      log.error("DEBUG coverageBudgetDebug error", {
        soId,
        name: e && e.name,
        message: e && e.message,
        stack: e && e.stack,
      });
    }

    return snap;
  }

  function sumAmountPaidForSO(soId) {
    return sumAmountPaidForSO_SummaryOnly(soId);
  }

  function sumAmountPaidForSO_SummaryOnly(soId) {
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
    const raw =
      res && res[0]
        ? res[0].getValue({ name: "amountpaid", summary: search.Summary.SUM })
        : null;

    paid = parseFloat(raw) || 0;

    log.audit("DEBUG sumAmountPaidForSO summary", {
      soId,
      rawSummaryValue: raw,
      parsed: paid,
      filter: "mainline=T AND createdfrom=SO AND amountpaid>0",
    });

    return money(paid);
  }

  function listInvoicesForSO(soId) {
    const out = { rows: [], count: 0, createdFromMismatchCount: 0 };

    const s = search.create({
      type: search.Type.INVOICE,
      filters: [["mainline", "is", "T"], "and", ["createdfrom", "anyof", soId]],
      columns: [
        "internalid",
        "tranid",
        "statusref",
        "entity",
        "currency",
        "total",
        "amountpaid",
        "amountremaining",
        "createdfrom",
        "trandate",
      ],
    });

    const rs = s.run();
    let start = 0;
    while (true) {
      const batch = rs.getRange({ start, end: start + 1000 });
      if (!batch || !batch.length) break;

      for (let i = 0; i < batch.length; i++) {
        const r = batch[i];
        const createdFromVal = r.getValue({ name: "createdfrom" });
        const createdFromTxt = r.getText({ name: "createdfrom" });

        const amountpaidRaw = r.getValue({ name: "amountpaid" });
        const amountpaidNum =
          amountpaidRaw === null || amountpaidRaw === ""
            ? 0
            : parseFloat(amountpaidRaw) || 0;

        const row = {
          invoiceId: r.getValue({ name: "internalid" }),
          tranid: r.getValue({ name: "tranid" }),
          statusref: r.getValue({ name: "statusref" }),
          entity:
            r.getText({ name: "entity" }) || r.getValue({ name: "entity" }),
          currency:
            r.getText({ name: "currency" }) || r.getValue({ name: "currency" }),
          trandate: r.getValue({ name: "trandate" }),
          totalRaw: r.getValue({ name: "total" }),
          amountpaidRaw,
          amountpaidNum: money(amountpaidNum),
          amountremainingRaw: r.getValue({ name: "amountremaining" }),
          createdfromValue: createdFromVal,
          createdfromText: createdFromTxt,
        };

        if (String(createdFromVal) !== String(soId))
          out.createdFromMismatchCount++;

        out.rows.push(row);
        out.count++;
        if (out.count >= DEBUG_MAX_INVOICE_ROWS) break;
      }

      if (out.count >= DEBUG_MAX_INVOICE_ROWS) break;
      start += batch.length;
    }

    return out;
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
    let remStr = null;
    let amtStr = null;

    if (res && res[0]) {
      remStr = res[0].getValue({
        name: "amountremaining",
        summary: search.Summary.SUM,
      });
      amtStr = res[0].getValue({ name: "amount", summary: search.Summary.SUM });

      const rem = remStr === null || remStr === "" ? NaN : parseFloat(remStr);
      if (isFinite(rem)) {
        total = rem;
      } else {
        total = parseFloat(amtStr) || 0;
      }
    }

    log.audit("DEBUG deposits summary", {
      soId,
      amountremainingSumRaw: remStr,
      amountSumRaw: amtStr,
      parsed: money(total),
    });

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
    const softMetaByLine = {};
    let taxableSubtotal = 0;

    for (let i = 0; i < n; i++) {
      const groupKeyRaw = so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: SOFT_GROUPKEY,
        line: i,
      });
      const groupKey = (groupKeyRaw == null ? "" : String(groupKeyRaw)).trim();

      const childRaw = so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: SOFT_CHILD_FLAG,
        line: i,
      });
      const isSoftChild = childRaw === true || childRaw === "T";
      const isSoftBOM = !!groupKey;
      const isSoftParent = isSoftBOM && !isSoftChild;

      softMetaByLine[i] = { groupKey, isSoftBOM, isSoftChild, isSoftParent };

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

      if (isSoftChild && isSoftBOM) continue;

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
            L.net + money((L.net / taxableSubtotal) * headerTaxTotal),
          );
        }
      }

      const isFulfilled = L.qty <= L.ful;
      (isFulfilled ? fulfilled : pending).push({
        line: L.line,
        net: money(L.net),
        gross: money(gross),
        qty: L.qty,
        ful: L.ful,
        isTaxable: L.isTaxable,
        lineRatePct: lineRatePct,
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

    const totalCandidateGross = money(
      fulfilled.reduce((a, b) => a + b.gross, 0) +
        pending.reduce((a, b) => a + b.gross, 0),
    );
    const soHeaderTotal = money(+so.getValue("total") || 0);
    const fullyPaidThreshold = Math.min(totalCandidateGross, soHeaderTotal);
    const isFullyPaid = remaining + EPS >= fullyPaidThreshold;

    log.audit("DEBUG recompute snapshot", {
      soId,
      budget,
      remainingStart: remaining,
      taxableSubtotal: money(taxableSubtotal),
      headerRatePct,
      headerTaxTotal,
      effectiveHeaderPct: money(effectiveHeaderPct),
      candidateCount: candidates.length,
      fulfilledCount: fulfilled.length,
      pendingCount: pending.length,
      totalCandidateGross,
      soHeaderTotal,
      fullyPaidThreshold,
      isFullyPaid,
    });

    if (DEBUG_VERBOSE_LINES) {
      for (let i = 0; i < Math.min(fulfilled.length, 80); i++)
        log.debug("DEBUG fulfilled line", fulfilled[i]);
      for (let i = 0; i < Math.min(pending.length, 80); i++)
        log.debug("DEBUG pending line", pending[i]);
    }

    if (isFullyPaid) {
      for (const { line } of fulfilled) setPaidFlag(line, true);
      for (const { line } of pending) setPaidFlag(line, true);
      remaining = money(remaining - fullyPaidThreshold);
    } else {
      function cover(list) {
        for (const { line, gross } of list) {
          const canCover = remaining + EPS >= gross;
          setPaidFlag(line, canCover);
          if (canCover) remaining = money(remaining - gross);
        }
      }
      cover(fulfilled);
      cover(pending);
    }

    const candidateLines = new Set(candidates.map((c) => c.line));
    for (let i = 0; i < n; i++) {
      if (candidateLines.has(i)) continue;
      const meta = softMetaByLine[i];
      if (meta && meta.isSoftChild && meta.isSoftBOM) continue;
      setPaidFlag(i, false);
    }

    const parentPaidByGroup = {};
    for (let i = 0; i < n; i++) {
      const meta = softMetaByLine[i];
      if (!meta || !meta.isSoftParent || !meta.groupKey) continue;
      const v = so.getSublistValue({
        sublistId: ITEM_SUBLIST,
        fieldId: PAID_FLAG,
        line: i,
      });
      const isPaid = v === true || v === "T";
      if (isPaid) parentPaidByGroup[meta.groupKey] = true;
    }

    for (let i = 0; i < n; i++) {
      const meta = softMetaByLine[i];
      if (!meta || !meta.isSoftChild || !meta.groupKey) continue;
      setPaidFlag(i, !!parentPaidByGroup[meta.groupKey]);
    }

    const headerChanged = syncHeaderFromLines(so);

    log.audit("Coverage snapshot (end)", {
      soId,
      eligibleLines: candidates.length,
      budget,
      remainingEnd: remaining,
      changed,
      headerChanged,
    });

    if (changed || headerChanged) {
      so.setValue({
        fieldId: "custbody_hpl_paid_released_timestamp",
        value: new Date().toISOString(),
      });

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
