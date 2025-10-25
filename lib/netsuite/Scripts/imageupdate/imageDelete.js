/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/record", "N/log"], (search, record, log) => {
  const DRY_RUN = false;

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

  const getInputData = () => {
    const imageAnyFilter = [];
    IMAGE_FIELDS.forEach((f, i) => {
      if (i) imageAnyFilter.push("OR");
      imageAnyFilter.push([f, "noneof", "@NONE@"]);
    });

    return search.create({
      type: "item",
      filters: [
        ["type", "noneof", "NonInvtPart", "Service"],
        "AND",
        imageAnyFilter,
      ],
      columns: ["internalid", search.createColumn({ name: "type" })],
    });
  };

  const map = (ctx) => {
    const row = JSON.parse(ctx.value);
    const itemId = Number(row.id || row.values.internalid);
    const typeCol = row.values.type;
    const typeAlias = (typeCol && (typeCol.value || typeCol)) || null;
    const recType = itemTypeAliasToRecordType(typeAlias);

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
        for (let i = count - 1; i >= 0; i--)
          rec.removeLine({ sublistId, line: i });
        if (count) log.audit("Media cleared", `item=${itemId} lines=${count}`);
      } catch (e) {
        log.error("Media clear failed", `item=${itemId} err=${e.message}`);
      }
    }

    if (DRY_RUN) {
      log.audit("DRY RUN", `item=${itemId} cleared=${cleared}`);
      return;
    }

    try {
      rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
      log.audit("Images cleared", `item=${itemId} fields=${cleared}`);
    } catch (e) {
      log.error("Save failed", `item=${itemId} err=${e.message}`);
    }
  };

  return { getInputData, map };
});
