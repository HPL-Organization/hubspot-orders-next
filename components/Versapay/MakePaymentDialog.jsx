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
import { useVersapaySession } from "../../src/hooks/useVersapaySession";
import { toast } from "react-toastify";

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PaymentDialog({
  open,
  onClose,
  invoices = [],
  defaultInvoiceId,
  defaultAmount,
  customerId,
  paymentSource,
  onPaid,
}) {
  const { withSession, reset: resetVersapaySession } = useVersapaySession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId || "");
  const [amount, setAmount] = useState(
    defaultAmount != null ? String(defaultAmount) : ""
  );
  const [trandate, setTrandate] = useState(formatLocalDate());

  const invoiceOptions = useMemo(() => {
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
      if (invoiceOptions[0].due != null) setAmount(String(invoices[0].due));
    }
    setTrandate((d) => d || formatLocalDate());
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
      const externalId = `HPL_${invoiceId}_${Date.now()}`;

      const rpRes = await fetch("/api/netsuite/record-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceInternalId: Number(invoiceId),
          amount: amt,
          undepFunds: true,
          paymentOptionId:
            paymentSource?.instrumentId != null
              ? Number(paymentSource.instrumentId)
              : undefined,
          memo: "VersaPay payment",
          externalId,
          trandate: trandate || formatLocalDate(),
          //trandate: new Date().toISOString().slice(0, 10),
        }),
      });
      const rpJson = await rpRes.json().catch(() => ({}));
      if (!rpRes.ok) {
        throw new Error(
          rpJson?.details || rpJson?.error || "Failed to record payment"
        );
      }
      toast.success(
        `Payment recorded: $${amt.toFixed(2)} applied to invoice ${invoiceId}.`
      );

      onClose && onClose();
      resetVersapaySession();
    } catch (e) {
      setError(e?.message || "Payment failed");
      toast.error("Payment failed");
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
          {submitting ? "Processing…" : "Pay"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
