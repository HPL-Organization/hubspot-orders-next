/**
 *
 * Explodes "Soft BOM parent" lines on Sales Orders into component lines.
 * Source of truth is custom records (NOT item member/components).
 *
 * NEW STRUCTURE:
 * - Header record: customrecord_hpl_softbom
 * - Component parent records: customrecord_hpl_softbom_comp (grouping record per header)
 * - Component line records: customrecord_hpl_soft_bom_comp_line (multiple items per component parent)
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/search", "N/log"], (search, log) => {
  // ===== CONFIG =====
  const PARENT_TRIGGER_ITEM_FIELD = "custitem_hpl_custom_soft_assembly";

  // SO line fields
  const COL_PARENT_ITEM = "custcol_hpl_softbom_parent";
  const COL_IS_CHILD = "custcol_hpl_softbom_child";
  const COL_GROUPKEY = "custcol_hpl_softbom_groupkey";

  // Header record
  const REC_HDR = "customrecord_hpl_softbom";
  const HDR_PARENT_ITEM = "custrecord_hpl_sbom_parent";
  const HDR_ACTIVE = "custrecord_hpl_sbom_active";

  // Component parent record (links header -> component parent)
  const REC_COMP_PARENT = "customrecord_hpl_softbom_comp";
  const COMP_PARENT_HDR = "custrecord_hpl_sbom_hdr";

  // Component line record (multiple lines per component parent)
  const REC_COMP_LINE = "customrecord_hpl_soft_bom_comp_line";
  const LINE_PARENT_COMP = "custrecord_hpl_soft_bom_comp_parent";
  const LINE_ITEM = "custrecord_hpl_soft_bom_comp_item";
  const LINE_QTY_PER = "custrecord_hpl_soft_bom_comp_qty_per";

  const ZERO_COMPONENT_PRICING = true;

  // ===== caches =====
  const parentFlagCache = new Map();
  const headerCache = new Map();
  const compParentIdsCache = new Map(); // headerId -> [componentParentIds]
  const componentsCache = new Map(); // headerId -> [{ itemId, qtyPer }]

  function beforeSubmit(context) {
    if (
      ![context.UserEventType.CREATE, context.UserEventType.EDIT].includes(
        context.type
      )
    ) {
      return;
    }

    const so = context.newRecord;
    const lineCount = so.getLineCount({ sublistId: "item" }) || 0;
    if (!lineCount) return;

    const oldByKey = buildOldLineMap(context.oldRecord);

    for (let i = lineCount - 1; i >= 0; i--) {
      const isChild = truthy(
        so.getSublistValue({
          sublistId: "item",
          fieldId: COL_IS_CHILD,
          line: i,
        })
      );
      if (isChild) continue;

      const parentItemId = so.getSublistValue({
        sublistId: "item",
        fieldId: "item",
        line: i,
      });
      if (!parentItemId) continue;

      if (!isSoftParentItem(parentItemId)) continue;

      const parentQty = asNumber(
        so.getSublistValue({ sublistId: "item", fieldId: "quantity", line: i })
      );
      if (parentQty <= 0) continue;

      const locationId =
        so.getSublistValue({
          sublistId: "item",
          fieldId: "location",
          line: i,
        }) || null;

      const existingGroupKey =
        so.getSublistValue({
          sublistId: "item",
          fieldId: COL_GROUPKEY,
          line: i,
        }) || "";

      let shouldRebuild = false;
      if (context.type === context.UserEventType.EDIT && existingGroupKey) {
        const lk = so.getSublistValue({
          sublistId: "item",
          fieldId: "lineuniquekey",
          line: i,
        });
        const oldLine = lk ? oldByKey.get(String(lk)) : null;
        if (oldLine && oldLine.groupKey === existingGroupKey) {
          if (oldLine.qty !== parentQty) shouldRebuild = true;
        }
      }

      if (existingGroupKey && !shouldRebuild) continue;

      const headerId = findActiveHeaderId(parentItemId);
      if (!headerId) {
        log.debug("Soft BOM header not found (active) for parent item", {
          parentItemId: String(parentItemId),
        });
        continue;
      }

      const components = getComponentsForHeader(headerId);
      if (!components.length) {
        log.debug("Soft BOM header has no component lines", {
          headerId: String(headerId),
        });
        continue;
      }

      let groupKey = existingGroupKey;
      if (shouldRebuild && groupKey) {
        removeAllChildrenByGroupKey(so, groupKey);
      }

      if (!groupKey) {
        groupKey = makeGroupKey(so, parentItemId, i);
        safeSetLine(so, i, COL_GROUPKEY, groupKey);
      }

      for (let c = components.length - 1; c >= 0; c--) {
        const comp = components[c];
        if (!comp.itemId || comp.qtyPer <= 0) continue;

        const compQty = parentQty * comp.qtyPer;

        so.insertLine({ sublistId: "item", line: i + 1 });

        so.setSublistValue({
          sublistId: "item",
          fieldId: "item",
          line: i + 1,
          value: comp.itemId,
        });
        so.setSublistValue({
          sublistId: "item",
          fieldId: "quantity",
          line: i + 1,
          value: compQty,
        });

        if (locationId) {
          safeSetLine(so, i + 1, "location", locationId);
        }

        if (ZERO_COMPONENT_PRICING) {
          safeSetLine(so, i + 1, "price", -1);
          safeSetLine(so, i + 1, "rate", 0);
          safeSetLine(so, i + 1, "amount", 0);
        }

        safeSetLine(so, i + 1, COL_PARENT_ITEM, Number(parentItemId));
        safeSetLine(so, i + 1, COL_IS_CHILD, true);
        safeSetLine(so, i + 1, COL_GROUPKEY, groupKey);
      }
    }
  }

  // ===== helpers =====

  function buildOldLineMap(oldRec) {
    const map = new Map();
    if (!oldRec) return map;

    const cnt = oldRec.getLineCount({ sublistId: "item" }) || 0;
    for (let i = 0; i < cnt; i++) {
      const lk = oldRec.getSublistValue({
        sublistId: "item",
        fieldId: "lineuniquekey",
        line: i,
      });
      if (!lk) continue;

      map.set(String(lk), {
        qty: asNumber(
          oldRec.getSublistValue({
            sublistId: "item",
            fieldId: "quantity",
            line: i,
          })
        ),
        groupKey:
          oldRec.getSublistValue({
            sublistId: "item",
            fieldId: COL_GROUPKEY,
            line: i,
          }) || "",
      });
    }
    return map;
  }

  function isSoftParentItem(itemId) {
    const id = String(itemId);
    if (parentFlagCache.has(id)) return parentFlagCache.get(id);

    const lookup = search.lookupFields({
      type: search.Type.ITEM,
      id: itemId,
      columns: [PARENT_TRIGGER_ITEM_FIELD],
    });

    const flag = truthy(lookup?.[PARENT_TRIGGER_ITEM_FIELD]);
    parentFlagCache.set(id, flag);
    return flag;
  }

  function findActiveHeaderId(parentItemId) {
    const k = String(parentItemId);
    if (headerCache.has(k)) return headerCache.get(k);

    let headerId = null;

    const s = search.create({
      type: REC_HDR,
      filters: [
        [HDR_PARENT_ITEM, "anyof", parentItemId],
        "AND",
        [HDR_ACTIVE, "is", "T"],
        "AND",
        ["isinactive", "is", "F"],
      ],
      columns: [search.createColumn({ name: "internalid" })],
    });

    const res = s.run().getRange({ start: 0, end: 1 }) || [];
    if (res.length) headerId = res[0].getValue({ name: "internalid" }) || null;

    headerCache.set(k, headerId);
    return headerId;
  }

  function getComponentParentIdsForHeader(headerId) {
    const k = String(headerId);
    if (compParentIdsCache.has(k)) return compParentIdsCache.get(k);

    const ids = [];
    const s = search.create({
      type: REC_COMP_PARENT,
      filters: [
        [COMP_PARENT_HDR, "anyof", headerId],
        "AND",
        ["isinactive", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
      ],
    });

    s.run().each((r) => {
      const id = r.getValue({ name: "internalid" });
      if (id) ids.push(Number(id));
      return true;
    });

    compParentIdsCache.set(k, ids);
    return ids;
  }

  function getComponentsForHeader(headerId) {
    const k = String(headerId);
    if (componentsCache.has(k)) return componentsCache.get(k);

    const compParentIds = getComponentParentIdsForHeader(headerId);
    if (!compParentIds.length) {
      componentsCache.set(k, []);
      return [];
    }

    const out = [];
    const s = search.create({
      type: REC_COMP_LINE,
      filters: [
        [LINE_PARENT_COMP, "anyof", compParentIds],
        "AND",
        ["isinactive", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
        search.createColumn({ name: LINE_ITEM }),
        search.createColumn({ name: LINE_QTY_PER }),
      ],
    });

    s.run().each((r) => {
      const itemId = r.getValue({ name: LINE_ITEM });
      const qtyPer = r.getValue({ name: LINE_QTY_PER });

      out.push({
        itemId: itemId ? Number(itemId) : null,
        qtyPer: asNumber(qtyPer),
      });
      return true;
    });

    componentsCache.set(k, out);
    return out;
  }

  function removeAllChildrenByGroupKey(so, groupKey) {
    const cnt = so.getLineCount({ sublistId: "item" }) || 0;
    for (let i = cnt - 1; i >= 0; i--) {
      const isChild = truthy(
        so.getSublistValue({
          sublistId: "item",
          fieldId: COL_IS_CHILD,
          line: i,
        })
      );
      if (!isChild) continue;

      const gk =
        so.getSublistValue({
          sublistId: "item",
          fieldId: COL_GROUPKEY,
          line: i,
        }) || "";
      if (gk === groupKey) {
        so.removeLine({ sublistId: "item", line: i });
      }
    }
  }

  function makeGroupKey(so, parentItemId, lineIndex) {
    const tranId = so.getValue({ fieldId: "tranid" }) || "SO";
    return `SBOM|${tranId}|item=${parentItemId}|line=${lineIndex}|ts=${Date.now()}|r=${Math.floor(
      Math.random() * 1e6
    )}`;
  }

  function safeSetLine(so, line, fieldId, value) {
    try {
      so.setSublistValue({ sublistId: "item", fieldId, line, value });
    } catch (e) {}
  }

  function asNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function truthy(v) {
    return v === true || v === "T" || v === 1 || v === "1";
  }

  return { beforeSubmit };
});
