/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record", "N/log"], function (record, log) {
  var FLD_USED = "custcol_hpl_line_deposit_already_used";
  var FLD_BO_QTY = "custcol_hpl_line_backorder_qty_at_dep";
  var FLD_DEP_TOTAL = "custcol_hpl_line_deposit_total";

  function afterSubmit(context) {
    try {
      if (
        context.type !== context.UserEventType.CREATE &&
        context.type !== context.UserEventType.COPY &&
        context.type !== context.UserEventType.DELETE
      ) {
        return;
      }

      var isDelete = context.type === context.UserEventType.DELETE;
      var depRec = isDelete ? context.oldRecord : context.newRecord;
      var depId = depRec && depRec.id;
      if (!depId) return;

      var soId;
      var memo;

      if (isDelete) {
        soId =
          depRec.getValue({ fieldId: "salesorder" }) ||
          depRec.getValue({ fieldId: "createdfrom" });

        memo = depRec.getValue({ fieldId: "memo" }) || "";
      } else {
        depRec = record.load({
          type: record.Type.CUSTOMER_DEPOSIT,
          id: depId,
          isDynamic: false,
        });

        soId =
          depRec.getValue({ fieldId: "salesorder" }) ||
          depRec.getValue({ fieldId: "createdfrom" });

        memo = depRec.getValue({ fieldId: "memo" }) || "";
      }

      if (!soId) {
        log.audit("Deposit has no linked SO", { depositId: depId });
        return;
      }

      if (!memo) {
        log.audit("Deposit memo empty", { depositId: depId, soId: soId });
        return;
      }

      var parsed = parseMemo(memo);
      if (!Object.keys(parsed).length) {
        log.audit("Deposit memo JSON had no usable rows", {
          depositId: depId,
          soId: soId,
          memo: memo,
        });
        return;
      }

      var soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });

      var lineCount = soRec.getLineCount({ sublistId: "item" });
      var touched = 0;
      var skippedZeroBo = [];
      var unmatchedMemoSkus = Object.create(null);

      Object.keys(parsed).forEach(function (sku) {
        unmatchedMemoSkus[sku] = true;
      });

      for (var i = 0; i < lineCount; i++) {
        var itemText = safeString(
          soRec.getSublistText({
            sublistId: "item",
            fieldId: "item",
            line: i,
          }),
        );
        var itemValue = safeString(
          soRec.getSublistValue({
            sublistId: "item",
            fieldId: "item",
            line: i,
          }),
        );

        var lineSku = normalizeSku(extractSku(itemText, itemValue));
        if (!lineSku) continue;

        var row = parsed[lineSku];
        if (!row) continue;

        delete unmatchedMemoSkus[lineSku];

        if (isDelete) {
          clearLineField(soRec, "item", FLD_DEP_TOTAL, i);
          clearLineField(soRec, "item", FLD_BO_QTY, i);
          clearLineField(soRec, "item", FLD_USED, i);
          touched++;
          continue;
        }

        var backorderedQty = toNum(
          soRec.getSublistValue({
            sublistId: "item",
            fieldId: "quantitybackordered",
            line: i,
          }),
        );

        if (backorderedQty <= 0) {
          skippedZeroBo.push({
            line: i,
            sku: lineSku,
            deposit: row.depositTotal,
          });
          continue;
        }

        soRec.setSublistValue({
          sublistId: "item",
          fieldId: FLD_DEP_TOTAL,
          line: i,
          value: round2(row.depositTotal),
        });

        soRec.setSublistValue({
          sublistId: "item",
          fieldId: FLD_BO_QTY,
          line: i,
          value: backorderedQty,
        });

        soRec.setSublistValue({
          sublistId: "item",
          fieldId: FLD_USED,
          line: i,
          value: 0,
        });

        touched++;
      }

      if (!touched) {
        log.audit(
          isDelete
            ? "No SO lines cleared from deleted deposit memo"
            : "No SO lines updated from deposit memo",
          {
            depositId: depId,
            soId: soId,
            skippedZeroBo: skippedZeroBo,
            unmatchedMemoSkus: Object.keys(unmatchedMemoSkus),
          },
        );
        return;
      }

      soRec.save({
        enableSourcing: false,
        ignoreMandatoryFields: true,
      });

      log.audit(
        isDelete
          ? "SO lines cleared from deleted customer deposit memo"
          : "SO lines updated from customer deposit memo",
        {
          depositId: depId,
          soId: soId,
          updatedLines: touched,
          skippedZeroBo: skippedZeroBo,
          unmatchedMemoSkus: Object.keys(unmatchedMemoSkus),
        },
      );
    } catch (e) {
      log.error("Customer deposit line deposit init failed", {
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
      throw e;
    }
  }

  function clearLineField(rec, sublistId, fieldId, line) {
    try {
      rec.setSublistText({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line,
        text: "",
      });
    } catch (e) {
      log.error("Failed clearing line field", {
        sublistId: sublistId,
        fieldId: fieldId,
        line: line,
        message: e.message,
      });
      throw e;
    }
  }

  function parseMemo(memo) {
    var out = Object.create(null);
    var rows;

    try {
      rows = JSON.parse(memo);
    } catch (e) {
      log.error("Deposit memo is not valid JSON", {
        memo: memo,
        err: e.message,
      });
      return out;
    }

    if (!Array.isArray(rows)) return out;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var sku = normalizeSku(row.sku);
      var deposit = toNum(row.deposit);

      if (!sku || deposit <= 0) continue;

      out[sku] = {
        depositTotal: deposit,
      };
    }

    return out;
  }

  function extractSku(itemText, itemValue) {
    var txt = safeString(itemText);
    if (!txt) return itemValue;

    if (txt.indexOf(" : ") !== -1) {
      return txt.split(" : ")[0];
    }

    return txt;
  }

  function normalizeSku(v) {
    return safeString(v).toUpperCase();
  }

  function safeString(v) {
    return v === null || v === undefined ? "" : String(v).trim();
  }

  function toNum(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function round2(v) {
    return Math.round(toNum(v) * 100) / 100;
  }

  return {
    afterSubmit: afterSubmit,
  };
});
