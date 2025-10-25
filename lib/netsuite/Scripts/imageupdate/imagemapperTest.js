/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/record", "N/log", "N/file"], (
  search,
  record,
  log,
  file
) => {
  // ===== CONFIG =====
  const IMAGE_FOLDER_ID = 1598; // Images > Item Images (change if needed)
  const ITEM_ID_FIELD = "itemid"; // SKU lives in itemid (Name/Number)
  const FILE_LIMIT = 5; // <-- only process first 5 files for this test
  const DRY_RUN = false; // start safe; set to false to actually save

  // slot → item field mapping (your fields)
  const IMAGE_SLOT_TO_FIELD = {
    1: "custitem_atlas_item_image",
    2: "custitem_nsc_image_2",
    3: "custitem_nsc_image_3",
    4: "custitem_nsc_image_4",
    5: "custitem_nsc_image_5",
    6: "custitem_nsc_image_6",
    7: "custitem_nsc_image_7",
    8: "custitem_nsc_image_8",
    9: "custitem_nsc_image_9",
    10: "custitem_nsc_image_10",
  };

  // also populate the standard header image so you can see it on the form
  const MAIN_IMAGE_FIELD = "storedisplayimage";

  // Filenames like SKU-1.jpg / SKU-10.png
  const FILE_NAME_REGEX = /^(.+?)-([1-9]|10)\.(?:jpe?g|png|gif)$/i;

  function aliasToRecordType(alias) {
    const m = {
      InvtPart: record.Type.INVENTORY_ITEM,
      Assembly: record.Type.ASSEMBLY_ITEM,
      Kit: record.Type.KIT_ITEM,
      OtherCharge: record.Type.OTHER_CHARGE_ITEM,
      GiftCert: record.Type.GIFT_CERTIFICATE_ITEM,
      DownloadItem: record.Type.DOWNLOAD_ITEM,
      LotNumberedInvtPart: record.Type.LOT_NUMBERED_INVENTORY_ITEM,
      SerializedInvtPart: record.Type.SERIALIZED_INVENTORY_ITEM,
      // NonInvtPart / Service excluded intentionally
    };
    return m[alias] || null;
  }

  function ensureFileOnline(fileId) {
    try {
      const f = file.load({ id: fileId });
      if (f.isOnline !== true) {
        f.isOnline = true;
        f.save();
      }
    } catch (e) {
      log.audit(
        "ensureFileOnline skipped",
        `fileId=${fileId} err=${e.message}`
      );
    }
  }

  // ===== INPUT: first 5 image files from the folder =====
  function getInputData() {
    const s = search.create({
      type: "file",
      filters: [
        ["folder", "anyof", IMAGE_FOLDER_ID],
        "AND",
        ["filetype", "anyof", "JPGIMAGE", "PNGIMAGE", "GIFIMAGE"],
      ],
      columns: [
        search.createColumn({ name: "name", sort: search.Sort.ASC }),
        "internalid",
      ],
    });

    const rows = s.run().getRange({ start: 0, end: FILE_LIMIT }) || [];
    const out = [];

    rows.forEach((r) => {
      const name = r.getValue("name");
      const id = Number(r.getValue("internalid"));
      const m = FILE_NAME_REGEX.exec(name || "");
      if (!m) {
        log.audit("SKIP filename (pattern mismatch)", name);
        return;
      }
      const sku = m[1].trim();
      const slot = Number(m[2]);
      out.push({ sku, slot, fileId: id, name });
    });

    log.audit("Queued files", `count=${out.length}`);
    return out; // MR will feed these objects into map()
  }

  // We already parsed the file list; just emit by SKU for reduce grouping
  function map(ctx) {
    const row = JSON.parse(ctx.value); // { sku, slot, fileId, name }
    ctx.write({ key: row.sku, value: JSON.stringify(row) });
  }

  // For each SKU, set the appropriate image fields
  function reduce(ctx) {
    const sku = ctx.key;
    const pairs = ctx.values.map((v) => JSON.parse(v)); // [{sku,slot,fileId,name}...]

    // find the item by SKU (itemid)
    const hit = search
      .create({
        type: "item",
        filters: [[ITEM_ID_FIELD, "is", sku]],
        columns: ["internalid", search.createColumn({ name: "type" })],
      })
      .run()
      .getRange({ start: 0, end: 1 })[0];

    if (!hit) {
      log.audit("SKU not found", sku);
      return;
    }

    const itemId = Number(hit.getValue("internalid"));
    const typeAlias = hit.getValue("type"); // e.g., InvtPart
    const recType = aliasToRecordType(typeAlias);

    if (!recType) {
      log.audit(
        "Unsupported item type (skipped)",
        `sku=${sku} alias=${typeAlias}`
      );
      return;
    }

    let rec;
    try {
      rec = record.load({ type: recType, id: itemId, isDynamic: false });
    } catch (e) {
      log.error("Load failed", `SKU=${sku} id=${itemId} err=${e.message}`);
      return;
    }

    let setCount = 0;

    for (const { slot, fileId, name } of pairs) {
      const fieldId = IMAGE_SLOT_TO_FIELD[slot];
      if (!fieldId) {
        log.audit(
          "No mapped field for slot (skipped)",
          `SKU=${sku} slot=${slot} file=${name}`
        );
        continue;
      }

      try {
        ensureFileOnline(fileId);

        // set your mapped field
        rec.setValue({ fieldId, value: fileId });

        // also set the standard header image for slot 1 so you can "see" it on the form
        if (slot === 1) {
          try {
            rec.setValue({ fieldId: MAIN_IMAGE_FIELD, value: fileId });
          } catch (_) {}
        }

        // sanity check (optional)
        const wrote = rec.getValue({ fieldId });
        if (!wrote)
          log.error(
            "Write did not stick",
            `SKU=${sku} slot=${slot} field=${fieldId} file=${fileId}`
          );

        setCount++;
      } catch (e) {
        log.error(
          "Set failed",
          `SKU=${sku} slot=${slot} field=${fieldId} file=${fileId} err=${e.message}`
        );
      }
    }

    if (DRY_RUN) {
      log.audit("DRY RUN", `SKU=${sku} item=${itemId} setCount=${setCount}`);
      return;
    }

    try {
      rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
      log.audit("Saved", `SKU=${sku} item=${itemId} setCount=${setCount}`);
    } catch (e) {
      log.error("Save failed", `SKU=${sku} item=${itemId} err=${e.message}`);
    }
  }

  return { getInputData, map, reduce };
});
