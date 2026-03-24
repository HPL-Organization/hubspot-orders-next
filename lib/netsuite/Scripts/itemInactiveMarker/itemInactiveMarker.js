/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/record", "N/log"], (search, record, log) => {
  // Hard-coded SKU list (from your screenshot)
  const SKU_LIST = [
    "HW0000P",
    "GWS000P",
    "GWP000P",
    "GWR000P",
    "GT0000P",
    "FLH2400P",
    "FLH1800P",
    "FLH0800P",
    "FLH0600P",
    "DW00000P",
    "DS0000P",
    "DCB000P",
    "CS0000P",
  ];

  function findItemBySku(sku) {
    const s = search.create({
      type: search.Type.ITEM,
      filters: [["itemid", "is", sku]],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "recordtype" }),
        search.createColumn({ name: "itemid" }),
        search.createColumn({ name: "isinactive" }),
        search.createColumn({ name: "matrixparent" }), // empty for parent, set for child
      ],
    });

    const r = s.run().getRange({ start: 0, end: 2 }) || [];
    if (!r.length) return null;

    if (r.length > 1) {
      log.error("SKU matched multiple items (ambiguous)", {
        sku,
        count: r.length,
      });
    }

    const row = r[0];
    const isinactiveVal = row.getValue({ name: "isinactive" });
    const matrixparentVal = row.getValue({ name: "matrixparent" });

    return {
      id: Number(row.getValue({ name: "internalid" })),
      recordType: row.getValue({ name: "recordtype" }),
      sku: row.getValue({ name: "itemid" }),
      isinactive: isinactiveVal === true || isinactiveVal === "T",
      matrixparent: matrixparentVal ? Number(matrixparentVal) : null,
    };
  }

  function getActiveChildren(parentId) {
    const s = search.create({
      type: search.Type.ITEM,
      filters: [
        ["matrixparent", "anyof", parentId],
        "AND",
        ["isinactive", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "recordtype" }),
        search.createColumn({ name: "itemid" }),
      ],
    });

    const out = [];
    const paged = s.runPaged({ pageSize: 1000 });

    paged.pageRanges.forEach((pr) => {
      const page = paged.fetch({ index: pr.index });
      page.data.forEach((row) => {
        out.push({
          id: Number(row.getValue({ name: "internalid" })),
          recordType: row.getValue({ name: "recordtype" }),
          sku: row.getValue({ name: "itemid" }),
        });
      });
    });

    return out;
  }

  function getInputData() {
    // de-dupe while preserving order
    const seen = new Set();
    return SKU_LIST.filter((s) => {
      const k = String(s).trim().toUpperCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function map(ctx) {
    const sku = String(ctx.value || "").trim();
    if (!sku) return;

    const item = findItemBySku(sku);
    if (!item) {
      log.error("SKU not found", { sku });
      return;
    }

    // Only change: set this item inactive (no other fields)
    if (item.isinactive) {
      log.audit("Already inactive (no change)", {
        sku: item.sku,
        id: item.id,
        recordType: item.recordType,
      });
    } else {
      try {
        record.submitFields({
          type: item.recordType,
          id: item.id,
          values: { isinactive: true },
          options: { enableSourcing: false, ignoreMandatoryFields: true },
        });
        log.audit("Marked inactive", {
          sku: item.sku,
          id: item.id,
          recordType: item.recordType,
        });
      } catch (e) {
        log.error("Failed to mark inactive", {
          sku: item.sku,
          id: item.id,
          recordType: item.recordType,
          error: e && (e.message || e.toString()),
        });
        return;
      }
    }

    // Do NOT touch children. Only log if any child is still active.
    // Only makes sense if this SKU is a matrix parent (matrixparent is empty).
    if (!item.matrixparent) {
      const activeChildren = getActiveChildren(item.id);
      if (activeChildren.length) {
        // Log count + sample list to avoid giant logs
        const sample = activeChildren.slice(0, 50);
        log.error("Active matrix children found (NOT changing them)", {
          parentSku: item.sku,
          parentId: item.id,
          activeChildCount: activeChildren.length,
          sampleUpTo50: sample,
        });
      } else {
        log.audit("All matrix children already inactive (or no children)", {
          parentSku: item.sku,
          parentId: item.id,
        });
      }
    } else {
      // If they accidentally pass a child SKU, we still inactivated that SKU (as requested),
      // but we do not attempt any child logging off it.
      log.audit("Input SKU is a matrix child; no child-check performed", {
        sku: item.sku,
        id: item.id,
        parentId: item.matrixparent,
      });
    }
  }

  function summarize(summary) {
    if (summary.inputSummary?.error)
      log.error("Input error", summary.inputSummary.error);
    summary.mapSummary?.errors?.iterator().each((k, e) => {
      log.error("Map error", { key: k, error: e });
      return true;
    });
    log.audit("Done", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
    });
  }

  return { getInputData, map, summarize };
});
