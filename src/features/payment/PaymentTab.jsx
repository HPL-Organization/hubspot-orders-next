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
  Tooltip,
  IconButton,
  TextField,
  InputAdornment,
  Link,
} from "@mui/material";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

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

  // invoice generation states
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genSuccess, setGenSuccess] = useState(null);

  // date states
  const [invoiceDates, setInvoiceDates] = useState({}); // { [invoiceId]: 'YYYY-MM-DD' }
  const [savingDateId, setSavingDateId] = useState(null);
  const [originalInvoiceDates, setOriginalInvoiceDates] = useState({});
  const [dateSaveState, setDateSaveState] = useState({});

  const [soCustomerId, setSoCustomerId] = useState(null);

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
  const hasInvoice = uniqueInvoices.length > 0;

  const refreshInvoices = useCallback(async () => {
    if (!netsuiteInternalId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/netsuite/invoices?internalId=${netsuiteInternalId}`
      );
      const data = await res.json();
      setInvoices(data.invoices || []);
      setSoCustomerId(data.customerId ?? null);
    } catch (err) {
      console.error("Failed to fetch related invoices:", err);
    } finally {
      setLoading(false);
    }
  }, [netsuiteInternalId]);

  useEffect(() => {
    refreshInvoices();
  }, [refreshInvoices]);

  // date useEffect
  useEffect(() => {
    if (!invoices?.length) return;
    const map = {};
    for (const inv of invoices) {
      const id = inv?.invoiceId ?? inv?.id ?? inv?.internalId;
      if (!id) continue;
      const raw = inv?.trandate || inv?.tranDate || inv?.date || "";
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? raw
        : (raw || "").slice(0, 10);
      if (iso) map[id] = iso;
    }
    setInvoiceDates((prev) => ({ ...map, ...prev }));
    setOriginalInvoiceDates(map);
  }, [invoices]);

  const customerId = invoices?.[0]?.customerId ?? soCustomerId ?? null;

  // date save helper
  const saveInvoiceDate = async (id) => {
    const value = invoiceDates[id];
    try {
      setSavingDateId(id);
      const res = await fetch(`/api/netsuite/invoices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(id), trandate: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save date");
      setOriginalInvoiceDates((m) => ({ ...m, [id]: value }));
      await refreshInvoices();
    } catch (e) {
      console.error("Save invoice date failed:", e);
      alert(e?.message || String(e));
    } finally {
      setSavingDateId(null);
    }
  };

  // generate invoice handler
  const handleGenerateInvoice = async () => {
    if (!netsuiteInternalId) return;
    setGenError(null);
    setGenSuccess(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/netsuite/make-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesOrderInternalId: Number(netsuiteInternalId),
          overrides: { memo: "Created from PaymentTab" },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.details || json?.error || "Failed to create invoice"
        );
      }

      setGenSuccess(
        `Invoice ${
          json?.invoiceInternalId ? "#" + json.invoiceInternalId + " " : ""
        }created successfully.`
      );

      await refreshInvoices();
    } catch (e) {
      console.error(e);
      setGenError(e?.message || String(e));
    } finally {
      setGenerating(false);
    }
  };

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
          salesOrderInternalId={netsuiteInternalId}
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
        mb={2}
      >
        {/* Deposit now works without invoices because customerId comes from SO */}
        <Button
          variant="outlined"
          onClick={() => {
            setSelectedPaymentOptionId(null);
            setOpenDeposit(true);
          }}
        >
          Create Deposit
        </Button>

        {/* Generate Invoice */}
        <Button
          variant="contained"
          color="secondary"
          onClick={handleGenerateInvoice}
          disabled={generating || hasInvoice || !netsuiteInternalId}
        >
          {generating
            ? "Generating..."
            : hasInvoice
            ? "Invoice Exists"
            : "Generate Invoice"}
        </Button>

        {/* Full payment still requires an invoice */}
        <Button
          variant="contained"
          onClick={() => {
            setSelectedPaymentOptionId(null);
            setOpenFull(true);
          }}
          disabled={!customerId || !hasInvoice}
        >
          Make Full Payment
        </Button>

        {!hasInvoice && (
          <Typography variant="body2" color="text.secondary">
            Full payment requires an Invoice. Deposits can be taken without one.
          </Typography>
        )}
      </Box>

      {genError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {genError}
        </Alert>
      )}
      {genSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {genSuccess}
        </Alert>
      )}

      <h1 className="text-2xl font-bold mb-4 text-black">Invoices</h1>
      {invoices.length > 0 ? (
        <>
          <Box sx={{ mb: 1 }}>
            {uniqueInvoices.map((inv) => {
              const id = inv?.invoiceId ?? inv?.id ?? inv?.internalId;
              const tranId = inv?.tranId ?? `#${id}`;
              const value = invoiceDates[id] || "";
              const orig = originalInvoiceDates[id] || "";
              const changed = value && value !== orig;
              const state = dateSaveState[id] || "idle";

              return (
                <Box
                  key={id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    py: 0.5,
                    px: 1,
                    mb: 0.75,
                    borderRadius: 1.5,
                    bgcolor: "grey.50",
                    border: "1px solid",
                    borderColor: "grey.200",
                  }}
                >
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Invoice{" "}
                    <Link
                      underline="hover"
                      sx={{ fontWeight: 600, cursor: "default" }}
                    >
                      {tranId}
                    </Link>
                  </Typography>

                  <TextField
                    type="date"
                    value={value}
                    onChange={(e) =>
                      setInvoiceDates((m) => ({ ...m, [id]: e.target.value }))
                    }
                    size="small"
                    sx={{ minWidth: 160, ml: 1 }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <CalendarMonthOutlinedIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <Box
                    sx={{ ml: "auto", display: "flex", alignItems: "center" }}
                  >
                    {state === "saved" ? (
                      <Tooltip title="Saved">
                        <CheckCircleOutlineIcon
                          color="success"
                          fontSize="small"
                        />
                      </Tooltip>
                    ) : state === "error" ? (
                      <Tooltip title="Error saving">
                        <ErrorOutlineIcon color="error" fontSize="small" />
                      </Tooltip>
                    ) : (
                      <Tooltip title={changed ? "Save date" : "No changes"}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!changed || state === "saving"}
                            onClick={() => saveInvoiceDate(id)}
                          >
                            {state === "saving" ? (
                              <CircularProgress size={16} />
                            ) : (
                              <SaveOutlinedIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
          <InvoiceGrid
            invoices={invoices}
            netsuiteInternalId={netsuiteInternalId}
            productCatalog={[]}
          />
        </>
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

      {/* CREATE DEPOSIT */}
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
              will be collected automatically (WIP).
            </Typography>
            <Divider />
            {PaymentMethodSection}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeposit(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* FULL PAYMENT */}
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
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default PaymentTab;
