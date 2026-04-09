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
  const FLD_DEP_TOTAL = "custcol_hpl_line_deposit_total";
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
        const budgetInfo = coverageBudget(soId);
        log.audit("Recompute start (budget split)", {
          soId,
          totalBudget: budgetInfo.totalBudget,
          depositAppliedBudget: budgetInfo.depositAppliedBudget,
          normalBudget: budgetInfo.normalBudget,
        });
        recomputePaidFlags(soId, budgetInfo, 0);
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
    const invoiceBreakdown = getInvoicePaymentBreakdownForSO(soId);
    const paidFromInvoices = invoiceBreakdown.totalAmountPaid;
    const depositAppliedBudget = invoiceBreakdown.totalDepositApplied;
    const normalBudget = money(paidFromInvoices - depositAppliedBudget);
    const unappliedDeposits = sumUnappliedDepositsForSO(soId);
    const total = money(paidFromInvoices);

    log.audit("Coverage budget snapshot", {
      soId,
      paidFromInvoices,
      depositAppliedBudget,
      normalBudget,
      unappliedDeposits,
      total,
    });

    log.audit("DEBUG invoice payment breakdown for SO", {
      soId,
      invoices: invoiceBreakdown.invoices,
      totalAmountPaid: invoiceBreakdown.totalAmountPaid,
      totalDepositAppliedPortion: invoiceBreakdown.totalDepositApplied,
      totalNonDepositPortion: invoiceBreakdown.totalNonDepositPaid,
    });

    return {
      totalBudget: total,
      depositAppliedBudget: depositAppliedBudget,
      normalBudget: normalBudget,
      invoices: invoiceBreakdown.invoices,
    };
  }

  function getInvoicePaymentBreakdownForSO(soId) {
    const invoices = [];
    let totalAmountPaid = 0;
    let totalDepositApplied = 0;

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
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "tranid" }),
        search.createColumn({ name: "amountpaid" }),
        search.createColumn({ name: "total" }),
      ],
    });

    const paged = s.runPaged({ pageSize: 1000 });
    paged.pageRanges.forEach((range) => {
      const page = paged.fetch({ index: range.index });
      page.data.forEach((row) => {
        const invoiceId = String(row.getValue({ name: "internalid" }) || "");
        const tranId = String(row.getValue({ name: "tranid" }) || "");
        const amountPaid = money(row.getValue({ name: "amountpaid" }) || 0);
        const invoiceTotal = money(row.getValue({ name: "total" }) || 0);

        const depositApplied = getDepositAppliedForInvoice(invoiceId);
        const nonDepositPaid = Math.max(0, money(amountPaid - depositApplied));

        invoices.push({
          invoiceId,
          tranId,
          total: invoiceTotal,
          amountPaid,
          depositAppliedPortion: depositApplied,
          nonDepositPaidPortion: nonDepositPaid,
        });

        totalAmountPaid = money(totalAmountPaid + amountPaid);
        totalDepositApplied = money(totalDepositApplied + depositApplied);

        log.audit("DEBUG invoice deposit-applied amount", {
          soId,
          invoiceId,
          tranId,
          invoiceTotal,
          amountPaid,
          depositAppliedPortion: depositApplied,
          nonDepositPaidPortion: nonDepositPaid,
        });
      });
    });

    return {
      invoices,
      totalAmountPaid: money(totalAmountPaid),
      totalDepositApplied: money(totalDepositApplied),
      totalNonDepositPaid: Math.max(
        0,
        money(totalAmountPaid - totalDepositApplied),
      ),
    };
  }

  function getDepositAppliedForInvoice(invoiceId) {
    if (!invoiceId) return 0;

    let total = 0;

    try {
      const s = search.create({
        type: search.Type.INVOICE,
        filters: [
          ["internalid", "anyof", invoiceId],
          "and",
          ["mainline", "is", "T"],
        ],
        columns: [
          search.createColumn({
            name: "internalid",
            join: "applyingTransaction",
          }),
          search.createColumn({
            name: "tranid",
            join: "applyingTransaction",
          }),
          search.createColumn({
            name: "type",
            join: "applyingTransaction",
          }),
          search.createColumn({
            name: "amount",
            join: "applyingTransaction",
          }),
        ],
      });

      const rs = s.run().getRange({ start: 0, end: 1000 }) || [];

      for (let i = 0; i < rs.length; i++) {
        const row = rs[i];

        const applyingId = String(
          row.getValue({
            name: "internalid",
            join: "applyingTransaction",
          }) || "",
        );

        const applyingTranId = String(
          row.getValue({
            name: "tranid",
            join: "applyingTransaction",
          }) || "",
        );

        const typeText = String(
          row.getText({
            name: "type",
            join: "applyingTransaction",
          }) || "",
        );

        const typeValue = String(
          row.getValue({
            name: "type",
            join: "applyingTransaction",
          }) || "",
        );

        const rawAmt = money(
          row.getValue({
            name: "amount",
            join: "applyingTransaction",
          }) || 0,
        );
        const amt = Math.abs(rawAmt);

        const typeCombined = (typeText + " " + typeValue).toLowerCase();
        const isDepositApplication =
          typeCombined.indexOf("deposit application") !== -1 ||
          typeCombined.indexOf("depappl") !== -1;

        log.debug("DEBUG applying transaction row", {
          invoiceId,
          applyingId,
          applyingTranId,
          typeText,
          typeValue,
          rawAmount: rawAmt,
          normalizedAmount: amt,
          countedAsDepositApplication: isDepositApplication,
        });

        if (isDepositApplication) {
          total = money(total + amt);
        }
      }

      log.audit("DEBUG deposit application total from applyingTransaction", {
        invoiceId,
        depositAppliedTotal: total,
      });

      return total;
    } catch (e) {
      log.error("DEBUG deposit-applied lookup failed", {
        invoiceId,
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
      return 0;
    }
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

  function recomputePaidFlags(soId, budgetInfo, retryCount) {
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
        const depTotal = money(
          +so.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: FLD_DEP_TOTAL,
            line: i,
          }) || 0,
        );

        const isTaxable = !(taxable === "F" || taxable === false);
        candidates.push({
          line: i,
          net,
          isTaxable,
          rateFieldRaw,
          qty,
          ful,
          depositTotal: depTotal,
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
        const out = {
          line: L.line,
          net: L.net,
          gross,
          depositTotal: Math.max(0, money(L.depositTotal)),
        };
        (isFulfilled ? fulfilled : pending).push(out);
      }

      const totalCandidateGross = money(
        fulfilled.reduce((a, b) => a + b.gross, 0) +
          pending.reduce((a, b) => a + b.gross, 0),
      );
      const soHeaderTotal = money(+so.getValue("total") || 0);
      const fullyPaidThreshold = Math.min(totalCandidateGross, soHeaderTotal);
      const totalBudget = money(budgetInfo.totalBudget || 0);
      let depositBudget = money(budgetInfo.depositAppliedBudget || 0);
      let normalBudget = money(budgetInfo.normalBudget || 0);
      const isFullyPaid = totalBudget + EPS >= fullyPaidThreshold;

      if (isFullyPaid) {
        for (const { line } of fulfilled) setPaidFlag(line, true);
        for (const { line } of pending) setPaidFlag(line, true);
      } else {
        function partitionByShipping(list) {
          const nonShipping = [];
          const shipping = [];
          for (const x of list) {
            (isShippingLine(x.line) ? shipping : nonShipping).push(x);
          }
          return { nonShipping, shipping };
        }

        function filterDepositLines(list) {
          const zero = [];
          const reserved = [];
          for (const x of list) {
            (x.depositTotal > 0 ? reserved : zero).push(x);
          }
          return { zero, reserved };
        }

        const f = partitionByShipping(fulfilled);
        const p = partitionByShipping(pending);

        const fns = filterDepositLines(f.nonShipping);
        const pns = filterDepositLines(p.nonShipping);
        const fs = filterDepositLines(f.shipping);
        const ps = filterDepositLines(p.shipping);

        const reservedAssignByLine = Object.create(null);
        const reservedOrdered = []
          .concat(fns.reserved)
          .concat(pns.reserved)
          .concat(fs.reserved)
          .concat(ps.reserved);

        for (let i = 0; i < reservedOrdered.length; i++) {
          const info = reservedOrdered[i];
          const cap = Math.min(info.depositTotal, info.gross);
          const assign = Math.min(cap, depositBudget);
          const finalAssign = money(assign);
          reservedAssignByLine[info.line] = finalAssign;
          depositBudget = money(depositBudget - finalAssign);
        }

        normalBudget = money(normalBudget + depositBudget);

        const paidByLine = Object.create(null);

        function coverWithNormal(list) {
          for (let i = 0; i < list.length; i++) {
            const info = list[i];
            const reservedAssigned = money(
              reservedAssignByLine[info.line] || 0,
            );
            const remainingNeed = Math.max(
              0,
              money(info.gross - reservedAssigned),
            );
            const canCover = normalBudget + EPS >= remainingNeed;
            paidByLine[info.line] = !!canCover;

            if (canCover) {
              normalBudget = money(normalBudget - remainingNeed);
            }
          }
        }

        const zeroOrdered = []
          .concat(fns.zero)
          .concat(pns.zero)
          .concat(fs.zero)
          .concat(ps.zero);

        const reservedNormalOrdered = []
          .concat(fns.reserved)
          .concat(pns.reserved)
          .concat(fs.reserved)
          .concat(ps.reserved);

        coverWithNormal(zeroOrdered);
        coverWithNormal(reservedNormalOrdered);

        for (let i = 0; i < zeroOrdered.length; i++) {
          setPaidFlag(zeroOrdered[i].line, !!paidByLine[zeroOrdered[i].line]);
        }

        for (let i = 0; i < reservedNormalOrdered.length; i++) {
          const info = reservedNormalOrdered[i];
          const reservedAssigned = money(reservedAssignByLine[info.line] || 0);
          const paid =
            reservedAssigned + EPS >= info.gross || !!paidByLine[info.line];
          setPaidFlag(info.line, paid);
        }

        log.audit("Reserved deposit allocation snapshot", {
          soId,
          depositAppliedBudgetIn: money(budgetInfo.depositAppliedBudget || 0),
          normalBudgetIn: money(budgetInfo.normalBudget || 0),
          reservedAssignByLine,
          overflowReturnedToNormal: depositBudget,
          normalBudgetAfterAllocation: normalBudget,
        });
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
        totalBudget: totalBudget,
        depositAppliedBudget: money(budgetInfo.depositAppliedBudget || 0),
        normalBudgetStart: money(budgetInfo.normalBudget || 0),
        guardChanged,
      });

      if (changed || guardChanged || headerChanged) {
        so.setValue({
          fieldId: "custbody_hpl_paid_released_timestamp",
          value: new Date().toISOString(),
        });

        so.save({ ignoreMandatoryFields: true, enableSourcing: false });
        log.audit("SO updated", { soId });
      } else {
        log.audit("SO unchanged", { soId });
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
        return recomputePaidFlags(soId, budgetInfo, retryCount + 1);
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
