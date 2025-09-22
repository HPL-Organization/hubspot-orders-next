/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/ui/serverWidget",
  "N/search",
  "N/record",
  "N/url",
  "N/https",
  "N/runtime",
], function (ui, search, record, url, https, runtime) {
  const DONE = ["COMPLETED", "COMPLETE", "DONE", "CLOSED"];
  const RL_VALIDATE_SCRIPT_ID = "1275";
  const RL_VALIDATE_DEPLOY_ID = "1";
  const RL_SUBMIT_SCRIPT_ID = "1220";
  const RL_SUBMIT_DEPLOY_ID = "1";
  function onRequest(ctx) {
    const soId = (ctx.request.parameters.so || "").trim();
    const form = ui.createForm({ title: "Unwind Related" });
    if (!soId) {
      form.addField({
        id: "msg",
        type: ui.FieldType.INLINEHTML,
        label: " ",
      }).defaultValue =
        '<div style="color:#b00020">Missing Sales Order ID</div>';
      ctx.response.writePage(form);
      return;
    }
    const soTranId = getSoTranId(soId);
    const soLocId = getSoLocationId(soId);
    const invRows = findInvoicesForSO(soId).map((inv) =>
      processInvoice(inv.id, inv.tranid)
    );
    const picks = loadPickTasks(Number(soId));
    const isDone = (t) =>
      DONE.some((d) => (t || "").toUpperCase().indexOf(d) >= 0);
    const doneLines = picks.filter(
      (p) => isDone(p.status) && (p.qtyPicked || 0) > 0
    );
    const openLines = picks.filter((p) => !isDone(p.status));
    const waveIds = uniqueNumbers(
      doneLines.map((l) => l.waveId).filter(Boolean)
    );
    const waveNumberMap = findWaveNumbers(waveIds);
    const waveDisplay = waveIds.length
      ? waveIds
          .map(
            (id) => `${id}${waveNumberMap[id] ? ` (${waveNumberMap[id]})` : ""}`
          )
          .join(", ")
      : "—";
    const soIndex = buildSoIndexViaTransactionSearch(Number(soId));
    const otIndex = buildOpenTaskIndex(doneLines.map((l) => l.pickTaskId));
    for (const ln of doneLines) {
      resolvePickLine(ln, soIndex, otIndex);
    }
    let reverseBlock = "";
    if (
      ctx.request.method === "POST" &&
      ctx.request.parameters.action === "reverse"
    ) {
      const validateLogs = [];
      const submitResults = [];
      const warehouseLocationId = String(Number(soLocId) || "");
      const soTotalsBefore = getSoPickCommitTotals(Number(soId));
      const attempts = buildValidateBodies({
        warehouseLocationId,
        soId: Number(soId),
        soTranId: String(soTranId || ""),
        waveIds,
        waveNumberMap,
      });
      let accepted = null,
        acceptedBody = null;
      for (const body of attempts) {
        const res = https.requestRestlet({
          scriptId: RL_VALIDATE_SCRIPT_ID,
          deploymentId: RL_VALIDATE_DEPLOY_ID,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        let ok = false,
          parsed = null;
        try {
          parsed = JSON.parse(res.body || "{}");
          ok = !!(
            parsed.isValid === true ||
            parsed.valid === true ||
            (parsed.result && parsed.result.isValid === true)
          );
        } catch (_) {}
        validateLogs.push({ request: body, code: res.code, body: res.body });
        if (res.code >= 200 && res.code < 300 && ok) {
          accepted = body;
          acceptedBody = parsed;
          break;
        }
      }
      if (!accepted) {
        reverseBlock = `<div style="margin-top:8px"><div style="color:#b00020;font-weight:600">Validate not accepted by WMS.</div><pre style="white-space:pre-wrap">${h(
          JSON.stringify(validateLogs, null, 2)
        )}</pre></div>`;
      } else {
        const linesByWave = groupBy(doneLines, (l) => String(l.waveId || ""));
        const wavesToProcess = waveIds.length ? waveIds : [null];
        for (const wId of wavesToProcess) {
          const linesForWave = wId ? linesByWave[String(wId)] || [] : doneLines;
          for (const ln of linesForWave) {
            const resolvedTli = Number(ln.transactionLineId || 0) || 0;
            const submitPayload = buildSubmitBody(
              Object.assign({}, ln, {
                transactionLineIdResolved: resolvedTli,
                lineUniqueKeyResolved: ln.lineUniqueKey || null,
                transactionLineUniqueKey: ln.lineUniqueKey
                  ? String(ln.lineUniqueKey)
                  : null,
              }),
              Number(soId),
              warehouseLocationId,
              wId,
              waveNumberMap[wId] || null,
              soTranId || null
            );
            const sres = https.requestRestlet({
              scriptId: RL_SUBMIT_SCRIPT_ID,
              deploymentId: RL_SUBMIT_DEPLOY_ID,
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(submitPayload),
            });
            submitResults.push({
              pickTaskId: ln.pickTaskId,
              waveId: wId || null,
              step: "reverseConfirmation",
              code: sres.code,
              body: sres.body,
              preview: trimPreview(submitPayload),
            });
            const pages = [
              "page_reversePicks_pickTaskComplete",
              "page_pickTaskComplete",
              "page_reversePicks_submit",
              "page_reversePicks_confirm",
              "page_reversePicks_done",
              "page_picktaskcomplete",
            ];
            for (const pg of pages) {
              const cp = buildCompleteBody(
                ln,
                Number(soId),
                warehouseLocationId,
                wId,
                waveNumberMap[wId] || null,
                soTranId || null,
                pg
              );
              const cres = https.requestRestlet({
                scriptId: RL_SUBMIT_SCRIPT_ID,
                deploymentId: RL_SUBMIT_DEPLOY_ID,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(cp),
              });
              submitResults.push({
                pickTaskId: ln.pickTaskId,
                waveId: wId || null,
                step: pg,
                code: cres.code,
                body: cres.body,
                preview: trimPreview(cp),
              });
            }
          }
        }
        const picksAfter = loadPickTasks(Number(soId));
        const doneAfter = picksAfter.filter(
          (p) =>
            DONE.some((d) => (p.status || "").toUpperCase().indexOf(d) >= 0) &&
            (p.qtyPicked || 0) > 0
        );
        const soTotalsAfter = getSoPickCommitTotals(Number(soId));
        const wmsReverseRows = listWmsReverseRows(Number(soId), waveIds);
        reverseBlock = `<div style="margin-top:8px"><div style="font-weight:600">Validate OK</div><pre style="white-space:pre-wrap">${h(
          JSON.stringify(
            { acceptedValidate: { request: accepted, response: acceptedBody } },
            null,
            2
          )
        )}</pre><div style="font-weight:600;margin-top:6px">Submit results</div><pre style="white-space:pre-wrap">${h(
          JSON.stringify(submitResults, null, 2)
        )}</pre><div style="margin-top:10px;padding:10px;border:1px solid #e5e7eb;border-radius:10px"><div style="font-weight:600">Post-reverse snapshot</div><pre style="white-space:pre-wrap">${h(
          JSON.stringify(
            {
              completedBefore: doneLines.length,
              completedAfter: doneAfter.length,
              salesOrderTotalsBefore: soTotalsBefore,
              salesOrderTotalsAfter: soTotalsAfter,
              wmsReverseRows,
            },
            null,
            2
          )
        )}</pre></div></div>`;
      }
    } else {
      form.addSubmitButton({ label: "Reverse Completed Picks" });
      form.addField({
        id: "action",
        label: " ",
        type: ui.FieldType.INLINEHTML,
      }).defaultValue = "";
    }
    const soUrl = url.resolveRecord({
      recordType: record.Type.SALES_ORDER,
      recordId: soId,
    });
    const deepDiag = buildDeepDiagnostics(doneLines, soIndex, otIndex);
    form.addField({
      id: "out",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = render(
      invRows,
      soId,
      soTranId,
      soLocId,
      openLines,
      doneLines,
      reverseBlock,
      waveDisplay,
      deepDiag
    );
    form.addField({
      id: "back",
      type: ui.FieldType.INLINEHTML,
      label: " ",
    }).defaultValue = `<div style="margin-top:10px"><a href="${soUrl}">Back to Sales Order</a></div>`;
    ctx.response.writePage(form);
  }
  function resolvePickLine(ln, soIndex, otIndex) {
    const ot = otIndex.byPickTask[String(ln.pickTaskId)] || {};
    const luk = firstString([
      ot.lineuniquekey,
      ot.lineUniqueKey,
      ot.line_uk,
      ot.so_line_uk,
      ot.custrecord_wmsse_lineuniquekey,
      ot.custrecord_wms_task_line_uk,
    ]);
    const lineText = firstString([
      ot.line,
      ot.so_line,
      ot.custrecord_wmsse_line,
      ot.custrecord_wms_task_line,
    ]);
    if (luk && soIndex.byLUK[luk]) {
      ln.displayLine = soIndex.byLUK[luk];
      ln.lineUniqueKey = luk;
      return;
    }
    if (lineText) {
      ln.displayLine = String(lineText);
      ln.lineUniqueKey = luk || null;
      return;
    }
    const item = ln.itemId ? String(ln.itemId) : null;
    if (item) {
      const list = soIndex.byItem[item] || [];
      const used = soIndex.assignedByItem[item] || 0;
      if (list.length > used) {
        const pick = list[used];
        soIndex.assignedByItem[item] = used + 1;
        ln.displayLine = String(pick.line);
        ln.lineUniqueKey = pick.lineuniquekey || null;
        return;
      }
    }
  }
  function buildSoIndexViaTransactionSearch(soId) {
    const meta = {
      source: "transaction-search",
      ok: false,
      err: null,
      role: runtime.getCurrentUser().role,
      time: new Date().toISOString(),
    };
    const byItem = {},
      byLUK = {},
      rows = [],
      assignedByItem = {};
    try {
      const s = search.create({
        type: "transaction",
        filters: [
          ["type", "anyof", "SalesOrd"],
          "AND",
          ["internalid", "anyof", String(soId)],
          "AND",
          ["mainline", "is", "F"],
        ],
        columns: [
          search.createColumn({ name: "line" }),
          search.createColumn({ name: "lineuniquekey" }),
          search.createColumn({ name: "item" }),
        ],
      });
      s.run().each((r) => {
        const item = r.getValue("item");
        const line = r.getValue("line");
        const luk = r.getValue("lineuniquekey");
        if (!item) return true;
        const nItem = Number(item);
        if (isNaN(nItem) || nItem <= 0) return true;
        const rec = {
          item: String(item),
          line: String(line),
          lineuniquekey: luk ? String(luk) : null,
        };
        rows.push(rec);
        if (!byItem[rec.item]) byItem[rec.item] = [];
        byItem[rec.item].push(rec);
        if (rec.lineuniquekey) byLUK[rec.lineuniquekey] = rec.line;
        return true;
      });
      for (const k of Object.keys(byItem)) {
        byItem[k] = byItem[k].sort((a, b) => Number(a.line) - Number(b.line));
      }
      meta.ok = true;
      meta.rowCount = rows.length;
    } catch (e) {
      meta.err = String(e && e.message ? e.message : e);
    }
    return { byItem, byLUK, rows, meta, assignedByItem };
  }
  function buildOpenTaskIndex(pickTaskIds) {
    const meta = {
      source: "wms-open-task-search",
      ok: true,
      err: null,
      time: new Date().toISOString(),
    };
    const byPickTask = {};
    try {
      if (pickTaskIds && pickTaskIds.length) {
        const rs1 =
          search
            .create({
              type: "customrecord_wmsse_trn_opentask",
              filters: [
                [
                  "custrecord_wmsse_picktask_ref",
                  "anyof",
                  pickTaskIds.map(String),
                ],
              ],
              columns: [
                "internalid",
                "custrecord_wmsse_picktask_ref",
                "custrecord_wmsse_line",
                "custrecord_wmsse_lineuniquekey",
              ],
            })
            .run()
            .getRange({ start: 0, end: 1000 }) || [];
        for (const r of rs1) {
          const pt = r.getValue("custrecord_wmsse_picktask_ref");
          if (!pt) continue;
          byPickTask[String(pt)] = {
            line: r.getValue("custrecord_wmsse_line"),
            lineuniquekey: r.getValue("custrecord_wmsse_lineuniquekey"),
          };
        }
      }
    } catch (e) {}
    try {
      if (pickTaskIds && pickTaskIds.length) {
        const rs2 =
          search
            .create({
              type: "customrecord_wms_open_task",
              filters: [
                [
                  "custrecord_wms_task_picktask",
                  "anyof",
                  pickTaskIds.map(String),
                ],
              ],
              columns: [
                "internalid",
                "custrecord_wms_task_picktask",
                "custrecord_wms_task_line",
                "custrecord_wms_task_line_uk",
              ],
            })
            .run()
            .getRange({ start: 0, end: 1000 }) || [];
        for (const r of rs2) {
          const pt = r.getValue("custrecord_wms_task_picktask");
          if (!pt) continue;
          const prev = byPickTask[String(pt)] || {};
          const line = prev.line || r.getValue("custrecord_wms_task_line");
          const line_uk =
            prev.lineuniquekey || r.getValue("custrecord_wms_task_line_uk");
          byPickTask[String(pt)] = { line: line, lineuniquekey: line_uk };
        }
      }
    } catch (e) {}
    return { byPickTask, meta };
  }
  function buildValidateBodies({
    warehouseLocationId,
    soId,
    soTranId,
    waveIds,
    waveNumberMap,
  }) {
    const bodies = [];
    const base = () => ({
      headers: { "Content-Type": "application/json" },
      data: {},
      params: { warehouseLocationId },
    });
    if (soTranId)
      bodies.push(
        mix(base(), {
          params: {
            transactionType: "SalesOrder",
            transactionNumber: String(soTranId),
            source: "emulator",
            page_id: "page_reversePicks_orderValidate",
          },
        })
      );
    bodies.push(
      mix(base(), {
        params: {
          transactionType: "SalesOrder",
          orderId: Number(soId),
          source: "emulator",
          page_id: "page_reversePicks_orderValidate",
        },
      })
    );
    bodies.push(
      mix(base(), {
        params: {
          transactionType: "SalesOrder",
          transactionId: Number(soId),
          source: "emulator",
          page_id: "page_reversePicks_orderValidate",
        },
      })
    );
    for (const wid of waveIds || []) {
      const wno = waveNumberMap[wid];
      bodies.push(
        mix(base(), {
          params: {
            transactionType: "Wave",
            transactionId: Number(wid),
            source: "emulator",
            page_id: "page_reversePicks_orderValidate",
          },
        })
      );
      if (wno)
        bodies.push(
          mix(base(), {
            params: {
              transactionType: "Wave",
              transactionNumber: String(wno),
              source: "emulator",
              page_id: "page_reversePicks_orderValidate",
            },
          })
        );
      bodies.push(
        mix(base(), {
          params: {
            transactionType: "SalesOrder",
            waveId: Number(wid),
            source: "emulator",
            page_id: "page_reversePicks_orderValidate",
          },
        })
      );
      if (wno)
        bodies.push(
          mix(base(), {
            params: {
              transactionType: "SalesOrder",
              waveNumber: String(wno),
              source: "emulator",
              page_id: "page_reversePicks_orderValidate",
            },
          })
        );
    }
    return bodies;
  }
  function buildSubmitBody(
    line,
    soId,
    warehouseLocationId,
    waveId,
    waveNumber,
    soTranId
  ) {
    const txType = waveId ? "Wave" : "SalesOrder";
    const tli =
      Number(line.transactionLineIdResolved || line.transactionLineId || 0) ||
      0;
    const luk = line.lineUniqueKeyResolved || line.lineUniqueKey || null;
    const forcedLineNumber = line.displayLine ? String(line.displayLine) : "1";
    const otId = findCompletedOpenTaskIdForPickTask(Number(line.pickTaskId));
    return {
      headers: { "Content-Type": "application/json" },
      data: {},
      params: {
        page_id: "page_reversePicks_reverseConfirmation",
        warehouseLocationId: String(warehouseLocationId || ""),
        transactionType: txType,
        orderId: String(soId),
        transactionInternalId: Number(soId),
        transactionNumber: String(soTranId || ""),
        waveId: waveId ? Number(waveId) : null,
        waveNumber: waveNumber ? String(waveNumber) : null,
        pickTaskId: String(line.pickTaskId),
        pickTaskID: Number(line.pickTaskId),
        pickTaskLineStatus: "DONE",
        pickTaskLineNumber: forcedLineNumber,
        itemId: String(line.itemId || ""),
        pickItemId: Number(line.itemId || 0),
        itemType: line.itemType || "",
        pickQty: Number(line.qtyPicked || 0),
        reversedQuantity: String(Number(line.qtyPicked || 0)),
        notReversedQtyinPickTask: Number(line.qtyPicked || 0),
        quantityToBeReversedForPartialPick: Number(line.qtyPicked || 0),
        transactionLineId: tli,
        transactionLine: tli,
        transactionLineInternalId: tli,
        transactionLineUniqueKey: luk ? String(luk) : null,
        lineUniqueKey: luk ? String(luk) : null,
        pickBinId: String(line.fromBinId || ""),
        pickingBin: line.fromBinName || "",
        scannedSerials: line.serials || [],
        invDetailInfo: buildInvDetailInfo(line),
        transactionUomName: line.uomName || "Each",
        transactionUomConversionRate: 1,
        transactionuomValue: 1,
        barcodeQuantity: [{ value: Number(line.qtyPicked || 0), unit: 1 }],
        tallyscanitem: line.itemDisplay || "",
        tallyScanAction: "tallyScanAction",
        enterQty: Number(line.qtyPicked || 0),
        scannedQuantityInEach: Number(line.qtyPicked || 0),
        remainingLineItemqty: Number(line.qtyPicked || 0),
        lineItemRemainingQuantity: Number(line.qtyPicked || 0),
        totalPickedQuantity: 0,
        statusText: "Good",
        lotQtyStatusString: "Good",
        unitstype: 1,
        qtyUomSelection: [
          {
            pluralname: line.uomName || "Each",
            baseunit: true,
            unitname: line.uomName || "Each",
            inuse: "T",
            abbreviation: line.uomAbbrev || "EA",
            conversionrate: 1,
            pluralabbreviation: line.uomAbbrev || "EA",
            unit: "1",
            value: String(line.qtyPicked || 0),
          },
        ],
        isTallyScanRequired: true,
        locUseBinsFlag: true,
        isZonePickingEnabled: false,
        transaction: waveId ? "wave" : "order",
        page_id_2: "page_singleOrderPicking_quantityScan",
        stockUomConversionRate: 1,
        inventoryDetailLotOrSerial: null,
        pickStatusInternalId: "1",
        isReverseEntirePickTaskLine: true,
        isReverse: true,
        reversePick: true,
        action: "reverse",
        openTaskId: otId,
        openTaskInternalId: otId,
        opentaskid: otId,
        openTask: otId,
        trnOpenTaskId: otId,
      },
    };
  }
  function buildCompleteBody(
    line,
    soId,
    warehouseLocationId,
    waveId,
    waveNumber,
    soTranId,
    pageId
  ) {
    const txType = waveId ? "Wave" : "SalesOrder";
    const forcedLineNumber = line.displayLine ? String(line.displayLine) : "1";
    return {
      headers: { "Content-Type": "application/json" },
      data: {},
      params: {
        page_id: pageId,
        warehouseLocationId: String(warehouseLocationId || ""),
        transactionType: txType,
        orderId: String(soId),
        transactionInternalId: Number(soId),
        transactionNumber: String(soTranId || ""),
        waveId: waveId ? Number(waveId) : null,
        waveNumber: waveNumber ? String(waveNumber) : null,
        pickTaskId: String(line.pickTaskId),
        pickTaskID: Number(line.pickTaskId),
        pickTaskLineNumber: forcedLineNumber,
        confirm: "submit",
        isReverse: true,
        reversePick: true,
        action: "reverse",
      },
    };
  }
  function loadPickTasks(soId) {
    const out = [];
    const rs =
      search
        .create({
          type: "picktask",
          filters: [["transaction.internalid", "anyof", soId]],
          columns: ["internalid", "status"],
        })
        .run()
        .getRange({ start: 0, end: 1000 }) || [];
    for (const r of rs) {
      const id = Number(r.getValue("internalid"));
      const status = String(r.getText("status") || r.getValue("status") || "");
      const row = {
        pickTaskId: id,
        status,
        qtyPicked: 0,
        fromBinId: null,
        fromBinName: null,
        stagingBinId: null,
        itemId: null,
        itemDisplay: null,
        inventoryNumberId: null,
        lineUniqueKey: null,
        waveId: null,
        waveNumber: null,
        lineNumber: null,
        transactionLineId: null,
        itemType: null,
        uomName: "Each",
        uomAbbrev: "EA",
        serials: [],
        soTranId: null,
      };
      try {
        const pt = record.load({ type: "picktask", id, isDynamic: false });
        row.qtyPicked =
          firstNumber([
            pt.getValue("totalpickedquantity"),
            pt.getValue("pickedquantity"),
            pt.getValue("quantitypicked"),
          ]) || 0;
        row.fromBinId =
          orNull(pt.getValue("bin")) || orNull(pt.getValue("frombin"));
        row.fromBinName =
          getTextSafe(pt, "bin") || getTextSafe(pt, "frombin") || "";
        row.stagingBinId = orNull(pt.getValue("stagingbin"));
        row.itemId = orNull(pt.getValue("item"));
        row.itemDisplay = getTextSafe(pt, "item") || "";
        row.inventoryNumberId =
          orNull(pt.getValue("inventorynumber")) ||
          orNull(pt.getValue("inventorynumberid"));
        row.waveId = firstNumber([
          pt.getValue("waveid"),
          pt.getValue("wave"),
          pt.getValue("custrecord_wmsse_waveid"),
          pt.getValue("custrecord_wms_waveid"),
        ]);
        row.waveNumber = firstString([
          pt.getValue("wavenumber"),
          pt.getValue("custrecord_wmsse_waveno"),
          pt.getValue("custrecord_wms_wavenumber"),
        ]);
      } catch (_) {}
      out.push(row);
    }
    try {
      record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });
    } catch (_) {}
    return out;
  }
  function listWmsReverseRows(soId, waveIds) {
    const out = { trn_opentask: [], open_task: [] };
    try {
      const s1 =
        search
          .create({
            type: "customrecord_wmsse_trn_opentask",
            filters: [["custrecord_wmsse_ordno", "anyof", String(soId)]],
            columns: [
              "internalid",
              "name",
              "custrecord_wmsse_wms_status",
              "custrecord_wmsse_wms_location",
              "custrecord_wmsse_wms_wave",
            ],
          })
          .run()
          .getRange({ start: 0, end: 50 }) || [];
      for (const r of s1) {
        out.trn_opentask.push({
          id: r.getValue("internalid"),
          name: r.getValue("name"),
          status: r.getValue("custrecord_wmsse_wms_status"),
          wave: r.getValue("custrecord_wmsse_wms_wave"),
        });
      }
    } catch (_) {}
    try {
      const s2 =
        search
          .create({
            type: "customrecord_wms_open_task",
            filters: [["custrecord_wms_task_so", "anyof", String(soId)]],
            columns: [
              "internalid",
              "name",
              "custrecord_wms_task_status",
              "custrecord_wms_task_wave",
            ],
          })
          .run()
          .getRange({ start: 0, end: 50 }) || [];
      for (const r of s2) {
        out.open_task.push({
          id: r.getValue("internalid"),
          name: r.getValue("name"),
          status: r.getValue("custrecord_wms_task_status"),
          wave: r.getValue("custrecord_wms_task_wave"),
        });
      }
    } catch (_) {}
    return out;
  }
  function getSoPickCommitTotals(soId) {
    let picked = 0,
      committed = 0;
    try {
      const so = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });
      const n = so.getLineCount({ sublistId: "item" });
      for (let i = 0; i < n; i++) {
        const qp = Number(
          so.getSublistValue({
            sublistId: "item",
            fieldId: "quantitypicked",
            line: i,
          }) || 0
        );
        const qc = Number(
          so.getSublistValue({
            sublistId: "item",
            fieldId: "quantitycommitted",
            line: i,
          }) || 0
        );
        picked += qp;
        committed += qc;
      }
    } catch (_) {}
    return { quantityPicked: picked, quantityCommitted: committed };
  }
  function render(
    invRows,
    soId,
    soTranId,
    soLocId,
    openLines,
    doneLines,
    reverseBlock,
    waveDisplay,
    deepDiag
  ) {
    const invBlocks = invRows
      .map(
        (r) => `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:8px 0">
        <div><b>Invoice:</b> ${h(r.invoiceTranId || r.invoiceId)}</div>
        <div>Payments unapplied: ${
          r.paymentsUnapplied.length
            ? r.paymentsUnapplied.map(h).join(", ")
            : "—"
        }</div>
        <div>Deposit applications deleted: ${
          r.depositAppsDeleted.length
            ? r.depositAppsDeleted.map(h).join(", ")
            : "—"
        }</div>
        <div>${
          r.deletedInvoice
            ? '<span style="color:#047857"><b>Invoice deleted</b></span>'
            : "Invoice kept"
        }</div>
      </div>
    `
      )
      .join("");
    const pickBlk = `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:8px 0">
        <div><b>Pick Tasks (SO ${h(soTranId || soId)}):</b></div>
        <div>Open: ${openLines.length}${
      openLines.length
        ? ` — ${h(
            openLines
              .slice(0, 5)
              .map((l) => l.pickTaskId)
              .join(" · ")
          )}`
        : ""
    }</div>
        <div>Completed: ${doneLines.length}${
      doneLines.length
        ? ` — ${h(
            doneLines
              .slice(0, 5)
              .map((l) => l.pickTaskId)
              .join(" · ")
          )}`
        : ""
    }</div>
      </div>
    `;
    const diagRows = doneLines.map((l) => ({
      pickTaskId: l.pickTaskId,
      status: l.status,
      waveId: l.waveId,
      waveNumber: l.waveNumber,
      pt_lineNumber: l.lineNumber || null,
      so_lineResolved: l.displayLine || null,
      lineUniqueKey: l.lineUniqueKey || null,
      transactionLineId: l.transactionLineId || null,
      itemId: l.itemId || null,
      fromBinName: l.fromBinName || null,
    }));
    const diagnosticsBlock = `
      <details style="margin-top:10px">
        <summary style="cursor:pointer">Diagnostics: pick ↔ SO line mapping</summary>
        <pre style="white-space:pre-wrap">${h(
          JSON.stringify(diagRows, null, 2)
        )}</pre>
      </details>
      <details style="margin-top:10px">
        <summary style="cursor:pointer">Deep diagnostics</summary>
        <pre style="white-space:pre-wrap">${h(
          JSON.stringify(deepDiag, null, 2)
        )}</pre>
      </details>
    `;
    const completedIdsWithLines = doneLines.length
      ? h(
          doneLines
            .map((l) => `${l.pickTaskId} (line ${l.displayLine || "?"})`)
            .join(", ")
        )
      : "(none)";
    const reverseUi = `
      <div style="margin-top:10px;padding:10px;border:1px dashed #9ca3af;border-radius:10px">
        <div style="font-weight:600;margin-bottom:6px">Reverse Picks</div>
        <div>Location: ${
          soLocId
            ? h(String(soLocId))
            : '<span style="color:#b00020">None</span>'
        }</div>
        <div>Waves: ${h(waveDisplay)}</div>
        <div>Completed PickTask IDs: ${completedIdsWithLines}</div>
        <form method="POST">
          <input type="hidden" name="so" value="${h(soId)}"/>
          <input type="hidden" name="action" value="reverse"/>
          <button type="submit" ${
            doneLines.length && soLocId ? "" : "disabled"
          } style="padding:6px 10px;border:1px solid #1d4ed8;border-radius:8px;background:#1d4ed8;color:#fff;cursor:pointer">Reverse Completed Picks</button>
        </form>
        ${reverseBlock || ""}
        ${diagnosticsBlock}
      </div>
    `;
    return `
      <div style="font-family:system-ui,Arial,sans-serif">
        <h2 style="margin:0 0 8px 0">Unwind Related</h2>
        <div>Sales Order: <b>${h(soId)}</b> ${
      soTranId ? `<span style="color:#6b7280">(${h(soTranId)})</span>` : ""
    }</div>
        <div style="color:#4b5563;margin:8px 0">Invoices handled; Pick lines detected; Reverse picks via WMS validate → submit (server-side).</div>
        ${
          invRows.length ? invBlocks : "No invoices found for this Sales Order."
        }
        ${pickBlk}
        ${reverseUi}
      </div>
    `;
  }
  function buildDeepDiagnostics(doneLines, soIndex, otIndex) {
    const soTable = soIndex.rows.map((x) => ({
      item: x.item,
      line: x.line,
      lineuniquekey: x.lineuniquekey,
    }));
    const ptRaw = doneLines.map((l) => ({
      pickTaskId: l.pickTaskId,
      status: l.status,
      waveId: l.waveId,
      displayLine: l.displayLine || null,
      itemId: l.itemId || null,
      lineUniqueKey: l.lineUniqueKey || null,
      otLine: (otIndex.byPickTask[String(l.pickTaskId)] || {}).line || null,
      otLineUK:
        (otIndex.byPickTask[String(l.pickTaskId)] || {}).lineuniquekey || null,
    }));
    const meta = {
      soIndex: soIndex.meta,
      otIndex: otIndex.meta,
      role: runtime.getCurrentUser().role,
      time: new Date().toISOString(),
    };
    return { meta, salesOrderLines: soTable, pickTaskRaw: ptRaw };
  }
  function findWaveNumbers(waveIds) {
    const map = {};
    if (!waveIds || !waveIds.length) return map;
    try {
      const rs =
        search
          .create({
            type: "transaction",
            filters: [
              ["type", "anyof", "Wave"],
              "AND",
              ["internalid", "anyof", waveIds.map(String)],
            ],
            columns: ["internalid", "tranid"],
          })
          .run()
          .getRange({ start: 0, end: 1000 }) || [];
      for (const r of rs) {
        const id = Number(r.getValue("internalid"));
        const no = String(r.getValue("tranid"));
        map[id] = no;
      }
    } catch (_) {}
    return map;
  }
  function findInvoicesForSO(soId) {
    const s = search.create({
      type: "invoice",
      filters: [["createdfrom", "anyof", soId], "AND", ["mainline", "is", "T"]],
      columns: ["internalid", "tranid"],
    });
    const out = [];
    s.run().each((r) => {
      out.push({ id: r.getValue("internalid"), tranid: r.getValue("tranid") });
      return true;
    });
    return out;
  }
  function processInvoice(invoiceId, invoiceTranId) {
    const res = {
      invoiceId,
      invoiceTranId,
      paymentsUnapplied: [],
      depositAppsDeleted: [],
      deletedInvoice: false,
      keptInvoice: false,
      blockers: [],
      errors: [],
    };
    try {
      let applying = findApplying(invoiceId);
      for (const a of applying) {
        try {
          if (a.type === "CustPymt") {
            unapplyPayment(a.id, invoiceId, invoiceTranId);
            res.paymentsUnapplied.push(a.tranid || a.id);
          } else if (a.type === "DepAppl") {
            record.delete({ type: record.Type.DEPOSIT_APPLICATION, id: a.id });
            res.depositAppsDeleted.push(a.tranid || a.id);
          } else {
            res.blockers.push(`${a.type}:${a.tranid || a.id}`);
          }
        } catch (e) {
          res.errors.push(`${a.type} ${a.tranid || a.id}: ${e.message}`);
        }
      }
      applying = findApplying(invoiceId);
      if (applying.length === 0) {
        try {
          record.delete({ type: record.Type.INVOICE, id: invoiceId });
          res.deletedInvoice = true;
        } catch (e) {
          res.errors.push(
            `Delete Invoice ${invoiceTranId || invoiceId}: ${e.message}`
          );
          res.keptInvoice = true;
        }
      } else {
        res.keptInvoice = true;
        applying.forEach((x) =>
          res.blockers.push(`${x.type}:${x.tranid || x.id}`)
        );
      }
    } catch (e) {
      res.errors.push(e.message || String(e));
      res.keptInvoice = true;
    }
    return res;
  }
  function findApplying(invoiceId) {
    const s = search.create({
      type: "invoice",
      filters: [["internalid", "anyof", String(invoiceId)]],
      columns: [
        search.createColumn({
          name: "internalid",
          join: "applyingTransaction",
        }),
        search.createColumn({ name: "type", join: "applyingTransaction" }),
        search.createColumn({ name: "tranid", join: "applyingTransaction" }),
      ],
    });
    const out = [];
    s.run().each((r) => {
      const id = r.getValue({
        name: "internalid",
        join: "applyingTransaction",
      });
      const typ = r.getValue({ name: "type", join: "applyingTransaction" });
      const tid = r.getValue({ name: "tranid", join: "applyingTransaction" });
      if (id) out.push({ id, type: typ, tranid: tid });
      return true;
    });
    return out;
  }
  function findCompletedOpenTaskIdForPickTask(pickTaskId) {
    try {
      const r =
        search
          .create({
            type: "customrecord_wmsse_trn_opentask",
            filters: [
              ["custrecord_wmsse_picktask_ref", "anyof", String(pickTaskId)],
              "AND",
              [
                "custrecord_wmsse_wms_status",
                "anyof",
                ["3", "4", "5", "8", "9"],
              ],
            ],
            columns: ["internalid"],
          })
          .run()
          .getRange({ start: 0, end: 1 }) || [];
      if (r.length) return Number(r[0].getValue("internalid"));
    } catch (_) {}
    try {
      const r2 =
        search
          .create({
            type: "customrecord_wms_open_task",
            filters: [
              ["custrecord_wms_task_picktask", "anyof", String(pickTaskId)],
              "AND",
              [
                "custrecord_wms_task_status",
                "anyof",
                ["Complt", "4", "5", "9"],
              ],
            ],
            columns: ["internalid"],
          })
          .run()
          .getRange({ start: 0, end: 1 }) || [];
      if (r2.length) return Number(r2[0].getValue("internalid"));
    } catch (_) {}
    return null;
  }
  function getSoTranId(soId) {
    try {
      const obj = search.lookupFields({
        type: record.Type.SALES_ORDER,
        id: soId,
        columns: ["tranid"],
      });
      const t1 = obj && obj.tranid;
      if (t1) return String(t1);
    } catch (_) {}
    try {
      let t2 = null;
      search
        .create({
          type: "salesorder",
          filters: [
            ["internalid", "anyof", soId],
            "AND",
            ["mainline", "is", "T"],
          ],
          columns: ["tranid"],
        })
        .run()
        .each((r) => {
          t2 = r.getValue("tranid");
          return false;
        });
      if (t2) return String(t2);
    } catch (_) {}
    try {
      const so = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });
      const t3 = so.getValue("tranid");
      if (t3) return String(t3);
    } catch (_) {}
    return null;
  }
  function getSoLocationId(soId) {
    try {
      const lf = search.lookupFields({
        type: record.Type.SALES_ORDER,
        id: soId,
        columns: ["location"],
      });
      if (lf && lf.location && lf.location[0] && lf.location[0].value)
        return Number(lf.location[0].value);
    } catch (_) {}
    try {
      const so = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });
      return Number(so.getValue("location")) || null;
    } catch (_) {
      return null;
    }
  }
  function buildInvDetailInfo(line) {
    if (!line || !line.serials || !line.serials.length) return {};
    const out = {};
    for (const s of line.serials) {
      out[String(s)] = {
        serial: String(s),
        quantity: 1,
        status: "Good",
        bin: line.fromBinName || "",
      };
    }
    return out;
  }
  function getTextSafe(rec, fieldId) {
    try {
      return rec.getText(fieldId);
    } catch (_) {
      return null;
    }
  }
  function orNull(v) {
    return v === undefined || v === null || v === "" ? null : v;
  }
  function groupBy(arr, keyFn) {
    const m = {};
    for (const x of arr) {
      const k = String(keyFn(x));
      if (!m[k]) m[k] = [];
      m[k].push(x);
    }
    return m;
  }
  function uniqueNumbers(arr) {
    const s = new Set();
    const out = [];
    for (const v of arr) {
      const n = Number(v);
      if (!isNaN(n) && v != null && !s.has(n)) {
        s.add(n);
        out.push(n);
      }
    }
    return out;
  }
  function firstNumber(arr) {
    for (const v of arr) {
      const n = Number(v);
      if (!isNaN(n) && v !== "" && v != null) return n;
    }
    return null;
  }
  function firstString(arr) {
    for (const v of arr) {
      if (v != null && String(v).length) return String(v);
    }
    return null;
  }
  function h(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function trimPreview(payload) {
    try {
      const p = JSON.parse(JSON.stringify(payload));
      if (p && p.params) {
        if (p.params.invDetailInfo) p.params.invDetailInfo = "…";
        if (p.params.scannedSerials) p.params.scannedSerials = "…";
      }
      return p;
    } catch (_) {
      return payload;
    }
  }
  function mix(a, b) {
    return JSON.parse(
      JSON.stringify({
        headers: a.headers,
        data: a.data,
        params: Object.assign({}, a.params, b.params),
      })
    );
  }
  return { onRequest };
});
