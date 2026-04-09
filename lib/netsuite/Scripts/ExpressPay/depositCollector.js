/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/search", "N/log", "N/record"], function (search, log, record) {
  var CUSTOMER_EXPRESS_PAY_FIELD = "custentity_hpl_express_pay";
  var SO_PROCESSED_FIELD = "custbody_hpl_express_pay_dep_processed";
  var DEPOSIT_PERCENT = 0.01; // 1% for testing

  function getInputData() {
    return search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["type", "anyof", "SalesOrd"],
        "and",
        ["mainline", "is", "F"],
        "and",
        ["taxline", "is", "F"],
        "and",
        ["shipping", "is", "F"],
        "and",
        ["cogs", "is", "F"],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "tranid" }),
        search.createColumn({ name: "entity" }),
        search.createColumn({ name: "lineuniquekey" }),
        search.createColumn({ name: "item" }),
        search.createColumn({ name: "itemtype" }),
        search.createColumn({ name: "quantity" }),
        search.createColumn({ name: "quantitycommitted" }),
        search.createColumn({ name: "amount" }),
        search.createColumn({ name: SO_PROCESSED_FIELD }),
        search.createColumn({
          name: "formulanumeric",
          formula:
            "NVL({quantity},0) - NVL({quantitycommitted},0) - NVL({quantityshiprecv},0)",
          label: "qtybackordered",
        }),
      ],
    });
  }

  function map(context) {
    var row = JSON.parse(context.value);
    var v = row.values || {};

    try {
      var soId = getAny(v, ["internalid"]);
      var tranId = getAny(v, ["tranid"]);
      var customerId = getValue(v.entity);
      var customerText = getText(v.entity);
      var lineKey = getAny(v, ["lineuniquekey"]);
      var itemId = getValue(v.item);
      var itemText = getText(v.item);
      var itemType = getAny(v, ["itemtype"]);
      var qty = toNum(getAny(v, ["quantity"]));
      var qtyCommitted = toNum(getAny(v, ["quantitycommitted"]));
      var amount = toNum(getAny(v, ["amount"]));
      var qtyBackordered = toNum(
        getAny(v, ["formulanumeric", "qtybackordered"]),
      );
      var soProcessed = toBool(getAny(v, [SO_PROCESSED_FIELD]));

      if (qtyBackordered < 0) qtyBackordered = 0;

      var skipped = false;
      var reason = "";
      var ratio = 0;
      var backorderedAmount = 0;
      var wouldDeposit = 0;

      if (soProcessed) {
        skipped = true;
        reason = "sales order already processed";
      } else if (
        itemType === "Description" ||
        itemType === "Subtotal" ||
        itemType === "Discount" ||
        itemType === "Markup" ||
        itemType === "Payment" ||
        itemType === "Group" ||
        itemType === "EndGroup"
      ) {
        skipped = true;
        reason = "non-item line";
      } else if (qty <= 0 || amount <= 0 || qtyBackordered <= 0) {
        skipped = true;
        reason = "no eligible qty/amount/backorder";
      } else {
        ratio = qtyBackordered / qty;
        if (ratio > 1) ratio = 1;
        backorderedAmount = round2(amount * ratio);
        wouldDeposit = round2(backorderedAmount * DEPOSIT_PERCENT);
      }

      context.write({
        key: soId,
        value: JSON.stringify({
          soId: soId,
          tranId: tranId,
          customerId: customerId,
          customer: customerText,
          soProcessed: soProcessed,
          lineKey: lineKey,
          itemId: itemId,
          item: itemText,
          itemType: itemType,
          qty: qty,
          qtyCommitted: qtyCommitted,
          amount: amount,
          qtyBackordered: qtyBackordered,
          backorderRatio: ratio,
          backorderedAmount: backorderedAmount,
          wouldDeposit: wouldDeposit,
          skipped: skipped,
          reason: reason,
          rawFormulaNumeric: v.formulanumeric || "",
        }),
      });
    } catch (e) {
      log.error("DEBUG FAILED ROW", {
        message: e.message,
        stack: e.stack,
        row: row,
      });
    }
  }

  function reduce(context) {
    var lines = [];
    var total = 0;
    var header = null;

    for (var i = 0; i < context.values.length; i++) {
      var line = JSON.parse(context.values[i]);
      lines.push(line);

      if (!header) {
        header = {
          soId: line.soId,
          tranId: line.tranId,
          customerId: line.customerId,
          customer: line.customer,
          soProcessed: line.soProcessed,
        };
      }
    }

    var expressPayId = "";
    var lookupRaw = "";

    if (header && header.customerId) {
      try {
        var customerFields = search.lookupFields({
          type: search.Type.CUSTOMER,
          id: header.customerId,
          columns: [CUSTOMER_EXPRESS_PAY_FIELD],
        });

        lookupRaw = customerFields[CUSTOMER_EXPRESS_PAY_FIELD];

        if (
          lookupRaw != null &&
          typeof lookupRaw === "object" &&
          !Array.isArray(lookupRaw)
        ) {
          expressPayId = lookupRaw.value || lookupRaw.text || "";
        } else if (Array.isArray(lookupRaw)) {
          if (lookupRaw.length) {
            expressPayId =
              lookupRaw[0].value || lookupRaw[0].text || lookupRaw[0] || "";
          }
        } else {
          expressPayId = lookupRaw || "";
        }
      } catch (e) {
        log.error("CUSTOMER EXPRESS PAY LOOKUP FAILED", {
          customerId: header.customerId,
          message: e.message,
          stack: e.stack,
        });
      }
    }

    for (var j = 0; j < lines.length; j++) {
      if (!expressPayId) {
        lines[j].skipped = true;
        lines[j].reason = "customer not enrolled in express pay";
        lines[j].wouldDeposit = 0;
      }
      lines[j].expressPayId = expressPayId;
      total += toNum(lines[j].wouldDeposit);
    }

    total = round2(total);
    var depositMemoRows = buildDepositMemoRows(lines);

    var depositId = "";
    var depositCreated = false;
    var depositError = "";

    if (
      header &&
      header.soId &&
      header.customerId &&
      expressPayId &&
      !header.soProcessed &&
      total > 0 &&
      depositMemoRows.length > 0
    ) {
      try {
        var depRec = record.create({
          type: record.Type.CUSTOMER_DEPOSIT,
          isDynamic: false,
        });

        depRec.setValue({
          fieldId: "customer",
          value: Number(header.customerId),
        });

        depRec.setValue({
          fieldId: "salesorder",
          value: Number(header.soId),
        });

        depRec.setValue({
          fieldId: "paymentoption",
          value: Number(expressPayId),
        });

        depRec.setValue({
          fieldId: "payment",
          value: total,
        });

        depRec.setValue({
          fieldId: "memo",
          value: JSON.stringify(depositMemoRows),
        });

        depositId = depRec.save({
          enableSourcing: true,
          ignoreMandatoryFields: false,
        });

        depositCreated = true;
      } catch (e) {
        depositError = e.message || String(e);
        log.error("DEPOSIT CREATE FAILED", {
          soId: header.soId,
          customerId: header.customerId,
          expressPayId: expressPayId,
          total: total,
          message: e.message,
          stack: e.stack,
        });
      }
    }

    log.audit("DEBUG LINE BREAKDOWN", lines);
    log.audit("DEBUG RESULT - DEPOSIT ATTEMPT", {
      soId: header ? header.soId : "",
      tranId: header ? header.tranId : "",
      customerId: header ? header.customerId : "",
      customer: header ? header.customer : "",
      expressPayId: expressPayId,
      soProcessed: header ? header.soProcessed : false,
      wouldCreateDepositFor: total,
      depositCreated: depositCreated,
      depositId: depositId,
      depositError: depositError,
      customerLookupRaw: lookupRaw,
      depositPercent: DEPOSIT_PERCENT,
      depositMemoRows: depositMemoRows,
    });
  }

  function summarize(summary) {
    if (summary.inputSummary && summary.inputSummary.error) {
      log.error("INPUT ERROR", summary.inputSummary.error);
    }

    if (summary.mapSummary && summary.mapSummary.errors) {
      summary.mapSummary.errors.iterator().each(function (key, error) {
        log.error("MAP ERROR " + key, error);
        return true;
      });
    }

    if (summary.reduceSummary && summary.reduceSummary.errors) {
      summary.reduceSummary.errors.iterator().each(function (key, error) {
        log.error("REDUCE ERROR " + key, error);
        return true;
      });
    }

    log.audit("DEBUG SUMMARY", {
      usage: summary.usage,
      concurrency: summary.concurrency,
      yields: summary.yields,
    });
  }

  function getAny(values, keys) {
    for (var i = 0; i < keys.length; i++) {
      var val = getTextOrValue(values[keys[i]]);
      if (val !== "" && val != null) return val;
    }
    return "";
  }

  function getValue(x) {
    if (x == null) return "";
    if (Array.isArray(x)) return x.length ? x[0].value || "" : "";
    if (typeof x === "object" && x.value != null) return x.value;
    return x;
  }

  function getText(x) {
    if (x == null) return "";
    if (Array.isArray(x)) return x.length ? x[0].text || "" : "";
    if (typeof x === "object" && x.text != null) return x.text;
    return x;
  }

  function getTextOrValue(x) {
    return getText(x) || getValue(x) || "";
  }

  function buildDepositMemoRows(lines) {
    var bySku = Object.create(null);

    for (var i = 0; i < lines.length; i++) {
      var deposit = round2(lines[i].wouldDeposit);
      if (deposit <= 0) continue;

      var sku = normalizeSku(extractSku(lines[i].item, lines[i].itemId));
      if (!sku) continue;

      bySku[sku] = round2((bySku[sku] || 0) + deposit);
    }

    return Object.keys(bySku).map(function (sku) {
      return {
        sku: sku,
        deposit: bySku[sku],
      };
    });
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

  function toBool(v) {
    return v === true || v === "T" || v === "true";
  }

  function round2(v) {
    return Math.round((toNum(v) + Number.EPSILON) * 100) / 100;
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
