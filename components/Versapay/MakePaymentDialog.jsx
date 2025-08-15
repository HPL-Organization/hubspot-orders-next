"use client";
import React, { useMemo, useState } from "react";
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

export default function PaymentDialog({
  open,
  onClose,
  invoices = [],
  defaultInvoiceId,
  defaultAmount,
  ensureSession,
  customerId,
  paymentSource,
  onPaid,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId || "");
  const [amount, setAmount] = useState(
    defaultAmount != null ? String(defaultAmount) : ""
  );

  const invoiceOptions = useMemo(() => {
    return (invoices || []).map((inv) => {
      const id = inv?.invoiceId ?? inv?.id ?? String(inv?.tranId ?? "");
      const labelBase = inv?.tranId || id;
      const due = inv?.amountRemaining ?? inv?.total ?? null;
      const label = due != null ? `${labelBase} — Due: ${due}` : labelBase;
      return { id: String(id), label, due };
    });
  }, [invoices]);

  // Auto-prime first invoice/amount when dialog opens
  React.useEffect(() => {
    if (!open) return;
    if (!invoiceId && invoiceOptions[0]) {
      setInvoiceId(invoiceOptions[0].id);
      if (invoiceOptions[0].due != null)
        setAmount(String(invoiceOptions[0].due));
    }
  }, [open, invoiceId, invoiceOptions]);

  async function submitPayment() {
    if (!customerId || !invoiceId || !amount) return;
    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Amount must be greater than 0");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const sessionId = await ensureSession();
      // Accept either instrumentId OR token
      const body = {
        sessionId,
        customerId,
        invoiceId,
        amount: amt,
        instrumentId: paymentSource?.instrumentId || undefined,
        token: paymentSource?.token || undefined,
      };

      const res = await fetch("/api/versapay/make-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Payment failed");
      }

      onPaid && onPaid(data);
      onClose && onClose();
    } catch (e) {
      setError(e?.message || "Payment failed");
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
      <DialogTitle>Make a Payment</DialogTitle>
      <DialogContent>
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
          {submitting ? "Processing…" : "Pay"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
