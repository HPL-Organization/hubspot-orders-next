/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/query", "N/file", "N/search"], function (query, file, search) {
  function getInputData() {
    return [1];
  }
  function map(context) {
    context.write({ key: "RUN", value: "RUN" });
  }
  function reduce(context) {}

  function summarize(summary) {
    var folderId = 2279;
    var PAGE = 1000;

    function findFileIdsByName(name) {
      var ids = [];
      var s = search.create({
        type: "file",
        filters: [
          ["name", "is", name],
          "AND",
          ["folder", "anyof", String(folderId)],
        ],
        columns: ["internalid"],
      });
      s.run().each(function (res) {
        ids.push(Number(res.getValue("internalid")));
        return true;
      });
      return ids;
    }

    function deleteAllByName(name) {
      var ids = findFileIdsByName(name);
      for (var i = 0; i < ids.length; i++) {
        try {
          file["delete"]({ id: ids[i] });
        } catch (e) {
          log.debug("deleteAllByName: delete failed", {
            name: name,
            id: ids[i],
            error: e,
          });
        }
      }
    }

    function createTempThenRename(finalName, contents, fileType) {
      deleteAllByName(finalName);
      var tempId = file
        .create({
          name: finalName + "." + Date.now() + ".tmp",
          fileType: fileType,
          contents: contents,
          folder: folderId,
        })
        .save();
      var f = file.load({ id: tempId });
      f.name = finalName;
      var finalId = f.save();

      var ids = findFileIdsByName(finalName);
      if (ids.length > 1) {
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i];
          if (id !== finalId) {
            try {
              file["delete"]({ id: id });
            } catch (e) {
              log.debug("createTempThenRename: cleanup delete failed", {
                finalName: finalName,
                id: id,
                error: e,
              });
            }
          }
        }
      }
      return finalId;
    }

    var customerMap = {}; // id -> payload
    var customersExported = 0;
    var addressesExported = 0;

    var lastCustId = 0;
    for (;;) {
      var custIds =
        query
          .runSuiteQL({
            query:
              "SELECT C.id AS customerId " +
              "FROM customer C " +
              "WHERE C.id > ? " +
              "ORDER BY C.id ASC " +
              "FETCH NEXT " +
              PAGE +
              " ROWS ONLY",
            params: [lastCustId],
          })
          .asMappedResults() || [];
      if (!custIds.length) break;

      var idList = custIds.map(function (r) {
        return Number(r.customerid);
      });
      lastCustId = idList[idList.length - 1];
      var csv = idList.join(",");

      var custQ =
        "SELECT " +
        "  C.id AS customerId, " +
        "  C.entityid AS entityId, " +
        "  C.companyname AS companyName, " +
        "  C.email AS email, " +
        "  C.phone AS phone, " +
        "  C.mobilephone AS mobilephone, " +
        "  C.firstname AS firstName, " +
        "  C.middlename AS middleName, " +
        "  C.lastname AS lastName, " +
        "  C.custentity_hpl_hs_id AS hubspotId, " +
        "  C.shippingcarrier AS shippingCarrier " +
        "FROM customer C " +
        "WHERE C.id IN (" +
        csv +
        ")";

      // IMPORTANT CHANGE: remove CAB.id selection. Use EA.nKey as the unique address identifier.
      var addrQ =
        "SELECT " +
        "  CAB.entity AS customerId, " +
        "  CAB.defaultbilling AS defaultBilling, " +
        "  CAB.defaultshipping AS defaultShipping, " +
        "  CAB.label AS label, " +
        "  EA.nKey AS addressNKey, " +
        "  EA.addr1 AS addr1, " +
        "  EA.addr2 AS addr2, " +
        "  EA.city AS city, " +
        "  EA.state AS state, " +
        "  EA.zip AS zip, " +
        "  EA.country AS country, " +
        "  EA.addressee AS addressee " +
        "FROM customeraddressbook CAB " +
        "LEFT JOIN EntityAddress EA ON CAB.addressbookaddress = EA.nKey " +
        "WHERE CAB.entity IN (" +
        csv +
        ")";

      var custRows = query.runSuiteQL({ query: custQ }).asMappedResults() || [];
      var addrRows = query.runSuiteQL({ query: addrQ }).asMappedResults() || [];

      for (var i = 0; i < custRows.length; i++) {
        var c = custRows[i];
        var id = String(c.customerid);
        customerMap[id] = {
          customer_id: Number(c.customerid),
          entity_id: c.entityid || null,
          company_name: c.companyname || null,
          email: c.email || null,
          phone: c.phone || null,
          mobilephone: c.mobilephone || null,
          first_name: c.firstname || null,
          middle_name: c.middlename || null,
          last_name: c.lastname || null,
          hubspot_id: c.hubspotid || null,
          shippingcarrier: c.shippingcarrier || null,
          addresses: [],
        };
      }

      for (var j = 0; j < addrRows.length; j++) {
        var r = addrRows[j];
        var key = String(r.customerid);
        var target = customerMap[key];
        if (!target) continue;

        target.addresses.push({
          // use nKey as the stable id we can round-trip with your REST writes (maps to addressbookaddress)
          address_nkey: r.addressnkey != null ? Number(r.addressnkey) : null,
          default_billing: String(r.defaultbilling || "F") === "T",
          default_shipping: String(r.defaultshipping || "F") === "T",
          label: r.label || null,
          addr1: r.addr1 || null,
          addr2: r.addr2 || null,
          city: r.city || null,
          state: r.state || null,
          zip: r.zip || null,
          country: r.country || null,
          addressee: r.addressee || null,
        });
        addressesExported += 1;
      }

      customersExported += custRows.length;
    }

    var out = [];
    for (var k in customerMap) out.push(JSON.stringify(customerMap[k]) + "\n");

    var customersFileId = createTempThenRename(
      "customers.jsonl",
      out.join(""),
      file.Type.PLAINTEXT
    );

    var manifest = {
      generated_at: new Date().toISOString(),
      file: {
        id: customersFileId,
        name: "customers.jsonl",
        rows_customers: customersExported,
        rows_addresses: addressesExported,
      },
    };
    createTempThenRename(
      "customer_export_manifest.json",
      JSON.stringify(manifest),
      file.Type.JSON
    );
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
