/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([], () => {
  const EMAIL_FIELD = "email";
  const PORTAL_CHECKBOX_FIELD = "custentity_hpl_email_in_portal";

  function normalizeEmail(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function beforeSubmit(context) {
    try {
      if (
        context.type !== context.UserEventType.EDIT &&
        context.type !== context.UserEventType.XEDIT
      ) {
        return;
      }

      const newRecord = context.newRecord;
      const oldRecord = context.oldRecord;

      const oldEmail = normalizeEmail(
        oldRecord.getValue({ fieldId: EMAIL_FIELD }),
      );
      const newEmail = normalizeEmail(
        newRecord.getValue({ fieldId: EMAIL_FIELD }),
      );

      if (newEmail === oldEmail) {
        return;
      }

      newRecord.setValue({
        fieldId: PORTAL_CHECKBOX_FIELD,
        value: false,
        ignoreFieldChange: true,
      });
    } catch (e) {
      log.error({
        title: "Error unchecking portal email flag on email change",
        details: e,
      });
    }
  }

  return { beforeSubmit };
});
