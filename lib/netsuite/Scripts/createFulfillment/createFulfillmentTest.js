/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/record", "N/log"], function (query, record, log) {
  const TARGET_SO_IDS = [325539];
  const TEST_MODE = false;

  function getEligibleLinesForSo(soId) {
    const sql = `
      WITH lines AS (
        SELECT
          o.id                                    AS so_id,
          l.id                                    AS so_line_id,
          l.linesequencenumber                    AS so_line_seq,
          ABS(NVL(l.quantity,0))                  AS qty,
          ABS(NVL(l.quantityshiprecv,0))          AS qty_shiprecv,
          ABS(NVL(l.quantitycommitted,0))         AS qty_committed,
          ABS(NVL(l.quantitybackordered,0))       AS qty_backordered,
          NVL(l.custcol_hpl_itempaid,'F')         AS item_paid_flag,
          l.itemtype                              AS itemtype,
          l.assemblycomponent                     AS assemblycomponent,
          l.kitcomponent                          AS kitcomponent,
          NVL(l.isclosed,'F')                     AS isclosed
        FROM transaction o
        JOIN transactionline l ON o.id = l.transaction
        WHERE o.type = 'SalesOrd' AND l.mainline = 'F' AND o.id = ?
      ), filt AS (
        SELECT *
        FROM lines
        WHERE isclosed = 'F'
          AND itemtype IN ('InvtPart','Assembly','Kit')
          AND assemblycomponent = 'F'
          AND kitcomponent = 'F'
      ), ord AS (
        SELECT
          so_id,
          COUNT(*) AS total_lines,
          SUM(CASE WHEN item_paid_flag = 'T' THEN 1 ELSE 0 END) AS paid_lines,
          SUM(CASE WHEN item_paid_flag = 'T'
                   AND qty_committed > 0
                   AND qty_backordered = 0 THEN 1 ELSE 0 END) AS paid_committed_lines
        FROM filt
        GROUP BY so_id
      )
      SELECT
        f.so_id,
        f.so_line_id,
        f.so_line_seq,
        GREATEST(0, f.qty - f.qty_shiprecv) AS remaining
      FROM filt f
      JOIN ord o ON o.so_id = f.so_id
      WHERE f.item_paid_flag = 'T'
        AND f.qty_committed > 0
        AND f.qty_backordered = 0
        AND GREATEST(0, f.qty - f.qty_shiprecv) > 0
        AND o.paid_lines < o.total_lines
        AND o.paid_committed_lines >= 1
      ORDER BY f.so_line_seq ASC
    `;
    const res = query
      .runSuiteQL({ query: sql, params: [soId] })
      .asMappedResults();
    return res.map((r) => ({
      soId: Number(r.so_id),
      lineId: Number(r.so_line_id),
      lineSeq: Number(r.so_line_seq),
      remaining: Number(r.remaining),
    }));
  }

  function getInputData() {
    return TARGET_SO_IDS;
  }

  function map(context) {
    const soId = Number(context.value);
    const rows = getEligibleLinesForSo(soId);
    if (!rows.length) {
      log.audit("No eligible lines", { salesorder: soId });
      return;
    }
    log.audit("Eligible paid+committed lines", {
      salesorder: soId,
      lineCount: rows.length,
      details: rows,
    });
    context.write({
      key: String(soId),
      value: JSON.stringify(rows),
    });
  }

  function reduce(context) {
    const soId = Number(context.key);
    const wantedBySeq = {};
    const wantedById = {};
    context.values.forEach((v) => {
      const arr = JSON.parse(v);
      for (const r of arr) {
        const rem = Math.max(0, Number(r.remaining) || 0);
        wantedBySeq[Number(r.lineSeq)] = rem;
        wantedById[Number(r.lineId)] = rem;
      }
    });
    const wantedSeqKeys = Object.keys(wantedBySeq).map(Number);
    const wantedIdKeys = Object.keys(wantedById).map(Number);
    if (!wantedSeqKeys.length && !wantedIdKeys.length) {
      log.audit("Skip transform, no wanted lines", { salesorder: soId });
      return;
    }

    try {
      const ifRec = record.transform({
        fromType: record.Type.SALES_ORDER,
        fromId: soId,
        toType: record.Type.ITEM_FULFILLMENT,
        isDynamic: true,
      });

      const cnt = ifRec.getLineCount({ sublistId: "item" });
      const pre = [];
      for (let i = 0; i < cnt; i++) {
        ifRec.selectLine({ sublistId: "item", line: i });
        const ol = Number(
          ifRec.getCurrentSublistValue({
            sublistId: "item",
            fieldId: "orderline",
          })
        );
        const qtyRem =
          Number(
            ifRec.getCurrentSublistValue({
              sublistId: "item",
              fieldId: "quantityremaining",
            })
          ) || 0;
        const recFlag = !!ifRec.getCurrentSublistValue({
          sublistId: "item",
          fieldId: "itemreceive",
        });
        pre.push({
          i,
          orderline: ol,
          qtyRemaining: qtyRem,
          itemreceive: recFlag,
        });
      }
      log.audit("IF orderlines (pre-filter)", {
        salesorder: soId,
        wantedSeq: wantedSeqKeys,
        wantedId: wantedIdKeys,
        ifLines: pre,
      });

      let kept = 0;
      const keptDetails = [];
      for (let i = 0; i < cnt; i++) {
        ifRec.selectLine({ sublistId: "item", line: i });
        const sourceOrderLine = Number(
          ifRec.getCurrentSublistValue({
            sublistId: "item",
            fieldId: "orderline",
          })
        );
        let remainingWanted = null;
        if (wantedBySeq[sourceOrderLine] != null)
          remainingWanted = wantedBySeq[sourceOrderLine];
        if (remainingWanted == null && wantedById[sourceOrderLine] != null)
          remainingWanted = wantedById[sourceOrderLine];
        if (remainingWanted != null) {
          const sysRemain =
            Number(
              ifRec.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "quantityremaining",
              })
            ) || remainingWanted;
          const shipQty = Math.max(0, Math.min(remainingWanted, sysRemain));
          ifRec.setCurrentSublistValue({
            sublistId: "item",
            fieldId: "quantity",
            value: shipQty,
          });
          ifRec.setCurrentSublistValue({
            sublistId: "item",
            fieldId: "itemreceive",
            value: true,
          });
          ifRec.commitLine({ sublistId: "item" });
          kept++;
          keptDetails.push({
            lineIndex: i,
            orderline: sourceOrderLine,
            shipQty,
            sysRemain,
            remainingWanted,
          });
        } else {
          ifRec.setCurrentSublistValue({
            sublistId: "item",
            fieldId: "itemreceive",
            value: false,
          });
          ifRec.commitLine({ sublistId: "item" });
        }
      }

      if (kept === 0) {
        log.audit("No kept lines after filtering", {
          salesorder: soId,
          wantedSeq: wantedSeqKeys,
          wantedId: wantedIdKeys,
          ifLines: pre,
        });
        return;
      }

      if (TEST_MODE) {
        log.audit("TEST_MODE — would submit IF", {
          salesorder: soId,
          kept,
          keptDetails,
        });
        return;
      }

      const ifId = ifRec.save({
        enableSourcing: true,
        ignoreMandatoryFields: false,
      });
      log.audit("Created Item Fulfillment", {
        salesorder: soId,
        itemfulfillment: ifId,
        kept,
        keptDetails,
      });
    } catch (e) {
      log.error("Transform/Submit failed", { salesorder: soId, error: e });
      throw e;
    }
  }

  function summarize(summary) {
    if (summary.inputSummary.error)
      log.error("Input stage error", summary.inputSummary.error);
    summary.mapSummary.errors.iterator().each((key, err) => {
      log.error("Map error", { key, error: err });
      return true;
    });
    summary.reduceSummary.errors.iterator().each((key, err) => {
      log.error("Reduce error", { key, error: err });
      return true;
    });
    log.audit("MR complete", {
      usage: summary.usage,
      yields: summary.yields,
      seconds: summary.seconds,
    });
  }

  return { getInputData, map, reduce, summarize };
});
