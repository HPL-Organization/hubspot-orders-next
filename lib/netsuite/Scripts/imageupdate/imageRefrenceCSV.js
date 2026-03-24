/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/record", "N/log", "N/file", "N/runtime"], (
  search,
  record,
  log,
  file,
  runtime
) => {
  // ===== CONFIG =====
  const IMAGE_FOLDER_ID = 1598;
  const OUTPUT_FOLDER_ID = 1598;

  // All item-level fields that may reference your image files
  const ITEM_IMAGE_FIELDS = [
    "storedisplayimage",
    "storedisplaythumbnail",
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

  // Item record types you care about
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
    };
    return m[alias] || null;
  }

  function csvEscape(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function getInputData() {
    return search.create({
      type: "file",
      filters: [
        ["folder", "anyof", IMAGE_FOLDER_ID],
        "AND",
        ["filetype", "anyof", "JPGIMAGE", "PNGIMAGE", "GIFIMAGE"],
      ],
      columns: [
        search.createColumn({ name: "name", sort: search.Sort.ASC }),
        "url",
      ],
    });
  }

  function map(ctx) {
    const row = JSON.parse(ctx.value);
    const fileId = Number(row.id);
    const name = row.values.name || "";
    const url = row.values.url || "";

    ctx.write({
      key: String(fileId),
      value: JSON.stringify({ fileId, name, url }),
    });
  }

  function findItemRefs(fileId) {
    // Search items where ANY of the relevant fields equals this file
    const anyFieldFilter = [];
    ITEM_IMAGE_FIELDS.forEach((f, i) => {
      if (i) anyFieldFilter.push("OR");
      anyFieldFilter.push([f, "anyof", fileId]);
    });

    const s = search.create({
      type: "item",
      filters: [
        ["type", "noneof", "NonInvtPart", "Service"],
        "AND",
        anyFieldFilter,
      ],
      columns: ["internalid", "itemid", search.createColumn({ name: "type" })],
    });

    const hits = [];
    s.run().each((r) => {
      hits.push({
        itemId: Number(r.getValue("internalid")),
        sku: r.getValue("itemid"),
        typeAlias: r.getValue("type"),
      });
      return true;
    });

    // For each hit, load item and determine exactly which fields / media lines match
    const refs = [];
    for (const h of hits) {
      const recType = aliasToRecordType(h.typeAlias);
      if (!recType) continue;

      let rec;
      try {
        rec = record.load({ type: recType, id: h.itemId, isDynamic: false });
      } catch (e) {
        refs.push({
          refType: "item_load_failed",
          refId: h.itemId,
          refName: h.sku || "",
          detail: e.message,
        });
        continue;
      }

      for (const fieldId of ITEM_IMAGE_FIELDS) {
        try {
          const v = rec.getValue({ fieldId });
          if (Number(v) === Number(fileId)) {
            refs.push({
              refType: "item_field",
              refId: h.itemId,
              refName: h.sku || "",
              detail: fieldId,
            });
          }
        } catch (_) {}
      }

      // Also check media sublist in case it’s still present (your clear script removes it, but audit anyway)
      try {
        const sublistId = "mediaitem";
        const count = rec.getLineCount({ sublistId }) || 0;
        for (let i = 0; i < count; i++) {
          const v = rec.getSublistValue({
            sublistId,
            fieldId: "mediaitem",
            line: i,
          });
          if (Number(v) === Number(fileId)) {
            refs.push({
              refType: "item_media",
              refId: h.itemId,
              refName: h.sku || "",
              detail: `mediaitem line ${i}`,
            });
          }
        }
      } catch (_) {}
    }

    return refs;
  }

  function findTransactionAttachmentRefs(fileId) {
    // Communication -> Files attachments (Transaction search supports File Fields filtering) :contentReference[oaicite:2]{index=2}
    // If your account/record type doesn’t support this join, we safely return a "not_supported" marker.
    try {
      const s = search.create({
        type: "transaction",
        filters: [
          search.createFilter({
            name: "internalid",
            join: "file",
            operator: search.Operator.ANYOF,
            values: [fileId],
          }),
        ],
        columns: ["internalid", "tranid", "type"],
      });

      const refs = [];
      s.run().each((r) => {
        refs.push({
          refType: "transaction_attachment",
          refId: Number(r.getValue("internalid")),
          refName: r.getValue("tranid") || "",
          detail: r.getValue("type") || "",
        });
        return true;
      });
      return refs;
    } catch (e) {
      return [
        {
          refType: "transaction_attachment_not_supported",
          refId: "",
          refName: "",
          detail: e.message,
        },
      ];
    }
  }

  function reduce(ctx) {
    const { fileId, name, url } = JSON.parse(ctx.values[0]);

    const itemRefs = findItemRefs(fileId);
    const tranRefs = findTransactionAttachmentRefs(fileId);

    const refs = [...itemRefs, ...tranRefs];

    // emit rows: 1 file can have many refs => multiple CSV rows
    if (!refs.length) {
      ctx.write({
        key: "rows",
        value: JSON.stringify({
          fileId,
          fileName: name,
          fileUrl: url,
          refType: "",
          refInternalId: "",
          refDisplay: "",
          refDetail: "",
        }),
      });
      return;
    }

    for (const r of refs) {
      ctx.write({
        key: "rows",
        value: JSON.stringify({
          fileId,
          fileName: name,
          fileUrl: url,
          refType: r.refType,
          refInternalId: r.refId,
          refDisplay: r.refName,
          refDetail: r.detail,
        }),
      });
    }
  }

  function summarize(summary) {
    const header = [
      "file_id",
      "file_name",
      "file_url",
      "ref_type",
      "ref_internal_id",
      "ref_display",
      "ref_detail",
    ].join(",");

    const lines = [header];

    summary.output.iterator().each((key, value) => {
      if (key !== "rows") return true;
      const r = JSON.parse(value);
      lines.push(
        [
          csvEscape(r.fileId),
          csvEscape(r.fileName),
          csvEscape(r.fileUrl),
          csvEscape(r.refType),
          csvEscape(r.refInternalId),
          csvEscape(r.refDisplay),
          csvEscape(r.refDetail),
        ].join(",")
      );
      return true;
    });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const out = file.create({
      name: `image_reference_audit_${ts}.csv`,
      fileType: file.Type.CSV,
      contents: lines.join("\n"),
      folder: OUTPUT_FOLDER_ID,
    });

    const outId = out.save();
    log.audit(
      "Image reference audit written",
      `fileId=${outId} lines=${lines.length - 1}`
    );

    if (summary.inputSummary.error) {
      log.error("Input error", summary.inputSummary.error);
    }

    summary.mapSummary.errors.iterator().each((k, e) => {
      log.error(`Map error key=${k}`, e);
      return true;
    });

    summary.reduceSummary.errors.iterator().each((k, e) => {
      log.error(`Reduce error key=${k}`, e);
      return true;
    });
  }

  return { getInputData, map, reduce, summarize };
});
