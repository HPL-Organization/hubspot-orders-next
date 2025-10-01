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
  "N/log",
], function (ui, search, record, url, https, runtime, log) {
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
    const picksDoneAll = picks.filter((p) => isDone(p.status));
    const hasAnyDone = picksDoneAll.length > 0;
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
      ctx.request.parameters.action === "ready"
    ) {
      const results = [];
      for (const ln of picksDoneAll) {
        const r = ensurePickTaskReady(Number(ln.pickTaskId));
        results.push({
          pickTaskId: ln.pickTaskId,
          beforeStatus: ln.status,
          result: r,
        });
      }
      reverseBlock = `
    <div style="margin-top:8px">
      <div style="font-weight:600">PickTask → Ready attempts</div>
      <pre style="white-space:pre-wrap">${h(
        JSON.stringify(results, null, 2)
      )}</pre>
    </div>`;
    } else if (
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

        const detachLogs = [];
        for (const wid of waveIds) {
          // keep your best-effort attempts (they won’t hurt)
          const r1 = detachSoFromWave(wid, Number(soId));
          const r2 = nukeWaveOrderJunctions(wid, Number(soId));

          const nothingChanged =
            !(
              r1 &&
              (r1.removed || (r1.scrubbedBody && r1.scrubbedBody.length))
            ) && !(r2 && r2.deleted > 0);

          let del = null;
          if (nothingChanged) {
            del = deleteWaveCompletely(wid);
          }

          detachLogs.push({
            waveId: wid,
            waveDetach: r1,
            junctionDetach: r2,
            waveDelete: del,
          });
        }

        const cleanupLog = postReverseCleanup(Number(soId), doneLines);
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
            {
              acceptedValidate: { request: accepted, response: acceptedBody },
            },
            null,
            2
          )
        )}</pre><div style="font-weight:600;margin-top:6px">Submit results</div><pre style="white-space:pre-wrap">${h(
          JSON.stringify(submitResults, null, 2)
        )}
        </pre><div style="font-weight:600;margin-top:6px">Wave detach attempts</div><pre style="white-space:pre-wrap">${h(
          JSON.stringify(detachLogs, null, 2)
        )}
        </pre><div style="font-weight:600;margin-top:6px">Post-reverse cleanup</div><pre style="white-space:pre-wrap">${h(
          JSON.stringify(cleanupLog, null, 2)
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
      deepDiag,
      picksDoneAll.length
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

  //new helpers

  function deleteOpenTaskRowsForPickTask(pickTaskId) {
    const deleted = { trn_opentask: 0, open_task: 0, errs: [] };

    const LEGACY_RT = "customrecord_wmsse_trn_opentask";
    const LEGACY_REF_FIELDS = [
      "custrecord_wmsse_picktask_ref",
      "custrecord_wms_picktask",
      "custrecord_picktask",
      "custrecord_wmsse_taskref",
    ];

    let legacyTried = false,
      legacyHit = false;
    for (const refField of LEGACY_REF_FIELDS) {
      try {
        legacyTried = true;
        const rows =
          search
            .create({
              type: LEGACY_RT,
              filters: [[refField, "anyof", String(pickTaskId)]],
              columns: ["internalid"],
            })
            .run()
            .getRange({ start: 0, end: 1000 }) || [];
        for (const r of rows) {
          const id = r.getValue("internalid");
          try {
            record.delete({ type: LEGACY_RT, id });
            deleted.trn_opentask++;
            legacyHit = true;
          } catch (e) {
            deleted.errs.push(`trn_opentask ${id}: ${e.message}`);
          }
        }
        if (legacyHit) break;
      } catch (e) {
        // this refField doesn't exist in this account
      }
    }
    if (legacyTried && !legacyHit) {
      deleted.errs.push(
        "legacy open-task lookup: no matching ref field in this account"
      );
    }

    try {
      const rows2 =
        search
          .create({
            type: "customrecord_wms_open_task",
            filters: [
              ["custrecord_wms_task_picktask", "anyof", String(pickTaskId)],
            ],
            columns: ["internalid"],
          })
          .run()
          .getRange({ start: 0, end: 1000 }) || [];
      for (const r of rows2) {
        const id = r.getValue("internalid");
        try {
          record.delete({ type: "customrecord_wms_open_task", id });
          deleted.open_task++;
        } catch (e) {
          deleted.errs.push(`open_task ${id}: ${e.message}`);
        }
      }
    } catch (e) {
      // record type not present
    }

    return deleted;
  }

  function loadPickTaskLite(pickTaskId) {
    // returns { qtyPicked, waveId } or null
    try {
      const pt = record.load({
        type: "picktask",
        id: pickTaskId,
        isDynamic: false,
      });
      const qty = Number(
        pt.getValue("totalpickedquantity") ||
          pt.getValue("pickedquantity") ||
          pt.getValue("quantitypicked") ||
          0
      );
      const waveId =
        Number(
          pt.getValue("waveid") ||
            pt.getValue("wave") ||
            pt.getValue("custrecord_wmsse_waveid") ||
            pt.getValue("custrecord_wms_waveid") ||
            0
        ) || null;
      return { qtyPicked: qty, waveId };
    } catch (_) {
      return null;
    }
  }

  function countOpenTaskRowsForPickTask(pickTaskId) {
    let n = 0;

    const LEGACY_RT = "customrecord_wmsse_trn_opentask";
    const LEGACY_REF_FIELDS = [
      "custrecord_wmsse_picktask_ref",
      "custrecord_wms_picktask",
      "custrecord_picktask",
      "custrecord_wmsse_taskref",
    ];
    for (const refField of LEGACY_REF_FIELDS) {
      try {
        const got = (
          search
            .create({
              type: LEGACY_RT,
              filters: [[refField, "anyof", String(pickTaskId)]],
              columns: ["internalid"],
            })
            .run()
            .getRange({ start: 0, end: 1 }) || []
        ).length;
        n += got;
        if (got) break;
      } catch (_) {
        /* try next field id */
      }
    }

    try {
      n += (
        search
          .create({
            type: "customrecord_wms_open_task",
            filters: [
              ["custrecord_wms_task_picktask", "anyof", String(pickTaskId)],
            ],
            columns: ["internalid"],
          })
          .run()
          .getRange({ start: 0, end: 1 }) || []
      ).length;
    } catch (_) {
      /* type not in this account */
    }

    return n;
  }

  function tryDeleteOrReopenPickTask(pickTaskId) {
    const before = loadPickTaskLite(pickTaskId);
    const remain = countOpenTaskRowsForPickTask(pickTaskId);
    const qtyPicked =
      before && typeof before.qtyPicked === "number" ? before.qtyPicked : null;

    if (remain > 0) {
      return { action: "noop", reason: "has-open-task-rows" };
    }

    const reset = reopenPickTaskViaStageReset(pickTaskId);
    if (reset.ok && reset.result === "deleted")
      return { action: "deleted", detail: reset.tried };
    if (reset.ok) return { action: "staged-reset", detail: reset.tried };

    // Fallbacks
    const openStatusId =
      getPickTaskStatusIdByLabel(/^Ready$/i, pickTaskId) ||
      getPickTaskStatusIdByLabel(/In\s*Progress/i, pickTaskId) ||
      getPickTaskStatusIdByLabel(/^Open$/i, pickTaskId) ||
      getPickTaskStatusIdByLabel(/Assigned/i, pickTaskId);

    if (openStatusId) {
      try {
        record.submitFields({
          type: "picktask",
          id: pickTaskId,
          values: {
            status: openStatusId,
            completed: false,
            iscomplete: false,
            custrecord_wmsse_iscomplete: false,
          },
          options: { ignoreMandatoryFields: true },
        });
        return { action: "reopened" };
      } catch (e) {
        return {
          action: "noop",
          error: "reopen-failed",
          msg: String((e && e.message) || e),
        };
      }
    }

    if ((qtyPicked === 0 || qtyPicked === null) && remain === 0) {
      try {
        record.delete({ type: "picktask", id: pickTaskId });
        return { action: "deleted" };
      } catch (e) {
        return {
          action: "noop",
          error: "delete-failed",
          msg: String((e && e.message) || e),
        };
      }
    }

    return { action: "noop", reason: "unsafe" };
  }
  function ensurePickTaskReady(pickTaskId) {
    // Returns { ok, finalStatus?, tried:[...] }
    const tried = [];
    try {
      const pt = record.load({
        type: "picktask",
        id: pickTaskId,
        isDynamic: false,
      });

      const clear = (fid, val) => {
        try {
          pt.setValue({ fieldId: fid, value: val });
          tried.push({ step: "clear", fieldId: fid, ok: true });
        } catch (_) {}
      };
      [
        "wave",
        "waveid",
        "custrecord_wmsse_waveid",
        "custrecord_wms_waveid",
      ].forEach((fid) => clear(fid, ""));

      const zero = (fid) => {
        try {
          pt.setValue({ fieldId: fid, value: 0 });
          tried.push({ step: "zero", fieldId: fid, ok: true });
        } catch (_) {}
      };
      const fset = (fid) => {
        try {
          pt.setValue({ fieldId: fid, value: false });
          tried.push({ step: "unset", fieldId: fid, ok: true });
        } catch (_) {}
      };
      ["totalpickedquantity", "pickedquantity", "quantitypicked"].forEach(zero);
      ["completed", "iscomplete", "custrecord_wmsse_iscomplete"].forEach(fset);

      [
        "actualenddate",
        "enddate",
        "endtime",
        "datecompleted",
        "completeddate",
        "dateclosed",
      ].forEach((fid) => {
        try {
          pt.setValue({ fieldId: fid, value: "" });
          tried.push({ step: "clear-done-datetime", fieldId: fid, ok: true });
        } catch (_) {}
      });

      const pref = getPickTaskOpenishStatusValue(pickTaskId);
      if (pref && pref.value != null) {
        try {
          pt.setValue({ fieldId: "status", value: pref.value });
          tried.push({
            step: "status=openish",
            value: pref.value,
            text: pref.text,
            ok: true,
          });
        } catch (e) {
          tried.push({
            step: "status=openish",
            value: pref.value,
            text: pref.text,
            ok: false,
            err: String((e && e.message) || e),
          });
        }
        tried.push({ step: "status-options", ok: true, options: pref.options });
      } else {
        tried.push({
          step: "status-options",
          ok: false,
          err: "no-openish-option-found",
        });
      }

      // Save
      const savedId = pt.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });
      tried.push({ step: "save", ok: true, savedId });

      // Read back status
      const check = record.load({
        type: "picktask",
        id: pickTaskId,
        isDynamic: false,
      });
      let finalStatus = "";
      try {
        finalStatus = String(
          check.getText({ fieldId: "status" }) ||
            check.getValue({ fieldId: "status" }) ||
            ""
        );
      } catch (_) {}
      return { ok: true, finalStatus, tried };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e), tried };
    }
  }

  // can be removed
  function ensurePickTaskStageThenReady(pickTaskId) {
    const tried = [];
    try {
      const stagedId =
        getPickTaskStatusIdByLabel(/Staged/i, pickTaskId) ||
        getPickTaskStatusIdByLabel(/Stage/i, pickTaskId);

      if (!stagedId) {
        return { ok: false, err: "no-staged-status-option", tried };
      }

      try {
        const pt1 = record.load({
          type: "picktask",
          id: pickTaskId,
          isDynamic: false,
        });
        pt1.setValue({ fieldId: "status", value: stagedId });
        const savedId1 = pt1.save({
          enableSourcing: false,
          ignoreMandatoryFields: true,
        });
        tried.push({
          step: "set-status-staged",
          value: stagedId,
          ok: true,
          savedId: savedId1,
        });
      } catch (e) {
        tried.push({
          step: "set-status-staged",
          ok: false,
          err: String((e && e.message) || e),
        });
        return { ok: false, err: "stage-save-failed", tried };
      }

      const pt2 = record.load({
        type: "picktask",
        id: pickTaskId,
        isDynamic: false,
      });

      let cleared = false;
      for (const f of [
        "stagingbin",
        "stagingbinid",
        "custrecord_wms_staging_bin",
        "custbody_staging_bin",
      ]) {
        try {
          pt2.setValue({ fieldId: f, value: "" });
          cleared = true;
          tried.push({ step: "clear-staging-bin", fieldId: f, ok: true });
          break;
        } catch (_) {}
      }
      if (!cleared)
        tried.push({ step: "clear-staging-bin", ok: false, err: "no-field" });

      for (const f of [
        "totalpickedquantity",
        "pickedquantity",
        "quantitypicked",
      ]) {
        try {
          pt2.setValue({ fieldId: f, value: 0 });
          tried.push({ step: "zero-picked", fieldId: f, ok: true });
        } catch (_) {}
      }

      for (const f of [
        "completed",
        "iscomplete",
        "custrecord_wmsse_iscomplete",
      ]) {
        try {
          pt2.setValue({ fieldId: f, value: false });
          tried.push({ step: "unset-complete", fieldId: f, ok: true });
        } catch (_) {}
      }

      const savedId2 = pt2.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });
      tried.push({ step: "save-after-clear", ok: true, savedId: savedId2 });

      const check = record.load({
        type: "picktask",
        id: pickTaskId,
        isDynamic: false,
      });
      let finalStatus = "";
      try {
        finalStatus = String(
          check.getText({ fieldId: "status" }) ||
            check.getValue({ fieldId: "status" }) ||
            ""
        );
      } catch (_) {}
      return { ok: true, finalStatus, tried };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e), tried };
    }
  }

  function reopenPickTaskViaStageReset(pickTaskId) {
    const tried = [];

    const stagedId =
      getPickTaskStatusIdByLabel(/Staged/i, pickTaskId) ||
      getPickTaskStatusIdByLabel(/Stage/i, pickTaskId);

    if (!stagedId) {
      return { ok: false, err: "no-staged-status-option", tried };
    }

    try {
      const pt = record.load({
        type: "picktask",
        id: pickTaskId,
        isDynamic: false,
      });

      try {
        pt.setValue({ fieldId: "status", value: stagedId });
        tried.push({ step: "status=Staged", value: stagedId, ok: true });
      } catch (e) {
        tried.push({
          step: "status=Staged",
          ok: false,
          err: String((e && e.message) || e),
        });
      }

      const stagingFields = [
        "stagingbin",
        "custrecord_wms_staging_bin",
        "custbody_staging_bin",
      ];
      let cleared = false;
      for (const f of stagingFields) {
        try {
          pt.setValue({ fieldId: f, value: "" });
          cleared = true;
          tried.push({ step: "clear-staging-bin", fieldId: f, ok: true });
          break;
        } catch (_) {}
      }
      if (!cleared)
        tried.push({ step: "clear-staging-bin", ok: false, err: "no-field" });

      const qFields = [
        "totalpickedquantity",
        "pickedquantity",
        "quantitypicked",
      ];
      let zeroed = false;
      for (const f of qFields) {
        try {
          pt.setValue({ fieldId: f, value: 0 });
          zeroed = true;
          tried.push({ step: "zero-picked", fieldId: f, ok: true });
        } catch (_) {}
      }
      if (!zeroed)
        tried.push({ step: "zero-picked", ok: false, err: "no-field" });

      const completeFlags = [
        "completed",
        "iscomplete",
        "custrecord_wmsse_iscomplete",
      ];
      for (const f of completeFlags) {
        try {
          pt.setValue({ fieldId: f, value: false });
          tried.push({ step: "unset-complete", fieldId: f, ok: true });
        } catch (_) {}
      }

      const savedId = pt.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });
      tried.push({ step: "save", ok: true, savedId });

      try {
        record.delete({ type: "picktask", id: pickTaskId });
        tried.push({ step: "delete", ok: true });
        return { ok: true, result: "deleted", tried };
      } catch (e) {
        tried.push({
          step: "delete",
          ok: false,
          err: String((e && e.message) || e),
        });
        return { ok: true, result: "staged-reset", tried };
      }
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e), tried };
    }
  }

  function clearWavePointersOnSO(soId) {
    const tried = [];
    const candidates = [
      "custbody_wms_wave",
      "custbody_wmsse_waveid",
      "custbody_wms_waveid",
      "custbody_wave",
    ];
    for (const fieldId of candidates) {
      try {
        record.submitFields({
          type: record.Type.SALES_ORDER,
          id: soId,
          values: { [fieldId]: "" },
          options: { ignoreMandatoryFields: true },
        });
        tried.push({ fieldId, ok: true });
      } catch (e) {
        tried.push({
          fieldId,
          ok: false,
          err: String((e && e.message) || e),
        });
      }
    }
    return tried;
  }
  function deleteWaveCompletely(waveId) {
    // returns { ok, deleted?, flip?, err? }
    let flip = null;

    flip = setWaveDocStatusByText(waveId, [
      /Planning/i,
      /Released/i,
      /In.?Progress/i,
      /Open/i,
    ]);

    try {
      record.delete({ type: "wave", id: waveId });
      return { ok: true, deleted: true, flip };
    } catch (e1) {
      const cancel = setWaveDocStatusByText(waveId, [
        /Cancel/i,
        /Cancelled/i,
        /Void/i,
      ]);
      try {
        record.delete({ type: "wave", id: waveId });
        return { ok: true, deleted: true, flip: cancel || flip };
      } catch (e2) {
        return {
          ok: false,
          deleted: false,
          flip: cancel || flip,
          err: String((e2 && e2.message) || e2),
        };
      }
    }
  }

  function postReverseCleanup(soId, doneLines) {
    const log = { pickTasks: [], soWaveFieldClearAttempts: [] };
    const byPickTask = uniqueNumbers(
      doneLines.map((l) => l.pickTaskId).filter(Boolean)
    );

    for (const ptId of byPickTask) {
      const before = loadPickTaskLite(ptId);
      const delOT = deleteOpenTaskRowsForPickTask(ptId);
      const remain = countOpenTaskRowsForPickTask(ptId);
      let action = {
        action: "noop",
        reason: "still-has-open-tasks-or-picked-qty",
      };

      const qtyPicked =
        before && typeof before.qtyPicked === "number"
          ? before.qtyPicked
          : null;

      if ((qtyPicked === 0 || qtyPicked === null) && remain === 0) {
        action = tryDeleteOrReopenPickTask(ptId);
      }

      log.pickTasks.push({
        pickTaskId: ptId,
        before,
        openTaskRowsDeleted: delOT,
        remainingOpenTaskRows: remain,
        action,
      });
    }

    log.soWaveFieldClearAttempts = clearWavePointersOnSO(soId);

    return log;
  }

  function forceReopenPickTask(pickTaskId) {
    const logs = [];
    const trySet = (values, step = "submitFields") => {
      try {
        record.submitFields({
          type: "picktask",
          id: pickTaskId,
          values,
          options: { ignoreMandatoryFields: true },
        });
        logs.push({ ok: true, step, values });
        return true;
      } catch (e) {
        logs.push({
          ok: false,
          step,
          values,
          err: String((e && e.message) || e),
        });
        return false;
      }
    };

    for (const values of [
      { wave: "" },
      { waveid: "" },
      { custrecord_wmsse_waveid: "" },
      { custrecord_wms_waveid: "" },
    ])
      trySet(values, "clearWave");

    const readyId =
      getPickTaskStatusIdByLabel(/^Ready$/i, pickTaskId) ||
      getPickTaskStatusIdByLabel(/In\s*Progress/i, pickTaskId) ||
      getPickTaskStatusIdByLabel(/^Open$/i, pickTaskId) ||
      getPickTaskStatusIdByLabel(/Assigned/i, pickTaskId);

    if (readyId) {
      if (
        trySet(
          {
            status: readyId,
            completed: false,
            iscomplete: false,
            custrecord_wmsse_iscomplete: false,
          },
          "setStatus"
        )
      ) {
        return { ok: true, tried: logs };
      }
    } else {
      logs.push({
        ok: false,
        step: "setStatus",
        err: "no-open-status-option",
      });
    }

    for (const values of [
      { completed: false },
      { iscomplete: false },
      { custrecord_wmsse_iscomplete: false },
    ]) {
      if (trySet(values, "unsetCompleteFlag")) return { ok: true, tried: logs };
    }
    return { ok: false, tried: logs };
  }

  function detachSoFromWave(waveId, soId) {
    // returns { ok, removed, scrubbedBody:[{fieldId, old}], flip?, savedId?, where?, err? }

    // Body fields we’ll try first (most common); we also do a full scan as a fallback.
    const BODY_SO_FIELDS = [
      // common customs people add on Wave:
      "custbody_so_ref",
      "custbody_salesorder",
      "custbody_wms_salesorder",
      "custbody_wms_so",
      "custbody_wmsse_ordno",
      "custbody_wave_so",
      // sometimes people reuse a generic "order" body field:
      "order",
      "transaction",
      // native-ish possibilities (rare on Wave but harmless to attempt):
      "createdfrom",
      "entitystatus", // if someone stored SO id here by mistake
    ];

    // Sublist ids and SO-pointer columns we’ll try to remove lines from
    const SUBLISTS = ["orders", "salesorders", "apply", "line", "links"];
    const SUBLIST_SO_COLS = [
      "order",
      "transaction",
      "createdfrom",
      "source",
      "doc",
      "docref",
    ];

    // Try to flip doc/status to an editable state before changing anything.
    let flip = setWaveDocStatusByText(waveId, [
      /In.?Progress/i,
      /Released/i,
      /Planning/i,
    ]);
    // Fallback: raw codes (works when fields are free text / coded text)
    if (!flip || flip.ok === false) flip = flipWaveDocStatusRaw(waveId);

    try {
      log.debug({
        title: "wave:flip-status",
        details: JSON.stringify({ waveId, flip }),
      });
    } catch (_) {}

    let wave;
    try {
      wave = record.load({ type: "wave", id: waveId, isDynamic: false });
    } catch (e) {
      return {
        ok: false,
        where: "load-wave",
        err: String((e && e.message) || e),
      };
    }
    try {
      const lists = ["orders", "salesorders", "apply", "line", "links"];
      const counts = {};
      for (const s of lists) counts[s] = safeGetLineCount(wave, s);
      log.debug({
        title: "wave:probe-sublists:before",
        details: JSON.stringify({ waveId, counts }),
      });
    } catch (_) {}

    const scrubbedBody = [];
    // 1) Targeted body-field scrub
    for (const fid of BODY_SO_FIELDS) {
      try {
        const v = wave.getValue({ fieldId: fid });
        if (String(v) === String(soId)) {
          wave.setValue({ fieldId: fid, value: "" });
          scrubbedBody.push({ fieldId: fid, old: String(v) });
        }
      } catch (_) {}
    }

    // 2) Full body-field scan fallback (cheap on transactional records)
    try {
      const fields = wave.getFields() || [];
      for (const fid of fields) {
        // Skip fields we already scrubbed
        if (BODY_SO_FIELDS.indexOf(fid) >= 0) continue;
        try {
          const v = wave.getValue({ fieldId: fid });
          if (String(v) === String(soId)) {
            wave.setValue({ fieldId: fid, value: "" });
            scrubbedBody.push({ fieldId: fid, old: String(v) });
          }
        } catch (_) {}
      }
    } catch (_) {}

    // 3) Sublist line removal (if any)
    let removed = 0;
    for (const sub of SUBLISTS) {
      const count = safeGetLineCount(wave, sub);
      if (!count) continue;
      for (let i = count - 1; i >= 0; i--) {
        let isSO = false;
        for (const col of SUBLIST_SO_COLS) {
          try {
            const v = wave.getSublistValue({
              sublistId: sub,
              fieldId: col,
              line: i,
            });
            if (String(v) === String(soId)) {
              isSO = true;
              break;
            }
          } catch (_) {}
        }
        if (!isSO) continue;

        // remove if allowed; otherwise blank the referencing columns
        try {
          wave.removeLine({ sublistId: sub, line: i });
          removed++;
        } catch (e) {
          for (const col of SUBLIST_SO_COLS) {
            try {
              wave.setSublistValue({
                sublistId: sub,
                fieldId: col,
                line: i,
                value: "",
              });
            } catch (_) {}
          }
        }
      }
    }
    try {
      const countsAfter = {};
      for (const s of ["orders", "salesorders", "apply", "line", "links"]) {
        try {
          countsAfter[s] = wave.getLineCount({ sublistId: s }) || 0;
        } catch (_) {
          countsAfter[s] = "N/A";
        }
      }
      log.debug({
        title: "wave:probe-sublists:after",
        details: JSON.stringify({ waveId, counts: countsAfter }),
      });
    } catch (_) {}

    // 4) Save
    try {
      const savedId = wave.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });
      return { ok: true, flip, removed, scrubbedBody, savedId };
    } catch (e) {
      return {
        ok: false,
        where: "save-wave",
        removed,
        scrubbedBody,
        flip,
        err: String((e && e.message) || e),
      };
    }

    function safeGetLineCount(rec, sublistId) {
      try {
        return rec.getLineCount({ sublistId }) || 0;
      } catch (_) {
        return 0;
      }
    }
  }
  function getPickTaskOpenishStatusValue(pickTaskId) {
    // returns { value, text, options:[{value,text}] } or null
    const res = { value: null, text: null, options: [] };
    try {
      const rec = record.load({
        type: "picktask",
        id: pickTaskId,
        isDynamic: false,
      });
      const fld = rec.getField({ fieldId: "status" });
      if (!fld || !fld.getSelectOptions) return null;
      const opts = fld.getSelectOptions() || [];
      res.options = opts.map((o) => ({ value: o.value, text: o.text }));

      const OPEN_RX =
        /(Ready|Open|Assigned|In\s*Progress|New|Pending|Reopen|Not\s*Started)/i;
      let hit = opts.find((o) => OPEN_RX.test(o.text || ""));
      if (!hit) {
        const BAD_RX =
          /(Done|Complete|Closed|Cancel|Cancelled|Void|Staged|Stage)/i;
        hit = opts.find((o) => !BAD_RX.test(o.text || ""));
      }
      if (hit) {
        res.value = hit.value;
        res.text = hit.text;
        return res;
      }
    } catch (_) {}
    return null;
  }

  function nukeWaveOrderJunctions(waveId, soId) {
    const out = { deleted: 0, errs: [] };
    const candidateRecords = [
      "customrecord_wmsse_wave_orders",
      "customrecord_wmsse_wavelist",
      "customrecord_wms_wave_orders",
      "customrecord_wms_wave_order",
      "customrecord_wave_orders",
      "customrecord_wms_wave_so_junc",
      "customrecord_nswms_wave_orders",
    ];
    const waveFields = [
      "custrecord_wms_wave",
      "custrecord_wmsse_wave",
      "custrecord_wave",
      "custrecord_wms_waveid",
      "custrecord_nswms_wave",
    ];
    const soFields = [
      "custrecord_wms_order",
      "custrecord_wmsse_order",
      "custrecord_wmsse_so",
      "custrecord_order",
      "custrecord_wms_so",
      "custrecord_salesorder",
      "custrecord_nswms_so",
    ];

    for (const rt of candidateRecords) {
      try {
        let anyDeleted = false;
        const combos = [
          (wf, sf) => [
            [wf, "anyof", String(waveId)],
            "AND",
            [sf, "anyof", String(soId)],
          ],
          (wf) => [[wf, "anyof", String(waveId)]],
          (_, sf) => [[sf, "anyof", String(soId)]],
        ];
        for (const wf of waveFields)
          for (const sf of soFields) {
            for (const build of combos) {
              let rows = [];
              try {
                rows =
                  search
                    .create({
                      type: rt,
                      filters: build(wf, sf),
                      columns: ["internalid"],
                    })
                    .run()
                    .getRange({ start: 0, end: 1000 }) || [];
              } catch (_) {
                continue;
              }
              for (const r of rows) {
                const id = r.getValue("internalid");
                try {
                  record.delete({ type: rt, id });
                  out.deleted++;
                  anyDeleted = true;
                } catch (e) {
                  out.errs.push(`${rt} ${id}: ${e.message}`);
                }
              }
              if (anyDeleted) break;
            }
            if (anyDeleted) break;
          }
      } catch (e) {
        out.errs.push(`${rt}: ${String((e && e.message) || e)}`);
      }
    }
    return out;
  }
  function bruteFindAndDeleteWaveSoLinks(waveId, soId) {
    // returns { scanned:[], deleted:[], scrubbed:[], errs:[] }
    const res = { scanned: [], deleted: [], scrubbed: [], errs: [] };
    const seen = new Set();

    function add(type, id) {
      const k = type + ":" + id;
      if (!seen.has(k)) {
        seen.add(k);
        return true;
      }
      return false;
    }

    // 1) Use global search to discover custom records that mention either id
    let hits = [];
    try {
      const g1 = search.global({ keywords: String(waveId) }) || [];
      const g2 = search.global({ keywords: String(soId) }) || [];
      hits = g1
        .concat(g2)
        .filter((r) => /^customrecord_/i.test(String(r.recordType || "")));
    } catch (e) {
      res.errs.push("global-search:" + String((e && e.message) || e));
    }

    // 2) Walk each candidate, load, and scrub/delete
    for (const h of hits) {
      const type = String(h.recordType),
        id = String(h.id);
      if (!add(type, id)) continue;

      try {
        const rec = record.load({ type, id, isDynamic: false });
        const fields = rec.getFields() || [];
        let sawWave = false,
          sawSO = false,
          touched = false;

        const getV = (fid) => {
          try {
            return rec.getValue({ fieldId: fid });
          } catch (_) {
            return null;
          }
        };
        const getT = (fid) => {
          try {
            return rec.getText({ fieldId: fid });
          } catch (_) {
            return null;
          }
        };

        // First pass: detect
        for (const f of fields) {
          const v = getV(f),
            t = getT(f);
          if (
            String(v) === String(waveId) ||
            String(t).indexOf(String(waveId)) >= 0
          )
            sawWave = true;
          if (
            String(v) === String(soId) ||
            String(t).indexOf(String(soId)) >= 0
          )
            sawSO = true;
        }

        // If this looks like a junction (references both ids) ,delete it
        if (sawWave && sawSO) {
          try {
            record.delete({ type, id });
            res.deleted.push({ type, id });
            continue;
          } catch (e) {
            res.errs.push(
              `delete ${type} ${id}: ${String((e && e.message) || e)}`
            );
          }
        }

        // Otherwise, if it only references SO or Wave, blank those pointers
        for (const f of fields) {
          const v = getV(f),
            t = getT(f);
          const isSO =
            String(v) === String(soId) || String(t).indexOf(String(soId)) >= 0;
          const isWave =
            String(v) === String(waveId) ||
            String(t).indexOf(String(waveId)) >= 0;
          if (isSO || isWave) {
            try {
              rec.setValue({ fieldId: f, value: "" });
              touched = true;
              res.scrubbed.push({
                type,
                id,
                fieldId: f,
                old: String(v || t || ""),
              });
            } catch (_) {
              /* ignore field , can't edit */
            }
          }
        }

        if (touched) {
          try {
            rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
          } catch (e) {
            res.errs.push(
              `save ${type} ${id}: ${String((e && e.message) || e)}`
            );
          }
        }

        res.scanned.push({ type, id, sawWave, sawSO, touched });
      } catch (e) {
        res.errs.push(`load ${type} ${id}: ${String((e && e.message) || e)}`);
      }
    }

    return res;
  }

  function getPickTaskStatusIdByLabel(labelPattern, pickTaskId) {
    try {
      if (pickTaskId) {
        const rec = record.load({
          type: "picktask",
          id: pickTaskId,
          isDynamic: false,
        });
        const fld = rec.getField({ fieldId: "status" });
        if (fld && fld.getSelectOptions) {
          const opts = fld.getSelectOptions();
          for (const o of opts)
            if (labelPattern.test(o.text || "")) return o.value;
        }
      }
    } catch (_) {}
    // Fallback: create a shell to read options
    try {
      const rec = record.create({ type: "picktask", isDynamic: false });
      const fld = rec.getField({ fieldId: "status" });
      if (fld && fld.getSelectOptions) {
        const opts = fld.getSelectOptions();
        for (const o of opts)
          if (labelPattern.test(o.text || "")) return o.value;
      }
    } catch (_) {}
    return null;
  }

  function setWaveDocStatusByText(waveId, labelPatterns) {
    try {
      const w = record.load({ type: "wave", id: waveId, isDynamic: false });
      const candidateFields = [
        "documentstatus",
        "orderstatus",
        "statusRef",
        "custbody_doc_status",
        "custbody_wms_doc_status",
        "custbody_status_internal",
      ];
      for (const f of candidateFields) {
        try {
          const fld = w.getField({ fieldId: f });
          if (!fld || !fld.getSelectOptions) continue;
          const opts = fld.getSelectOptions();
          for (const rx of labelPatterns) {
            const hit = opts.find((o) => rx.test(o.text || ""));
            if (hit) {
              w.setValue({ fieldId: f, value: hit.value });
              const savedId = w.save({
                enableSourcing: false,
                ignoreMandatoryFields: true,
              });
              return {
                ok: true,
                fieldId: f,
                value: hit.value,
                text: hit.text,
                savedId,
              };
            }
          }
        } catch (_) {}
      }
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e) };
    }
    return null; // important so caller can try fallback
  }
  function flipWaveDocStatusRaw(waveId) {
    const CANDIDATE_FIELDS = [
      "custbody_document_status",
      "custbody_doc_status",
      "custbody_wms_doc_status",
      "custbody_status_internal",
      "documentstatus",
      "orderstatus",
      "statusRef",
    ];
    // “Editable” codes
    const EDITABLE_CODES = [
      "A",
      "B",
      "IP",
      "INPROGRESS",
      "IN_PROGRESS",
      "RLS",
      "RELEASED",
      "PLANNING",
    ];
    try {
      const w = record.load({ type: "wave", id: waveId, isDynamic: false });

      for (const f of CANDIDATE_FIELDS) {
        try {
          const curVal = w.getValue({ fieldId: f });
          const curTxt = String(
            (w.getText && w.getText({ fieldId: f })) || curVal || ""
          );
          if (/in.?progress|released|planning/i.test(curTxt)) {
            return {
              ok: true,
              fieldId: f,
              value: curVal,
              text: curTxt,
              alreadyEditable: true,
            };
          }
        } catch (_) {}
      }

      for (const f of CANDIDATE_FIELDS) {
        for (const code of EDITABLE_CODES) {
          try {
            w.setValue({ fieldId: f, value: code });
            const savedId = w.save({
              enableSourcing: false,
              ignoreMandatoryFields: true,
            });
            return { ok: true, fieldId: f, value: code, savedId, raw: true };
          } catch (_) {
            /* try next code */
          }
        }
      }
      return { ok: false, err: "no-editable-status-id-found" };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e) };
    }
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
    deepDiag,
    picksDoneAllCount
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
    <div style="font-weight:600;margin-bottom:6px">Actions</div>
    <div style="margin-bottom:4px">Location: ${
      soLocId ? h(String(soLocId)) : '<span style="color:#b00020">None</span>'
    }</div>
    <div style="margin-bottom:4px">Waves: ${h(waveDisplay)}</div>
    <div style="margin-bottom:10px">Completed PickTask IDs: ${completedIdsWithLines}</div>

    <div style="display:flex; gap:10px; flex-wrap:wrap">
      <form method="POST" style="margin:0">
        <input type="hidden" name="so" value="${h(soId)}"/>
        <input type="hidden" name="action" value="reverse"/>
        <button type="submit" ${
          doneLines.length && soLocId ? "" : "disabled"
        } style="padding:6px 10px;border:1px solid #1d4ed8;border-radius:8px;background:#1d4ed8;color:#fff;cursor:pointer">
          Reverse Completed Picks
        </button>
      </form>

      <form method="POST" style="margin:0">
  <input type="hidden" name="so" value="${h(soId)}"/>
  <input type="hidden" name="action" value="stageclear"/>
  <button type="submit" ${picksDoneAllCount ? "" : "disabled"}
    style="padding:6px 10px;border:1px solid #7c3aed;border-radius:8px;background:#7c3aed;color:#fff;cursor:pointer">
    Stage → Clear → Save (Ready)
  </button>
</form>
    </div>

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
          invRows.length
            ? invBlocks
            : "No invoices found for this Sales Order. testing"
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
      out.push({
        id: r.getValue("internalid"),
        tranid: r.getValue("tranid"),
      });
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
            record.delete({
              type: record.Type.DEPOSIT_APPLICATION,
              id: a.id,
            });
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
