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

  const SO_GIVEAWAY_FLAG = "custbody_hpl_giveaway";
  const SO_WARRANTY_FLAG = "custbody_hpl_warranty";

  const NET30_ID = "2";

  const LINE_PAID_AT = "custcol_hpl_line_paid_at";

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
        recomputePaidFlags(soId, budget, 0);
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
        } catch (err) {}
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
          res[0].getValue({ name: "amountpaid", summary: search.Summary.SUM }),
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
            res[0].getValue({ name: "amount", summary: search.Summary.SUM }),
          ) || 0;
        total = amt;
      }
    }
    return money(total);
  }

  function isNet30Terms(so) {
    const termsId = String(so.getValue("terms") || "");
    const termsText = (so.getText("terms") || "").trim();
    return termsId === NET30_ID || /NET\s*30/i.test(termsText);
  }

  function recomputePaidFlags(soId, budget, retryCount) {
    retryCount = retryCount || 0;

    try {
      const so = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });
      const n = so.getLineCount({ sublistId: ITEM_SUBLIST });

      const isGiveaway =
        so.getValue({ fieldId: SO_GIVEAWAY_FLAG }) === true ||
        so.getValue({ fieldId: SO_GIVEAWAY_FLAG }) === "T";
      const isWarranty =
        so.getValue({ fieldId: SO_WARRANTY_FLAG }) === true ||
        so.getValue({ fieldId: SO_WARRANTY_FLAG }) === "T";

      const softMetaByLine = {};

      for (let i = 0; i < n; i++) {
        const groupKeyRaw = so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: SOFT_GROUPKEY,
          line: i,
        });
        const groupKey = (
          groupKeyRaw == null ? "" : String(groupKeyRaw)
        ).trim();

        const childRaw = so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: SOFT_CHILD_FLAG,
          line: i,
        });
        const isSoftChild = childRaw === true || childRaw === "T";
        const isSoftBOM = !!groupKey;
        const isSoftParent = isSoftBOM && !isSoftChild;

        softMetaByLine[i] = { groupKey, isSoftBOM, isSoftChild, isSoftParent };
      }

      const SHIPPING_SKU = "Shipping";
      const itemSkuCache = {};

      function getItemSku(itemId) {
        if (!itemId) return "";
        const key = String(itemId);
        if (itemSkuCache[key] !== undefined) return itemSkuCache[key];

        try {
          const lf = search.lookupFields({
            type: search.Type.ITEM,
            id: itemId,
            columns: ["itemid"],
          });
          const sku = (lf && lf.itemid ? String(lf.itemid) : "").trim();
          itemSkuCache[key] = sku;
          return sku;
        } catch (e) {
          itemSkuCache[key] = "";
          return "";
        }
      }

      function isShippingLine(line) {
        const itemId = so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: "item",
          line,
        });
        return getItemSku(itemId) === SHIPPING_SKU;
      }

      function isEligibleLine(line) {
        const itemType =
          so.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: "itemtype",
            line,
          }) || "";
        if (EXCLUDE_ITEMTYPES.has(itemType)) return false;

        const closed = !!so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: "isclosed",
          line,
        });
        if (closed) return false;

        const meta = softMetaByLine[line];
        if (meta && meta.isSoftChild && meta.isSoftBOM) return false;

        return true;
      }

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

          if (val) {
            const curPaidAtRaw = so.getSublistValue({
              sublistId: ITEM_SUBLIST,
              fieldId: LINE_PAID_AT,
              line,
            });
            const curPaidAt = (
              curPaidAtRaw == null ? "" : String(curPaidAtRaw)
            ).trim();
            if (!curPaidAt) {
              so.setSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: LINE_PAID_AT,
                line,
                value: new Date().toISOString(),
              });
            }
          } else {
            const curPaidAtRaw = so.getSublistValue({
              sublistId: ITEM_SUBLIST,
              fieldId: LINE_PAID_AT,
              line,
            });
            const curPaidAt = (
              curPaidAtRaw == null ? "" : String(curPaidAtRaw)
            ).trim();
            if (curPaidAt) {
              so.setSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: LINE_PAID_AT,
                line,
                value: "",
              });
            }
          }

          changed = true;
        }
      }

      if (isNet30Terms(so)) {
        let changedNet30 = false;

        for (let i = 0; i < n; i++) {
          if (!isEligibleLine(i)) continue;

          const cur = so.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: PAID_FLAG,
            line: i,
          });
          const curPaid = cur === true || cur === "T";
          if (!curPaid) {
            setPaidFlag(i, true);
            changedNet30 = true;
          }
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

          const shouldBePaid = !!parentPaidByGroup[meta.groupKey];
          const cur = so.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: PAID_FLAG,
            line: i,
          });
          const curPaid = cur === true || cur === "T";
          if (curPaid !== shouldBePaid) {
            setPaidFlag(i, shouldBePaid);
            changedNet30 = true;
          }
        }

        const curHeader = !!so.getValue({ fieldId: HEADER_FLAG });
        if (!curHeader) {
          so.setValue({ fieldId: HEADER_FLAG, value: true });
          changedNet30 = true;
        }

        if (changedNet30 || changed) {
          so.setValue({
            fieldId: "custbody_hpl_paid_released_timestamp",
            value: new Date().toISOString(),
          });
          so.save({ ignoreMandatoryFields: true, enableSourcing: false });
          log.audit("Net30 override applied (treated as paid)", {
            soId,
            termsId: String(so.getValue("terms") || ""),
            termsText: (so.getText("terms") || "").trim(),
          });
        } else {
          log.audit("Net30 override: no changes needed", {
            soId,
            termsId: String(so.getValue("terms") || ""),
            termsText: (so.getText("terms") || "").trim(),
          });
        }

        return;
      }

      let prevHadPaidNonShipping = false;
      for (let i = 0; i < n; i++) {
        if (!isEligibleLine(i)) continue;
        const v = so.getSublistValue({
          sublistId: ITEM_SUBLIST,
          fieldId: PAID_FLAG,
          line: i,
        });
        const isPaid = v === true || v === "T";
        if (isPaid && !isShippingLine(i)) {
          prevHadPaidNonShipping = true;
          break;
        }
      }

      function applyShippingNeverAloneGuard() {
        if (prevHadPaidNonShipping) return false;

        let paidEligibleCount = 0;
        let onlyPaidEligibleLine = -1;

        for (let i = 0; i < n; i++) {
          if (!isEligibleLine(i)) continue;

          const v = so.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: PAID_FLAG,
            line: i,
          });
          const isPaid = v === true || v === "T";
          if (!isPaid) continue;

          paidEligibleCount++;
          if (paidEligibleCount === 1) onlyPaidEligibleLine = i;
          if (paidEligibleCount > 1) break;
        }

        if (
          paidEligibleCount === 1 &&
          onlyPaidEligibleLine >= 0 &&
          isShippingLine(onlyPaidEligibleLine)
        ) {
          setPaidFlag(onlyPaidEligibleLine, false);
          log.audit("Shipping-only eligible paid blocked by guard", {
            soId,
            onlyPaidEligibleLine,
            reason:
              "SO had no previous paid non-shipping eligible lines; current eligible-paid would be only Shipping",
          });
          return true;
        }

        return false;
      }

      if (isGiveaway || isWarranty) {
        for (let i = 0; i < n; i++) {
          if (!isEligibleLine(i)) continue;
          setPaidFlag(i, true);
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

        const guardChanged = applyShippingNeverAloneGuard();
        const headerChanged = syncHeaderFromLines(so);

        log.audit("Giveaway/Warranty override applied", {
          soId,
          isGiveaway,
          isWarranty,
          changed,
          guardChanged,
          headerChanged,
        });

        if (changed || guardChanged || headerChanged) {
          so.setValue({
            fieldId: "custbody_hpl_paid_released_timestamp",
            value: new Date().toISOString(),
          });
          so.save({ ignoreMandatoryFields: true, enableSourcing: false });
          log.audit("SO updated (override)", { soId });
        } else {
          log.audit("SO unchanged (override)", { soId });
        }

        return;
      }

      const candidates = [];
      let taxableSubtotal = 0;

      for (let i = 0; i < n; i++) {
        if (!isEligibleLine(i)) continue;

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
          net: L.net,
          gross,
        });
      }

      let remaining = money(budget);

      const totalCandidateGross = money(
        fulfilled.reduce((a, b) => a + b.gross, 0) +
          pending.reduce((a, b) => a + b.gross, 0),
      );
      const soHeaderTotal = money(+so.getValue("total") || 0);
      const fullyPaidThreshold = Math.min(totalCandidateGross, soHeaderTotal);
      const isFullyPaid = remaining + EPS >= fullyPaidThreshold;

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

        function partitionByShipping(list) {
          const nonShipping = [];
          const shipping = [];
          for (const x of list) {
            (isShippingLine(x.line) ? shipping : nonShipping).push(x);
          }
          return { nonShipping, shipping };
        }

        const f = partitionByShipping(fulfilled);
        const p = partitionByShipping(pending);

        cover(f.nonShipping);
        cover(p.nonShipping);
        cover(f.shipping);
        cover(p.shipping);
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

      const guardChanged = applyShippingNeverAloneGuard();
      const headerChanged = syncHeaderFromLines(so);

      log.audit("Coverage snapshot", {
        soId,
        eligibleLines: candidates.length,
        budget,
        remaining,
        guardChanged,
      });

      if (changed || guardChanged || headerChanged) {
        so.setValue({
          fieldId: "custbody_hpl_paid_released_timestamp",
          value: new Date().toISOString(),
        });

        so.save({ ignoreMandatoryFields: true, enableSourcing: false });
        log.audit("SO updated", { soId, remainingBudget: remaining });
      } else {
        log.audit("SO unchanged", { soId, remainingBudget: remaining });
      }
    } catch (e) {
      const isRecordChanged =
        e &&
        (e.name === "RCRD_HAS_BEEN_CHANGED" ||
          e.message === "Record has been changed");

      if (isRecordChanged && retryCount < 1) {
        log.audit("Retrying recompute after record changed", {
          soId,
          retryCount,
        });
        return recomputePaidFlags(soId, budget, retryCount + 1);
      }

      throw e;
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
