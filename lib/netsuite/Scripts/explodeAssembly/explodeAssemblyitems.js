/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/search", "N/log"], function (record, search, log) {
  // ===== ITEM FLAG =====
  var SOFT_ASSEMBLY_ITEM_FLAG = "custitem_hpl_custom_soft_assembly";

  // ===== SO LINE FIELDS ( HPL IDs) =====
  var COL_GROUP_ID = "custcol_hpl_softkit_group_id";
  var COL_IS_COMPONENT = "custcol_hpl_softkit_is_component";
  var COL_EXPLODED = "custcol_hpl_softkit_exploded";
  var COL_PARENT_ITEM = "custcol_hpl_softkit_parent_item";
  var COL_QTY_PER = "custcol_hpl_softkit_component_qty_per";

  // ===== Assembly "Components" sublist internal IDs  =====

  var ASM_COMPONENT_SUBLIST = "member";
  var ASM_COMP_ITEM_FIELD = "item";
  var ASM_COMP_QTY_FIELD = "quantity";

  var ZERO_COMPONENT_PRICING = true;

  var softFlagCache = {};
  var componentsCache = {};

  function beforeSubmit(context) {
    if (
      context.type !== context.UserEventType.CREATE &&
      context.type !== context.UserEventType.EDIT
    ) {
      return;
    }

    var so = context.newRecord;
    var lineCount = so.getLineCount({ sublistId: "item" }) || 0;
    if (!lineCount) return;

    // iterate bottom-up because we insert lines
    for (var i = lineCount - 1; i >= 0; i--) {
      var isComponent = !!so.getSublistValue({
        sublistId: "item",
        fieldId: COL_IS_COMPONENT,
        line: i,
      });
      if (isComponent) continue;

      var alreadyExploded = !!so.getSublistValue({
        sublistId: "item",
        fieldId: COL_EXPLODED,
        line: i,
      });
      if (alreadyExploded) continue;

      var parentItemId = so.getSublistValue({
        sublistId: "item",
        fieldId: "item",
        line: i,
      });
      if (!parentItemId) continue;

      if (!isSoftAssemblyItem(parentItemId)) continue;

      var parentQty =
        Number(
          so.getSublistValue({
            sublistId: "item",
            fieldId: "quantity",
            line: i,
          })
        ) || 0;
      if (parentQty <= 0) continue;

      var locationId =
        so.getSublistValue({
          sublistId: "item",
          fieldId: "location",
          line: i,
        }) || null;

      var components = getAssemblyComponents(parentItemId);
      if (!components.length) {
        log.debug("Soft assembly has no components (or IDs mismatch)", {
          parentItemId: parentItemId,
          sublist: ASM_COMPONENT_SUBLIST,
          itemField: ASM_COMP_ITEM_FIELD,
          qtyField: ASM_COMP_QTY_FIELD,
        });
        continue;
      }

      var groupId = makeGroupId(parentItemId);

      // mark parent
      safeSet(so, "item", COL_GROUP_ID, i, groupId);
      safeSet(so, "item", COL_EXPLODED, i, true);

      // insert components under parent, preserving component order
      for (var c = components.length - 1; c >= 0; c--) {
        var comp = components[c];
        if (!comp.itemId || !(comp.qtyPer > 0)) continue;

        var compQty = parentQty * comp.qtyPer;

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
          safeSet(so, "item", "location", i + 1, locationId);
        }

        if (ZERO_COMPONENT_PRICING) {
          safeSet(so, "item", "price", i + 1, -1);
          safeSet(so, "item", "rate", i + 1, 0);
          safeSet(so, "item", "amount", i + 1, 0);
        }

        // tag component line
        safeSet(so, "item", COL_GROUP_ID, i + 1, groupId);
        safeSet(so, "item", COL_IS_COMPONENT, i + 1, true);

        // audit/debug
        safeSet(so, "item", COL_PARENT_ITEM, i + 1, parentItemId);
        safeSet(so, "item", COL_QTY_PER, i + 1, comp.qtyPer);
      }
    }
  }

  function isSoftAssemblyItem(itemId) {
    var key = String(itemId);
    if (softFlagCache.hasOwnProperty(key)) return softFlagCache[key];

    var lookup = search.lookupFields({
      type: search.Type.ITEM,
      id: itemId,
      columns: [SOFT_ASSEMBLY_ITEM_FLAG],
    });

    var flag = !!(lookup && lookup[SOFT_ASSEMBLY_ITEM_FLAG]);
    softFlagCache[key] = flag;
    return flag;
  }

  function getAssemblyComponents(assemblyItemId) {
    var key = String(assemblyItemId);
    if (componentsCache.hasOwnProperty(key)) return componentsCache[key];

    var results = [];

    // Some accounts use different internal record types; this is the most common.
    var rec = record.load({
      type: record.Type.ASSEMBLY_ITEM,
      id: assemblyItemId,
      isDynamic: false,
    });

    var count = rec.getLineCount({ sublistId: ASM_COMPONENT_SUBLIST }) || 0;
    for (var i = 0; i < count; i++) {
      var compItemId = rec.getSublistValue({
        sublistId: ASM_COMPONENT_SUBLIST,
        fieldId: ASM_COMP_ITEM_FIELD,
        line: i,
      });
      var qtyPer = rec.getSublistValue({
        sublistId: ASM_COMPONENT_SUBLIST,
        fieldId: ASM_COMP_QTY_FIELD,
        line: i,
      });

      var itemNum = Number(compItemId);
      var qtyNum = Number(qtyPer);

      if (Number.isFinite(itemNum) && Number.isFinite(qtyNum) && qtyNum > 0) {
        results.push({ itemId: itemNum, qtyPer: qtyNum });
      }
    }

    componentsCache[key] = results;
    return results;
  }

  function makeGroupId(itemId) {
    return (
      "HPLSK-" +
      String(itemId) +
      "-" +
      String(new Date().getTime()) +
      "-" +
      String(Math.floor(Math.random() * 1000000))
    );
  }

  function safeSet(rec, sublistId, fieldId, line, value) {
    try {
      rec.setSublistValue({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line,
        value: value,
      });
    } catch (e) {}
  }

  return {
    beforeSubmit: beforeSubmit,
  };
});
