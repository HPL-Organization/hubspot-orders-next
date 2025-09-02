"use client";
import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
} from "@mui/material";

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PaymentDialogOffline({
  open,
  onClose,
  invoices = [],
  defaultInvoiceId,
  defaultAmount,
  customerId,

  selectedMethod,
  defaultPaymentOptionId,
  onPaid,
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [invoiceId, setInvoiceId] = React.useState(defaultInvoiceId || "");
  const [amount, setAmount] = React.useState(
    defaultAmount != null ? String(defaultAmount) : ""
  );
  const [trandate, setTrandate] = React.useState(formatLocalDate());

  const invoiceOptions = React.useMemo(() => {
    return (invoices || []).map((inv) => {
      const id = inv?.invoiceId ?? inv?.id ?? String(inv?.tranId ?? "");
      const labelBase = inv?.tranId || id;
      const due = inv?.amountRemaining ?? inv?.total ?? null;
      const label = due != null ? `${labelBase} — Due: ${due}` : labelBase;
      return { id: String(id), label, due };
    });
  }, [invoices]);

  React.useEffect(() => {
    if (!open) return;
    if (!invoiceId && invoiceOptions[0]) {
      setInvoiceId(invoiceOptions[0].id);
      if (invoiceOptions[0].due != null)
        setAmount(String(invoiceOptions[0].due));
    }
  }, [open, invoiceId, invoiceOptions]);

  React.useEffect(() => {
    if (!open) return;
    if (!invoiceId && invoiceOptions[0]) {
      setInvoiceId(invoiceOptions[0].id);
      if (invoiceOptions[0].due != null)
        setAmount(String(invoiceOptions[0].due));
    }
    setTrandate((d) => d || formatLocalDate());
  }, [open, invoiceId, invoiceOptions]);

  async function submitPayment() {
    console.log("Hello?", customerId, invoiceId);
    if (!customerId || !invoiceId || !amount) return;

    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Amount must be greater than 0");
      return;
    }

    if (!selectedMethod || selectedMethod.kind !== "offline") {
      setError("Please select an offline payment method.");
      return;
    }

    const accountId = selectedMethod?._ns?.defaultAccountId;
    if (!accountId) {
      setError(
        "Selected payment method has no 'Deposit To' account in NetSuite."
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const dateToUse = trandate || formatLocalDate();
      const manualOptionMap = {
        12: 2117, // Shopify
        9: 10, // HPL PayPal
        13: 2118, //stripe
      };
      const pmId = Number(selectedMethod.id);
      const mappedPaymentOptionId =
        manualOptionMap[pmId] ?? Number(selectedMethod.id);
      const body = {
        invoiceInternalId: Number(invoiceId),
        amount: amt,
        undepFunds: false,
        accountId: Number(accountId),
        paymentMethodId: Number(selectedMethod.id),
        paymentOptionId: mappedPaymentOptionId,
        ...(defaultPaymentOptionId
          ? { paymentOptionId: Number(defaultPaymentOptionId) }
          : {}),
        memo: `Offline payment (${selectedMethod.title})`,
        trandate: dateToUse,
      };
      console.log("Trying to record offline payment", body);

      const res = await fetch("/api/netsuite/record-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        throw new Error(
          data?.details || data?.error || "Failed to record payment"
        );
      }

      onPaid && onPaid({ netsuite: data });
      onClose && onClose();
    } catch (e) {
      setError(e?.message || "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (!submitting ? onClose?.() : null)}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>Record Offline Payment</DialogTitle>
      <DialogContent>
        {/* Method summary */}
        {selectedMethod && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Method: <strong>{selectedMethod.title}</strong>
            {selectedMethod?._ns?.defaultAccountName
              ? ` · Deposit To: ${selectedMethod._ns.defaultAccountName}`
              : ""}
          </Typography>
        )}

        <FormControl fullWidth size="small" margin="dense">
          <InputLabel id="invoice-select-label">Invoice</InputLabel>
          <Select
            labelId="invoice-select-label"
            label="Invoice"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          >
            {invoiceOptions.map((opt) => (
              <MenuItem key={opt.id} value={opt.id}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="Amount"
          type="number"
          inputProps={{ min: 0, step: "0.01" }}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="Payment Date"
          type="date"
          value={trandate}
          onChange={(e) => setTrandate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />

        {error && (
          <Typography variant="body2" color="error" mt={1}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.()} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submitPayment}
          disabled={submitting || !invoiceId || !amount}
        >
          {submitting ? "Saving…" : "Record Payment"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
