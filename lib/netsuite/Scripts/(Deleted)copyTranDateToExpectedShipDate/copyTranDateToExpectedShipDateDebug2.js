/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record"], (record) => {
  function onRequest(context) {
    const soId = Number(context.request.parameters.id || 926841);

    try {
      const rec = record.load({
        type: "salesorder",
        id: soId,
        isDynamic: false,
      });

      context.response.write(
        JSON.stringify({
          ok: true,
          id: rec.id,
          tranid: rec.getValue({ fieldId: "tranid" }),
        }),
      );
    } catch (e) {
      context.response.write(
        JSON.stringify({
          ok: false,
          name: e.name,
          message: e.message,
          stack: e.stack,
        }),
      );
    }
  }

  return { onRequest };
});
