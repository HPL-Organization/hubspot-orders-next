/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(["N/currentRecord", "N/log"], (currentRecord, log) => {
  function tryClearAutoApply(type) {
    const rec = currentRecord.get();
    let hasAutoStuff = false;
    let paymentVal = null;

    // Check header payment
    try {
      paymentVal = rec.getValue({ fieldId: "payment" });
    } catch (e) {
      // payment field might not exist on some types; ignore
    }

    const paymentNum =
      paymentVal !== null && paymentVal !== "" ? Number(paymentVal) : 0;

    if (!isNaN(paymentNum) && paymentNum > 0) {
      hasAutoStuff = true;
    }

    let lineCount = 0;
    if (type === "customerpayment") {
      try {
        lineCount = rec.getLineCount({ sublistId: "apply" }) || 0;
      } catch (e) {
        lineCount = 0;
      }

      // See if any line has been auto-applied
      for (let i = 0; i < lineCount; i++) {
        try {
          const applied = rec.getSublistValue({
            sublistId: "apply",
            fieldId: "apply",
            line: i,
          });

          const amtVal = rec.getSublistValue({
            sublistId: "apply",
            fieldId: "amount",
            line: i,
          });

          const amtNum = amtVal !== null && amtVal !== "" ? Number(amtVal) : 0;

          if (applied || (!isNaN(amtNum) && amtNum > 0)) {
            hasAutoStuff = true;
            break;
          }
        } catch (e) {
          // ignore per-line issues
        }
      }
    }

    if (!hasAutoStuff) {
      // Nothing auto-filled yet
      return false;
    }

    // ---- Clear header payment on both payment + deposit ----
    if (type === "customerpayment" || type === "customerdeposit") {
      try {
        log.debug({
          title: "Clearing header payment",
          details: { type, paymentVal },
        });

        rec.setValue({
          fieldId: "payment",
          value: "",
          ignoreFieldChange: true,
        });
      } catch (e) {
        log.error({
          title: "Error clearing payment header",
          details: e,
        });
      }
    }

    // ---- On customer payment, unapply all lines ----
    if (type === "customerpayment" && lineCount > 0) {
      for (let i = 0; i < lineCount; i++) {
        try {
          rec.selectLine({
            sublistId: "apply",
            line: i,
          });

          rec.setCurrentSublistValue({
            sublistId: "apply",
            fieldId: "apply",
            value: false,
          });

          rec.setCurrentSublistValue({
            sublistId: "apply",
            fieldId: "amount",
            value: 0,
          });

          rec.commitLine({
            sublistId: "apply",
          });
        } catch (e) {
          log.error({
            title: `Error clearing apply line ${i}`,
            details: e,
          });
        }
      }
    }

    // We successfully cleared
    return true;
  }

  const pageInit = (context) => {
    try {
      const rec = currentRecord.get();
      const type = rec.type;

      log.debug({
        title: "pageInit",
        details: { type, mode: context.mode },
      });

      // Only care about new payments/deposits
      if (
        context.mode !== "create" ||
        (type !== "customerpayment" && type !== "customerdeposit")
      ) {
        return;
      }

      let attempts = 0;
      const maxAttempts = 10; // up to ~2s if intervalMs = 200
      const intervalMs = 200;

      const intervalId = window.setInterval(() => {
        attempts++;

        try {
          const cleared = tryClearAutoApply(type);
          if (cleared) {
            log.debug({
              title: "Auto-apply cleared",
              details: { type, attempts },
            });
            window.clearInterval(intervalId);
          } else if (attempts >= maxAttempts) {
            log.debug({
              title: "Auto-apply not detected within attempts",
              details: { type, attempts },
            });
            window.clearInterval(intervalId);
          }
        } catch (e) {
          log.error({
            title: "Error in auto-clear interval",
            details: e,
          });
          window.clearInterval(intervalId);
        }
      }, intervalMs);
    } catch (e) {
      log.error({
        title: "Error in pageInit",
        details: e,
      });
    }
  };

  return {
    pageInit,
  };
});
