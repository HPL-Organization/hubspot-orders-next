/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/record", "N/log"], (search, record, log) => {
  // ===== TEST CONFIG =====
  const TARGET_ITEM_ID = 18332; // ONLY touch this item
  const DRY_RUN = false; // true = do not save
  const SKIP_IF_INACTIVE = false; // set true for a safety run (no save if inactive)

  const IMAGE_FIELDS = [
    "custitem_atlas_item_image",
    "custitem_nsc_image_2",
    "custitem_nsc_image_3",
    "custitem_nsc_image_4",
    "custitem_nsc_image_5",
    "custitem_nsc_image_6",
    "custitem_nsc_image_7",
    "custitem_nsc_image_8",
    "custitem_nsc_image_9",
    "custitem_nsc_image_10",
  ];

  const MEDIA_SUBLIST = { enabled: true, sublistId: "mediaitem" };

  function itemTypeAliasToRecordType(alias) {
    const m = {
      InvtPart: record.Type.INVENTORY_ITEM,
      Assembly: record.Type.ASSEMBLY_ITEM,
      Kit: record.Type.KIT_ITEM,
      OtherCharge: record.Type.OTHER_CHARGE_ITEM,
      GiftCert: record.Type.GIFT_CERTIFICATE_ITEM,
      DownloadItem: record.Type.DOWNLOAD_ITEM,
      LotNumberedInvtPart: record.Type.LOT_NUMBERED_INVENTORY_ITEM,
      SerializedInvtPart: record.Type.SERIALIZED_INVENTORY_ITEM,
      // NonInvtPart and Service intentionally excluded
    };
    return m[alias] || null;
  }

  // Return ONLY the target item (and only if it has any images populated, like original logic)
  const getInputData = () => {
    const imageAnyFilter = [];
    IMAGE_FIELDS.forEach((f, i) => {
      if (i) imageAnyFilter.push("OR");
      imageAnyFilter.push([f, "noneof", "@NONE@"]);
    });

    return search.create({
      type: "item",
      filters: [
        ["internalid", "anyof", String(TARGET_ITEM_ID)],
        "AND",
        ["type", "noneof", "NonInvtPart", "Service"],
        "AND",
        imageAnyFilter,
      ],
      columns: [
        "internalid",
        "isinactive",
        search.createColumn({ name: "type" }),
        "itemid",
      ],
    });
  };

  const map = (ctx) => {
    const row = JSON.parse(ctx.value);
    const itemId = Number(row.id || row.values.internalid);

    const typeCol = row.values.type;
    const typeAlias = (typeCol && (typeCol.value || typeCol)) || null;
    const recType = itemTypeAliasToRecordType(typeAlias);

    const sku = row.values.itemid || "";
    const inactiveFromSearch =
      row.values.isinactive === true ||
      row.values.isinactive === "T" ||
      row.values.isinactive === "true";

    log.audit(
      "TEST item picked",
      `id=${itemId} sku=${sku} alias=${typeAlias} inactive(search)=${inactiveFromSearch}`
    );

    if (!recType) {
      log.audit(
        "Skipped unsupported item type",
        `id=${itemId} alias=${typeAlias}`
      );
      return;
    }

    let rec;
    try {
      rec = record.load({ type: recType, id: itemId, isDynamic: false });
    } catch (e) {
      log.error("Load failed", `id=${itemId} err=${e.message}`);
      return;
    }

    const inactiveBefore = !!rec.getValue({ fieldId: "isinactive" });
    log.audit("Inactive BEFORE", `item=${itemId} isinactive=${inactiveBefore}`);

    if (SKIP_IF_INACTIVE && inactiveBefore) {
      log.audit("SKIP due to inactive", `item=${itemId} (no changes saved)`);
      return;
    }

    let cleared = 0;
    for (const fieldId of IMAGE_FIELDS) {
      try {
        const curr = rec.getValue({ fieldId });
        if (curr) {
          rec.setValue({ fieldId, value: null });
          cleared++;
        }
      } catch (e) {
        log.error(
          "Clear failed",
          `item=${itemId} field=${fieldId} err=${e.message}`
        );
      }
    }

    if (MEDIA_SUBLIST.enabled) {
      try {
        const sublistId = MEDIA_SUBLIST.sublistId;
        const count = rec.getLineCount({ sublistId }) || 0;
        for (let i = count - 1; i >= 0; i--) {
          rec.removeLine({ sublistId, line: i });
        }
        log.audit(
          "Media sublist cleared",
          `item=${itemId} linesRemoved=${count}`
        );
      } catch (e) {
        log.error("Media clear failed", `item=${itemId} err=${e.message}`);
      }
    }

    log.audit("Planned changes", `item=${itemId} fieldsCleared=${cleared}`);

    if (DRY_RUN) {
      log.audit("DRY RUN", `item=${itemId} (no save)`);
      return;
    }

    try {
      const savedId = rec.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });
      log.audit("Saved", `item=${savedId} fieldsCleared=${cleared}`);
    } catch (e) {
      log.error("Save failed", `item=${itemId} err=${e.message}`);
      return;
    }

    // Re-load to prove post-save state (if something flipped it during save)
    try {
      const rec2 = record.load({ type: recType, id: itemId, isDynamic: false });
      const inactiveAfter = !!rec2.getValue({ fieldId: "isinactive" });
      log.audit("Inactive AFTER", `item=${itemId} isinactive=${inactiveAfter}`);
    } catch (e) {
      log.error("Reload failed", `item=${itemId} err=${e.message}`);
    }
  };

  return { getInputData, map };
});
