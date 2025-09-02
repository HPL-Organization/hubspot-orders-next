// components/versapay/DepositDialogOffline.jsx
"use client";
import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DepositDialogOffline({
  open,
  onClose,
  salesOrderInternalId,
  customerId,
  selectedMethod,
  amount,
  setAmount,
  onRecorded,
  defaultPaymentOptionId,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [trandate, setTrandate] = useState(formatLocalDate());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTrandate((d) => d || formatLocalDate());
  }, [open]);

  async function submit() {
    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Amount must be greater than 0");
      return;
    }
    if (!selectedMethod?.id) {
      setError("Select an offline method");
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
        13: 2118, // Stripe
      };
      const pmId = Number(selectedMethod.id);
      const mappedPaymentOptionId =
        manualOptionMap[pmId] ?? Number(selectedMethod.id);

      const body = {
        salesOrderInternalId: Number(salesOrderInternalId),
        amount: amt,
        undepFunds: false,
        accountId: Number(accountId),
        paymentMethodId: Number(selectedMethod.id),
        paymentOptionId:
          defaultPaymentOptionId != null
            ? Number(defaultPaymentOptionId)
            : mappedPaymentOptionId,
        memo: `Offline deposit (${selectedMethod.title})`,
        trandate: dateToUse,
      };

      const res = await fetch("/api/netsuite/record-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok)
        throw new Error(
          json?.details || json?.error || "Failed to record deposit"
        );

      toast.success("Deposit created");
      onRecorded?.(json);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Failed to record deposit");
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
      <DialogTitle>Create Offline Deposit</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="Amount"
          type="number"
          inputProps={{ min: 0, step: "0.01" }}
          value={amount ?? ""}
          onChange={(e) => setAmount?.(e.target.value)}
        />
        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="Deposit Date"
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
          onClick={submit}
          disabled={submitting || !amount}
        >
          {submitting ? "Recording…" : "Record Deposit"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
