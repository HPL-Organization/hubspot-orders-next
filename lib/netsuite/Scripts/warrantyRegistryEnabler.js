/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/search", "N/runtime", "N/log", "N/workflow", "N/task"], (
  record,
  search,
  runtime,
  log,
  workflow,
  task
) => {
  function afterSubmit(context) {
    const startTs = Date.now();
    try {
      const event = context.type;
      if (
        !(
          event === context.UserEventType.CREATE ||
          event === context.UserEventType.EDIT
        )
      )
        return;

      const newRec = context.newRecord;
      const oldRec = context.oldRecord;

      const script = runtime.getCurrentScript();
      const toBool = (v) =>
        v === true || v === "T" || v === "true" || v === 1 || v === "1";

      const itemsCsv = String(
        script.getParameter({ name: "custscript_warranty_item_ids_csv" }) || ""
      ).trim();
      const requireMatch = toBool(
        script.getParameter({ name: "custscript_require_match" }) || "F"
      );
      const verbose = toBool(
        script.getParameter({ name: "custscript_verbose_logs" }) || "T"
      );

      const modeParam = String(
        script.getParameter({ name: "custscript_touch_mode" }) || "BOTH"
      ).toUpperCase();
      const mode =
        ["XEDIT", "EDIT", "BOTH", "DOUBLE"].indexOf(modeParam) >= 0
          ? modeParam
          : "BOTH";

      const touchFieldId = String(
        script.getParameter({ name: "custscript_touch_fieldid" }) || "memo"
      );
      const memoPrefixCfg = String(
        script.getParameter({ name: "custscript_memo_prefix" }) || ""
      );
      const leavePrefix = toBool(
        script.getParameter({ name: "custscript_leave_prefix" }) || "F"
      );

      const regFieldCsv = String(
        script.getParameter({ name: "custscript_register_field_ids_csv" }) || ""
      ).trim();
      const regFieldIds = (
        regFieldCsv
          ? regFieldCsv.split(",")
          : [
              "custcol_wrm_register_warranty",
              "custcol_register_warranty",
              "registerwarranty",
              "custcol_warranty_register",
            ]
      )
        .map((s) => String(s).trim())
        .filter(Boolean);
      const regRegexStr = String(
        script.getParameter({ name: "custscript_reg_col_regex" }) ||
          "(warr|wrm).*reg|reg.*(warr|wrm)"
      );
      const forceRegister = toBool(
        script.getParameter({ name: "custscript_force_register" }) || "F"
      );

      const warrantyWfId =
        script.getParameter({ name: "custscript_warranty_wf_id" }) || null;

      const wrmScriptIdParam =
        script.getParameter({ name: "custscript_wrmsched_script_id" }) || null;
      const wrmDeployIdParam =
        script.getParameter({ name: "custscript_wrmsched_deploy_id" }) || null;

      const autoFindSched = toBool(
        script.getParameter({ name: "custscript_auto_find_sched" }) || "T"
      );

      const ifId = newRec.id;
      const soId = newRec.getValue({ fieldId: "createdfrom" });

      const newStatus = getStatusValue(newRec);
      const oldStatus = oldRec ? getStatusValue(oldRec) : null;
      const becameShipped =
        isShipped(newStatus) &&
        (!isShipped(oldStatus) || event === context.UserEventType.CREATE);

      log.debug("Resolved params", {
        itemsCsv,
        requireMatch,
        verbose,
        mode,
        touchFieldId,
        memoPrefixCfg,
        leavePrefix,
        regFieldIds,
        regRegexStr,
        forceRegister,
        warrantyWfId,
        wrmScriptIdParam,
        wrmDeployIdParam,
        autoFindSched,
        execContext: runtime.executionContext,
      });

      log.audit("IF UE Start", {
        ifId,
        event,
        soId,
        newStatus,
        oldStatus,
        becameShipped,
        mode,
        requireMatch,
        hasTargetsConfigured: Boolean(itemsCsv),
      });

      if (!becameShipped) {
        log.debug("Skip: not a transition to Shipped", {
          ifId,
          event,
          newStatus,
          oldStatus,
        });
        return;
      }
      if (!soId) {
        log.debug("Skip: IF has no createdfrom (SO) link", { ifId });
        return;
      }

      // Optional item filter
      let shouldTrigger = true;
      let targetSet = null;
      if (itemsCsv) {
        targetSet = csvToIdSet(itemsCsv);
        const matchInfo = scanFulfillmentItems(newRec, targetSet, verbose);
        shouldTrigger = matchInfo.matchedLines > 0 || !requireMatch;
        log.debug("Target item scan", {
          ifId,
          lines: matchInfo.totalLines,
          matchedLines: matchInfo.matchedLines,
          matchedItemIds: Array.from(matchInfo.matchedItemIds || []),
          requireMatch,
          shouldTrigger,
        });
        if (!shouldTrigger) {
          log.debug("Skip: requireMatch=true and no target items present", {
            ifId,
          });
          return;
        }
      } else if (verbose) {
        scanFulfillmentItems(newRec, null, verbose);
      }

      const invoiceIds = findInvoicesFromSalesOrder(soId);
      log.audit("Related invoices found", {
        soId,
        count: invoiceIds.length,
        invoiceIds,
      });
      if (!invoiceIds.length) {
        log.debug("Done: No invoices found to touch", { ifId, soId });
        return;
      }

      const memoPrefix =
        memoPrefixCfg && memoPrefixCfg.length
          ? memoPrefixCfg
          : "[TOUCH " + formatNow() + "] ";
      let success = 0,
        failures = 0;

      invoiceIds.forEach((invId) => {
        try {
          if (mode === "DOUBLE") {
            const info = doubleEditToggle(
              invId,
              soId,
              touchFieldId,
              memoPrefix,
              leavePrefix,
              verbose,
              targetSet,
              { regFieldIds, regRegexStr, forceRegister }
            );
            log.audit("Invoice touched (DOUBLE)", { invId, ...info });
          } else {
            if (mode === "BOTH" || mode === "EDIT") {
              const savedIdEdit = touchSaveInvoice(
                invId,
                soId,
                "EDIT",
                verbose,
                touchFieldId,
                targetSet,
                { regFieldIds, regRegexStr, forceRegister }
              );
              log.audit("Invoice touched (EDIT)", {
                invId,
                savedId: savedIdEdit,
              });
            }
            if (mode === "BOTH" || mode === "XEDIT") {
              const savedIdXedit = touchSaveInvoice(
                invId,
                soId,
                "XEDIT",
                verbose,
                touchFieldId,
                targetSet,
                { regFieldIds, regRegexStr, forceRegister }
              );
              log.audit("Invoice touched (XEDIT)", {
                invId,
                savedId: savedIdXedit,
              });
            }
          }

          if (warrantyWfId) {
            try {
              workflow.trigger({
                recordType: record.Type.INVOICE,
                recordId: invId,
                workflowId: warrantyWfId,
              });
              log.audit("Workflow triggered", {
                invId,
                workflowId: warrantyWfId,
              });
            } catch (wfErr) {
              log.error("Workflow trigger failed", {
                invId,
                workflowId: warrantyWfId,
                error: wfErr.message,
              });
            }
          }

          try {
            const qInfo = enqueueWarrantyForInvoice(invId, verbose);
            log.audit("WRM queue enqueue result", { invId, ...qInfo });
          } catch (qErr) {
            log.error("WRM queue enqueue failed", {
              invId,
              error: qErr.message,
            });
          }

          // >>> Schedule WRM generator with explicit IDs -> common defaults -> auto-find
          try {
            const resolved = resolveWrMSchedulerWithDefaults(
              wrmScriptIdParam,
              wrmDeployIdParam,
              autoFindSched
            );
            if (resolved) {
              const t = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: resolved.scriptId,
                deploymentId: resolved.deploymentId || null,
              });
              const taskId = t.submit();
              log.audit("WRM generator scheduled", {
                invId,
                source: resolved.source,
                taskId,
                scriptId: resolved.scriptId,
                deploymentId: resolved.deploymentId,
              });
            } else {
              log.debug(
                "WRM generator NOT scheduled (no script/deploy resolved)",
                { invId, mode }
              );
              log.debug(
                "WRM generator NOT scheduled (no script/deploy resolved)",
                {
                  invId,
                  mode,
                  wrmScriptIdParam,
                  wrmDeployIdParam,
                  actor: actor(),
                  execContext: runtime.executionContext,
                }
              );
            }
          } catch (scheduleErr) {
            //logging change
            let errName =
              scheduleErr && scheduleErr.name ? scheduleErr.name : null;
            let errMsg =
              scheduleErr && scheduleErr.message
                ? scheduleErr.message
                : String(scheduleErr);
            let errStack =
              scheduleErr && scheduleErr.stack
                ? String(scheduleErr.stack).slice(0, 1500)
                : null;
            log.error("WRM generator schedule failed", {
              invId,
              name: errName,
              message: errMsg,
              stack: errStack,

              triedScriptId:
                (typeof resolved !== "undefined" &&
                  resolved &&
                  resolved.scriptId) ||
                wrmScriptIdParam ||
                null,
              triedDeploymentId:
                (typeof resolved !== "undefined" &&
                  resolved &&
                  resolved.deploymentId) ||
                wrmDeployIdParam ||
                null,
              actor: actor(),
              execContext: runtime.executionContext,
            });
          }

          success++;
        } catch (e) {
          failures++;
          log.error("Failed to process invoice", { invId, error: e.message });
        }
      });

      log.audit("IF UE Done", {
        ifId,
        soId,
        invoicesProcessed: invoiceIds.length,
        success,
        failures,
        elapsedMs: Date.now() - startTs,
      });
    } catch (e) {
      log.error("UE afterSubmit error", {
        message: e.message,
        stack: (e && e.stack) || "no stack",
        elapsedMs: Date.now() - startTs,
      });
    }
  }

  function enqueueWarrantyForInvoice(invoiceId, verbose) {
    const KNOWN_TYPES = [
      "customrecord_wrm_warrantyreg_queue",
      "customrecord_wrm_warrantyregister_queue",
      "customrecord_wrm_reg_queue",
      "customrecord_wrm_warranty_queue",
      "customrecord_wrm_queue",
    ];
    const F_INVOICE = "custrecord_wrm_queue_invoice";
    const F_STATUS = "custrecord_wrm_queue_status"; // 1 = Pending

    for (const t of KNOWN_TYPES) {
      const out = tryCreateQueue(t, invoiceId, F_INVOICE, F_STATUS, verbose);
      if (out && out.savedId)
        return { method: "known", type: t, queueId: out.savedId };
    }

    try {
      const found = [];
      const s = search.create({
        type: "customrecordtype",
        filters: [
          ["scriptid", "contains", "wrm"],
          "AND",
          [
            ["name", "contains", "Queue"],
            "OR",
            ["scriptid", "contains", "queue"],
          ],
        ],
        columns: ["scriptid", "name"],
      });
      s.run().each((r) => {
        found.push({
          scriptid: r.getValue("scriptid"),
          name: r.getValue("name"),
        });
        return found.length < 20;
      });
      if (verbose)
        log.debug("WRM enqueue: customrecordtype scan", { candidates: found });

      for (const cand of found) {
        const out = tryCreateQueue(
          cand.scriptid,
          invoiceId,
          F_INVOICE,
          F_STATUS,
          verbose
        );
        if (out && out.savedId)
          return {
            method: "scan",
            type: cand.scriptid,
            name: cand.name,
            queueId: out.savedId,
          };
      }
    } catch (e) {
      if (verbose)
        log.debug("WRM enqueue: customrecordtype scan failed", {
          error: e.message,
        });
    }

    return { method: "none", type: null, queueId: null };
  }

  function tryCreateQueue(
    typeScriptId,
    invoiceId,
    fldInvoice,
    fldStatus,
    verbose
  ) {
    try {
      const q = record.create({ type: typeScriptId, isDynamic: true });
      setIf(q, fldInvoice, invoiceId);
      setIf(q, fldStatus, 1); // Pending
      const id = q.save({ enableSourcing: true, ignoreMandatoryFields: true });
      if (verbose)
        log.debug("WRM enqueue: created queue", {
          typeScriptId,
          id,
          invoiceId,
          actor: actor(),
        });
      return { savedId: id };
    } catch (e) {
      if (verbose)
        log.debug("WRM enqueue: create attempt failed", {
          typeScriptId,
          error: e.message,
          actor: actor(),
        });
      return null;
    }
  }

  function setIf(rec, fieldId, value) {
    try {
      rec.setValue({ fieldId, value });
    } catch (e) {
      /* ignore if field missing on this type */
    }
  }

  // ----------------- WRM scheduler resolution (explicit -> defaults -> auto-find) -----------------

  function resolveWrMSchedulerWithDefaults(
    explicitScriptId,
    explicitDeployId,
    allowAutoFind
  ) {
    // 1) explicit (best)
    if (explicitScriptId || explicitDeployId) {
      let scriptId = explicitScriptId || null;
      if (!scriptId && explicitDeployId) {
        try {
          const s = search.create({
            type: "scriptdeployment",
            filters: [["scriptid", "is", explicitDeployId]],
            columns: [
              "scriptid",
              search.createColumn({ name: "scriptid", join: "script" }),
            ],
          });
          s.run().each((r) => {
            scriptId = r.getValue({ name: "scriptid", join: "script" });
            return false;
          });
        } catch (e) {}
      }
      if (scriptId)
        return {
          source: "explicit",
          scriptId,
          deploymentId: explicitDeployId || null,
        };
    }

    const DEFAULT_SCRIPT_IDS = [
      "customscript_wrm_ss_warrantyregister",
      "customscript_wrminv_ss_warrantyregister",
    ];
    const DEFAULT_DEPLOY_IDS = [
      "CUSTOMDEPLOY_WRM_SS_WARRANTYREGISTER",
      "customdeploy_wrm_ss_warrantyregister",
      null,
    ];
    for (const sId of DEFAULT_SCRIPT_IDS) {
      for (const dId of DEFAULT_DEPLOY_IDS) {
        return { source: "defaults", scriptId: sId, deploymentId: dId };
      }
    }

    if (allowAutoFind) {
      const cand = findWarrantyGeneratorDeployment();
      if (cand && cand.scriptId)
        return {
          source: "autofind",
          scriptId: cand.scriptId,
          deploymentId: cand.deploymentId || null,
        };
    }
    return null;
  }

  function getStatusValue(rec) {
    return (
      rec.getValue({ fieldId: "shipstatus" }) ||
      rec.getValue({ fieldId: "status" }) ||
      ""
    );
  }
  function isShipped(statusVal) {
    if (!statusVal) return false;
    const s = String(statusVal).toLowerCase();
    return s === "c" || s.indexOf("ship") >= 0;
  }
  function csvToIdSet(csv) {
    const set = new Set();
    csv.split(",").forEach((s) => {
      const n = Number(String(s).trim());
      if (!isNaN(n)) set.add(n);
    });
    return set;
  }

  function scanFulfillmentItems(fulfillmentRec, targetSet, verbose) {
    const n = fulfillmentRec.getLineCount({ sublistId: "item" }) || 0;
    let matchedLines = 0;
    const matchedItemIds = new Set();
    for (let i = 0; i < n; i++) {
      const itemId =
        Number(
          fulfillmentRec.getSublistValue({
            sublistId: "item",
            fieldId: "item",
            line: i,
          })
        ) || null;
      const qty =
        Number(
          fulfillmentRec.getSublistValue({
            sublistId: "item",
            fieldId: "quantity",
            line: i,
          })
        ) || 0;
      const rcv = fulfillmentRec.getSublistValue({
        sublistId: "item",
        fieldId: "itemreceive",
        line: i,
      });
      const shippedLine =
        qty > 0 && (rcv === true || rcv === "T" || rcv === "true");
      if (verbose)
        log.debug("IF line", {
          line: i,
          itemId,
          qty,
          itemreceive: rcv,
          isShippedLine: shippedLine,
        });
      if (targetSet && itemId != null && targetSet.has(itemId) && shippedLine) {
        matchedLines++;
        matchedItemIds.add(itemId);
      }
    }
    return { totalLines: n, matchedLines, matchedItemIds };
  }

  function findInvoicesFromSalesOrder(soId) {
    const ids = [];
    const s = search.create({
      type: search.Type.INVOICE,
      filters: [["createdfrom", "anyof", soId], "AND", ["mainline", "is", "T"]],
      columns: ["internalid"],
    });
    s.run().each((r) => {
      const id = Number(r.getValue("internalid"));
      if (!isNaN(id)) ids.push(id);
      return true;
    });
    return ids;
  }

  function findFulfillmentsFromSalesOrder(soId, limit = 5) {
    const ids = [];
    const s = search.create({
      type: search.Type.ITEM_FULFILLMENT,
      filters: [
        ["createdfrom", "anyof", soId],
        "AND",
        ["mainline", "is", "T"],
        "AND",
        ["status", "anyof", "ItemShip:C"],
      ],
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.DESC }),
      ],
    });
    s.run().each((r) => {
      ids.push(Number(r.getValue("internalid")));
      return ids.length < limit;
    });
    return ids;
  }

  function ensureInventoryDetailFromFulfillments(invDynamic, soId, verbose) {
    let addedTotal = 0;
    const ifIds = findFulfillmentsFromSalesOrder(soId, 3);
    if (!ifIds.length) {
      if (verbose) log.debug("No shipped fulfillments found for SO", { soId });
      return { addedTotal, ifIds, linesProcessed: 0 };
    }

    const pools = {};
    ifIds.forEach((id) => {
      try {
        const iff = record.load({
          type: record.Type.ITEM_FULFILLMENT,
          id,
          isDynamic: false,
        });
        const n = iff.getLineCount({ sublistId: "item" }) || 0;
        for (let i = 0; i < n; i++) {
          const itemId =
            Number(
              iff.getSublistValue({
                sublistId: "item",
                fieldId: "item",
                line: i,
              })
            ) || null;
          if (!itemId) continue;
          const invd = safeGetSubrecord(iff, "item", "inventorydetail", i);
          if (!invd) continue;
          const m =
            invd.getLineCount({ sublistId: "inventoryassignment" }) || 0;
          for (let j = 0; j < m; j++) {
            const qty =
              Number(
                invd.getSublistValue({
                  sublistId: "inventoryassignment",
                  fieldId: "quantity",
                  line: j,
                })
              ) || 0;
            let num = invd.getSublistValue({
              sublistId: "inventoryassignment",
              fieldId: "issueinventorynumber",
              line: j,
            });
            if (!num)
              num = invd.getSublistValue({
                sublistId: "inventoryassignment",
                fieldId: "receiptinventorynumber",
                line: j,
              });
            if (!num || !qty) continue;
            (pools[itemId] = pools[itemId] || []).push({ num, qty });
          }
        }
      } catch (e) {
        log.debug("Load IF failed while building pools", {
          id,
          error: e.message,
        });
      }
    });

    const nLines = invDynamic.getLineCount({ sublistId: "item" }) || 0;
    for (let i = 0; i < nLines; i++) {
      const itemId =
        Number(
          invDynamic.getSublistValue({
            sublistId: "item",
            fieldId: "item",
            line: i,
          })
        ) || null;
      if (!itemId) continue;
      const invd = ensureLineInventoryDetail(invDynamic, i);
      if (!invd) {
        if (verbose)
          log.debug("No inventorydetail available on invoice line", {
            line: i,
            itemId,
          });
        continue;
      }

      const current =
        invd.getLineCount({ sublistId: "inventoryassignment" }) || 0;
      if (current > 0) continue;

      const neededQty =
        Number(
          invDynamic.getSublistValue({
            sublistId: "item",
            fieldId: "quantity",
            line: i,
          })
        ) || 0;
      const pool = pools[itemId] || [];
      if (!pool.length || !neededQty) continue;

      let remaining = neededQty;
      let added = 0;
      for (let k = 0; k < pool.length && remaining > 0; k++) {
        const { num, qty } = pool[k];
        const useQty = Math.min(qty, remaining);
        try {
          const newIdx =
            invd.getLineCount({ sublistId: "inventoryassignment" }) || 0;
          let setOk = false;
          try {
            invd.setSublistValue({
              sublistId: "inventoryassignment",
              fieldId: "issueinventorynumber",
              line: newIdx,
              value: num,
            });
            setOk = true;
          } catch (e1) {
            try {
              invd.setSublistValue({
                sublistId: "inventoryassignment",
                fieldId: "receiptinventorynumber",
                line: newIdx,
                value: num,
              });
              setOk = true;
            } catch (e2) {}
          }
          invd.setSublistValue({
            sublistId: "inventoryassignment",
            fieldId: "quantity",
            line: newIdx,
            value: useQty,
          });
          if (setOk) {
            remaining -= useQty;
            added++;
          }
        } catch (e) {
          log.debug("Failed to add inventoryassignment on invoice", {
            line: i,
            itemId,
            error: e.message,
          });
        }
      }
      if (added && verbose)
        log.debug("Copied inventory detail from IF pool", {
          line: i,
          itemId,
          added,
          neededQty,
        });
      addedTotal += added;
    }
    return { addedTotal, ifIds, linesProcessed: nLines };
  }

  function safeGetSubrecord(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistSubrecord({ sublistId, fieldId, line });
    } catch (e) {
      return null;
    }
  }
  function ensureLineInventoryDetail(invDynamic, line) {
    try {
      return invDynamic.getSublistSubrecord({
        sublistId: "item",
        fieldId: "inventorydetail",
        line,
      });
    } catch (e) {
      try {
        invDynamic.selectLine({ sublistId: "item", line });
        return invDynamic.getCurrentSublistSubrecord({
          sublistId: "item",
          fieldId: "inventorydetail",
        });
      } catch (e2) {
        return null;
      }
    }
  }

  function discoverRegisterColumns(inv, regFieldIds, regRegexStr, verbose) {
    let candidates = new Set(regFieldIds || []);
    try {
      const fields = inv.getSublistFields({ sublistId: "item" }) || [];
      const rx = new RegExp(regRegexStr, "i");
      fields.forEach((fid) => {
        if (rx.test(fid)) candidates.add(fid);
      });
      if (verbose)
        log.debug("Register column discovery", {
          matched: Array.from(candidates),
        });
    } catch (e) {
      if (verbose)
        log.debug("getSublistFields not available/failed", {
          error: e.message,
        });
    }
    return Array.from(candidates);
  }

  function applyRegisterFlagsIfNeeded(inv, targetSet, opts, verbose) {
    const n = inv.getLineCount({ sublistId: "item" }) || 0;
    const candidates = discoverRegisterColumns(
      inv,
      opts.regFieldIds,
      opts.regRegexStr,
      verbose
    );
    let setCount = 0;
    for (let i = 0; i < n; i++) {
      const itemId =
        Number(
          inv.getSublistValue({ sublistId: "item", fieldId: "item", line: i })
        ) || null;
      if (!opts.forceRegister && targetSet && !targetSet.has(itemId)) continue;

      let applied = false;
      for (const fid of candidates) {
        try {
          inv.setSublistValue({
            sublistId: "item",
            fieldId: fid,
            line: i,
            value: true,
          });
          applied = true;
          setCount++;
          if (verbose)
            log.debug("Register flag set", { line: i, itemId, fieldId: fid });
          break;
        } catch (e) {
          /* ignore if not writable */
        }
      }
      if (!applied && verbose)
        log.debug("Register flag not applied (no matching/writable field)", {
          line: i,
          itemId,
          tried: candidates,
        });
    }
    return setCount;
  }

  function touchSaveInvoice(
    invoiceId,
    soId,
    mode,
    verbose,
    fieldId,
    targetSet,
    opts
  ) {
    if (mode === "XEDIT") {
      const val = safeLoadField(invoiceId, fieldId);
      if (verbose)
        log.debug("XEDIT noop submitFields", {
          invoiceId,
          fieldId,
          sample: sampleStr(val),
        });
      record.submitFields({
        type: record.Type.INVOICE,
        id: invoiceId,
        values: { [fieldId]: val || "" },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
      return invoiceId;
    } else {
      const inv = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: true,
      });
      const invdInfo = ensureInventoryDetailFromFulfillments(
        inv,
        soId,
        verbose
      );
      if (verbose)
        log.debug("ensureInventoryDetailFromFulfillments", {
          invoiceId,
          ...invdInfo,
        });
      const setCount = applyRegisterFlagsIfNeeded(
        inv,
        targetSet,
        opts,
        verbose
      );
      if (verbose) log.debug("Register flags applied", { invoiceId, setCount });
      const val = inv.getValue({ fieldId }) || "";
      inv.setValue({ fieldId, value: val });
      if (verbose)
        log.debug("EDIT load+save", {
          invoiceId,
          fieldId,
          sample: sampleStr(val),
        });
      return inv.save({ enableSourcing: true, ignoreMandatoryFields: true });
    }
  }

  function doubleEditToggle(
    invoiceId,
    soId,
    fieldId,
    prefix,
    leavePrefix,
    verbose,
    targetSet,
    opts
  ) {
    const beforeVal = safeLoadField(invoiceId, fieldId) || "";
    const prefixed = String(prefix) + String(beforeVal || "");

    let inv = record.load({
      type: record.Type.INVOICE,
      id: invoiceId,
      isDynamic: true,
    });
    const invdInfo = ensureInventoryDetailFromFulfillments(inv, soId, verbose);
    const setCount = applyRegisterFlagsIfNeeded(inv, targetSet, opts, verbose);
    inv.setValue({ fieldId, value: prefixed });
    const save1 = inv.save({
      enableSourcing: true,
      ignoreMandatoryFields: true,
    });
    if (verbose)
      log.debug("DOUBLE step 1 (prefixed + flags + invDetail)", {
        invoiceId,
        setCount,
        invDetailAdded: invdInfo.addedTotal,
        fieldId,
        prefixedSample: sampleStr(prefixed),
      });

    let save2 = null;
    if (!leavePrefix) {
      inv = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: false,
      });
      inv.setValue({ fieldId, value: beforeVal });
      save2 = inv.save({ enableSourcing: true, ignoreMandatoryFields: true });
      if (verbose)
        log.debug("DOUBLE step 2 (revert)", {
          invoiceId,
          fieldId,
          originalSample: sampleStr(beforeVal),
        });
    }
    return {
      save1,
      save2,
      changedField: fieldId,
      leftPrefixed: !!leavePrefix,
      registerFlagsSet: setCount,
      invDetailAdded: invdInfo.addedTotal,
    };
  }

  function safeLoadField(invoiceId, fieldId) {
    try {
      const inv = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: false,
      });
      return inv.getValue({ fieldId });
    } catch (e) {
      log.debug("safeLoadField fallback", {
        invoiceId,
        fieldId,
        error: e.message,
      });
      return "";
    }
  }

  function findWarrantyGeneratorDeployment() {
    const results = [];
    const s = search.create({
      type: "scriptdeployment",
      filters: [
        ["status", "anyof", "ENABLED"],
        "AND",
        ["isdeployed", "is", "T"],
        "AND",
        ["script.scripttype", "anyof", "SCHEDULED"],
        "AND",
        [
          ["title", "contains", "Warranty"],
          "OR",
          ["title", "contains", "WRM"],
          "OR",
          ["scriptid", "contains", "WRM"],
          "OR",
          ["script.scriptid", "contains", "WRM"],
          "OR",
          ["script.scriptid", "contains", "WARRANT"],
        ],
      ],
      columns: [
        "title",
        "scriptid",
        search.createColumn({ name: "scriptid", join: "script" }),
      ],
    });
    s.run().each((r) => {
      results.push({
        title: r.getValue("title"),
        deploymentId: r.getValue("scriptid"),
        scriptId: r.getValue({ name: "scriptid", join: "script" }),
      });
      return results.length < 5;
    });
    results.sort((a, b) => score(b) - score(a));
    return results[0] || null;

    function score(x) {
      const t = (
        (x.title || "") +
        " " +
        (x.scriptId || "") +
        " " +
        (x.deploymentId || "")
      ).toLowerCase();
      let s = 0;
      if (t.includes("warranty")) s += 3;
      if (
        t.includes("register") ||
        t.includes("generate") ||
        t.includes("create")
      )
        s += 2;
      if (t.includes("wrm")) s += 1;
      return s;
    }
  }

  // ----- misc -----

  function actor() {
    try {
      const u = runtime.getCurrentUser();
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        roleId: u.roleId,
        executionContext: runtime.executionContext,
      };
    } catch (e) {
      return { executionContext: runtime.executionContext };
    }
  }
  function sampleStr(s) {
    const str = s == null ? "" : String(s);
    return str.length > 40 ? str.slice(0, 40) + "…" : str;
  }
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function formatNow() {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate()) +
      " " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes()) +
      ":" +
      pad2(d.getSeconds())
    );
  }

  return { afterSubmit };
});
