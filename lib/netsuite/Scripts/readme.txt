NetSuite Scripts – Quick Reference Guide - RV

deleteSO/

deleteButton.js — Adds a “Delete/Unwind” button to Sales Orders that opens the Suitelet for the cleanup flow.

deleteFinButton.js — Adds a button that runs the financial-only unwind (no WMS/lines), pointing to the finance Suitelet.

deleteFinScript.js — Suitelet to unwind financials: clears paid flags, deletes invoice(s) and related financial links when safe, then returns to the SO.

deleteScript.js — Full Sales Order cleanup Suitelet: validates the record, performs safe detach/cleanup of related records, and deletes/cancels the SO when allowed.


itempaidCalculator/

itemPaidCalculator.js — User Event that computes line-level custcol_hpl_itempaid and header custbody_hpl_paidreleased based on payments/coverage and tax rules.

itemPaidCalculatorCashSale.js — Cash Sale variant of the paid calculator (sets flags using cash-sale amounts/coverage).

itemPaidCalculatorNet30.js — Net-30/terms variant of the paid calculator (treats unpaid terms correctly when computing coverage).


paymentTokens/

createPaymentCardToken.js — Creates/stores a payment method token for a customer (for future charges).

defaultPaymentCardToken.js — Sets the customer’s default payment token.

deletePaymentCardToken.js — Removes a stored payment token from the customer.

getPaymentMethods.js — Lists stored payment methods/tokens for UI selection.


shipping / fulfillment helpers

internationlShipComplete.js — Marks international shipments complete and updates SO shipping/completion flags when criteria are met.

inventoryDetailCopier.js — Copies inventory detail (e.g., serials/bins/cartons) from fulfillment lines into custom fields for reporting/audits.

inventoryDetailCopierServer.js — Server-side endpoint/worker used by the copier to run the same sync in bulk or on demand.

phoneNumberIFCopier.js — Copies customer/contact phone details onto Item Fulfillment for label/carrier needs.


payment / status utilities

paidReleasedSetter.js — Helper to set custbody_hpl_paidreleased when the order meets “fully paid / released” criteria (can be run in bulk).


warranty

warrantyRegistryEnabler.js — Enables/tracks warranty registration per line (uses custcol_wrm_reg_hid_trackwarranty and related logic).


docs

readme.txt — This file :)