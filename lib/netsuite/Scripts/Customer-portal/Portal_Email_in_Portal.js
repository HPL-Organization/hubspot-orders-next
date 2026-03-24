/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/runtime", "N/search"], (record, runtime, search) => {
  const CUSTOMER_FIELD_ID = "custentity_hpl_email_in_portal";
  const DEFAULT_VALUE = true;
  const MIN_REMAINING_USAGE = 100;
  const SEARCH_CHUNK_SIZE = 25;

  function normalizeBoolean(value) {
    if (value === true || value === false) return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return DEFAULT_VALUE;
  }

  function normalizeEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  function parseEmails(emails) {
    if (!Array.isArray(emails)) return [];

    const seen = new Set();
    const out = [];

    for (const raw of emails) {
      const email = normalizeEmail(raw);
      if (!email) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }

    return out;
  }

  function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  function buildEmailOrFilters(emails) {
    const filters = [];
    for (let i = 0; i < emails.length; i++) {
      if (i > 0) filters.push("OR");
      filters.push(["email", "is", emails[i]]);
    }
    return filters;
  }

  function buildEmailToCustomerIdsMap(emails) {
    const emailToCustomerIds = {};
    for (const email of emails) {
      emailToCustomerIds[email] = [];
    }

    const chunks = chunkArray(emails, SEARCH_CHUNK_SIZE);

    for (const chunk of chunks) {
      const customerSearch = search.create({
        type: search.Type.CUSTOMER,
        filters: buildEmailOrFilters(chunk),
        columns: ["internalid", "email"],
      });

      customerSearch.run().each((result) => {
        const rawEmail = result.getValue({ name: "email" });
        const normalizedEmail = normalizeEmail(rawEmail);
        const id = Number(result.getValue({ name: "internalid" }));

        if (
          normalizedEmail &&
          Object.prototype.hasOwnProperty.call(
            emailToCustomerIds,
            normalizedEmail,
          ) &&
          Number.isInteger(id) &&
          id > 0
        ) {
          emailToCustomerIds[normalizedEmail].push(id);
        }

        return true;
      });
    }

    return emailToCustomerIds;
  }

  function post(body) {
    const requestBody = body || {};
    const emails = parseEmails(requestBody.emails);
    const value = normalizeBoolean(requestBody.value);

    if (!emails.length) {
      return {
        ok: false,
        requested: 0,
        updated: 0,
        success: [],
        failed: [],
        message: "emails must be a non-empty array of valid email strings",
      };
    }

    const emailToCustomerIds = buildEmailToCustomerIdsMap(emails);
    const success = [];
    const failed = [];
    let stoppedEarly = false;

    for (const email of emails) {
      const remainingUsage = runtime.getCurrentScript().getRemainingUsage();

      if (remainingUsage <= MIN_REMAINING_USAGE) {
        stoppedEarly = true;
        failed.push({
          email,
          message: `Stopped before processing due to low governance. Remaining usage: ${remainingUsage}`,
        });
        break;
      }

      try {
        const matchedIds = emailToCustomerIds[email] || [];

        if (matchedIds.length === 0) {
          failed.push({
            email,
            message: "No customer found for this email",
          });
          continue;
        }

        if (matchedIds.length > 1) {
          failed.push({
            email,
            message: `Multiple customers found for this email: ${matchedIds.join(", ")}`,
            customerIds: matchedIds,
          });
          continue;
        }

        const customerId = matchedIds[0];

        record.submitFields({
          type: record.Type.CUSTOMER,
          id: customerId,
          values: {
            [CUSTOMER_FIELD_ID]: value,
          },
          options: {
            enableSourcing: false,
            ignoreMandatoryFields: true,
          },
        });

        success.push({
          email,
          customerId,
        });
      } catch (e) {
        failed.push({
          email,
          message: e && e.message ? e.message : String(e),
        });
      }
    }

    return {
      ok: failed.length === 0 && !stoppedEarly,
      requested: emails.length,
      updated: success.length,
      success,
      failed,
      stoppedEarly,
      remainingUsage: runtime.getCurrentScript().getRemainingUsage(),
    };
  }

  return { post };
});
