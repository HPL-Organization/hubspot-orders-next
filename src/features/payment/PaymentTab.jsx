"use client";
import React, { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  CircularProgress,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Divider,
  Stack,
  Alert,
} from "@mui/material";

import AddPaymentMethod from "../../../components/Versapay/AddPaymentMethod";
import PaymentMethods from "../../../components/Versapay/PaymentMethods";

const InvoiceGrid = dynamic(() => import("../../../components/InvoiceGrid"), {
  ssr: false,
});

const PaymentTab = ({ netsuiteInternalId }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  const [pmRefreshKey, setPmRefreshKey] = useState(0);

  const [openDeposit, setOpenDeposit] = useState(false);
  const [openFull, setOpenFull] = useState(false);

  const [selectedPaymentOptionId, setSelectedPaymentOptionId] = useState(null);

  const [submittingFull, setSubmittingFull] = useState(false);
  const [fullError, setFullError] = useState(null);
  const [fullSuccess, setFullSuccess] = useState(null);

  const uniqueInvoicesMap = new Map();
  invoices.forEach((inv) => {
    const key =
      inv.invoiceId ??
      inv.id ??
      inv.internalId ??
      inv.tranId ??
      JSON.stringify(inv);
    if (!uniqueInvoicesMap.has(key)) uniqueInvoicesMap.set(key, inv);
  });
  const uniqueInvoices = Array.from(uniqueInvoicesMap.values());

  const refreshInvoices = useCallback(async () => {
    if (!netsuiteInternalId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/netsuite/invoices?internalId=${netsuiteInternalId}`
      );
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (err) {
      console.error("Failed to fetch related invoices:", err);
    } finally {
      setLoading(false);
    }
  }, [netsuiteInternalId]);

  useEffect(() => {
    refreshInvoices();
  }, [refreshInvoices]);

  const customerId = invoices?.[0]?.customerId ?? null;

  async function recordPaymentAgainstInvoice(opts) {
    console.log("Attempting to record payment", opts);
    const res = await fetch(`/api/netsuite/record-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceInternalId: opts.invoiceInternalId,
        amount: opts.amount,
        undepFunds: true,
        paymentOptionId: Numeric(opts.paymentOptionId) || undefined,
        memo: opts.memo,
        externalId: opts.externalId,
        trandate: new Date().toISOString().slice(0, 10),
      }),
    });
    const json = await res.json();

    if (!res.ok)
      throw new Error(
        json?.details || json?.error || "Failed to record payment"
      );
    return json;
  }

  const handleConfirmFullPayment = async () => {
    setFullError(null);
    setFullSuccess(null);
    setSubmittingFull(true);
    try {
      if (!selectedPaymentOptionId)
        throw new Error("Select a saved payment method first");
      if (!uniqueInvoices.length) throw new Error("No invoices available");

      const target =
        uniqueInvoices.find(
          (inv) => Number(inv?.amountRemaining ?? inv?.amountremaining ?? 0) > 0
        ) || uniqueInvoices[0];

      const invoiceId =
        target?.invoiceId ?? target?.id ?? target?.internalId ?? null;
      if (!invoiceId) throw new Error("Unable to resolve invoice id");

      let amountToPay = Number(
        target?.amountRemaining ?? target?.amountremaining ?? target?.total ?? 0
      );
      if (!amountToPay || !isFinite(amountToPay)) {
        throw new Error("Invoice has nothing to pay");
      }

      const externalId = `vp_ui_${invoiceId}_${Date.now()}`;

      await recordPaymentAgainstInvoice({
        invoiceInternalId: invoiceId,
        amount: amountToPay,
        paymentOptionId: Number(selectedPaymentOptionId),
        memo: "Full payment (UI)",
        externalId,
      });

      setFullSuccess(`Payment recorded on invoice #${invoiceId}.`);
      setOpenFull(false);
      await refreshInvoices();
    } catch (e) {
      console.error(e);
      setFullError(e?.message || String(e));
    } finally {
      setSubmittingFull(false);
    }
  };

  if (netsuiteInternalId === undefined) {
    return (
      <Box display="flex" alignItems="center" gap={2}>
        <CircularProgress size={24} />
        <span className="text-gray-600">Loading NetSuite data...</span>
      </Box>
    );
  }

  if (netsuiteInternalId === null) {
    return (
      <Box display="flex" alignItems="center" gap={2}>
        <span className="text-gray-600">
          No associated NetSuite Sales Order.
        </span>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={2}>
        <CircularProgress size={24} />
        <span className="text-gray-600">Loading invoices...</span>
      </Box>
    );
  }

  const PaymentMethodSection = (
    <>
      {customerId ? (
        <PaymentMethods
          customerId={customerId}
          refreshKey={pmRefreshKey}
          invoices={uniqueInvoices}
          onSelect={(val) => {
            const id =
              typeof val === "object" && val !== null
                ? val.instrumentId ?? val.paymentOptionId ?? val.id
                : val;
            setSelectedPaymentOptionId(id ? Number(id) : null);
          }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          Load a customer to select a payment method.
        </Typography>
      )}

      <Box mt={2}>
        <AddPaymentMethod
          customerId={customerId}
          invoices={uniqueInvoices}
          onSaved={() => setPmRefreshKey((k) => k + 1)}
          onError={(e) => console.error("VersaPay add method error:", e)}
        />
      </Box>
    </>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Box
        display="flex"
        flexWrap="wrap"
        gap={2}
        alignItems="center"
        justifyContent="flex-start"
        mb={4}
      >
        <Button
          variant="outlined"
          onClick={() => {
            setSelectedPaymentOptionId(null);
            setOpenDeposit(true);
          }}
          disabled={!customerId}
        >
          Create Deposit
        </Button>

        <Button
          variant="contained"
          onClick={() => {
            setSelectedPaymentOptionId(null);
            setOpenFull(true);
          }}
          disabled={!customerId}
        >
          Make Full Payment
        </Button>

        {!customerId && (
          <Typography variant="body2" color="text.secondary">
            (Customer not loaded yet — buttons enabled once invoices load.)
          </Typography>
        )}
      </Box>

      <h1 className="text-2xl font-bold mb-4 text-black">Invoices</h1>
      {invoices.length > 0 ? (
        <InvoiceGrid
          invoices={invoices}
          netsuiteInternalId={netsuiteInternalId}
          productCatalog={[]}
        />
      ) : (
        <div>No invoices related to this sales order.</div>
      )}

      {fullError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {fullError}
        </Alert>
      )}
      {fullSuccess && (
        <Alert severity="success" sx={{ mt: 2 }}>
          {fullSuccess}
        </Alert>
      )}

      <Dialog
        fullWidth
        maxWidth="md"
        open={openDeposit}
        onClose={() => setOpenDeposit(false)}
      >
        <DialogTitle>Create Deposit (10% down)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              We’ll collect an initial <strong>10% deposit</strong> against this
              Sales Order now. When the order is in stock, the remaining balance
              will be collected automatically.
            </Typography>
            <Divider />
            {PaymentMethodSection}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeposit(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setOpenDeposit(false);
            }}
            disabled={!selectedPaymentOptionId}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        fullWidth
        maxWidth="md"
        open={openFull}
        onClose={() => setOpenFull(false)}
      >
        <DialogTitle>Make Full Payment</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              This will record a payment against an existing NetSuite Invoice
              using the selected token.
            </Typography>
            <Divider />
            {PaymentMethodSection}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenFull(false)} disabled={submittingFull}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmFullPayment}
            disabled={!selectedPaymentOptionId || submittingFull}
          >
            {submittingFull ? "Processing..." : "Continue"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default PaymentTab;
