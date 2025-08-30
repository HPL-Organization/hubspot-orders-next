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
import { useVersapaySession } from "../src/hooks/useVersapaySession";

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MakeDepositDialog({
  open,
  onClose,
  customerId,
  paymentSource,
  onPaid,
  salesOrderInternalId,
  amount,
  setAmount,
}) {
  const { withSession, reset: resetVersapaySession } = useVersapaySession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [trandate, setTrandate] = useState(formatLocalDate());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTrandate((d) => d || formatLocalDate());
  }, [open]);

  async function submitDeposit() {
    if (!customerId || !salesOrderInternalId || !amount) return;
    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Amount must be greater than 0");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // 1) Charge in VersaPay (same flow as MakePaymentDialog, just no invoiceId)

      const externalId = `HPL_${salesOrderInternalId}_${Date.now()}`;

      // 2) Record Customer Deposit in NetSuite
      const rdRes = await fetch("/api/netsuite/record-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesOrderInternalId: Number(salesOrderInternalId),
          amount: amt,
          undepFunds: true,
          paymentOptionId:
            paymentSource?.instrumentId != null
              ? Number(paymentSource.instrumentId)
              : undefined,
          memo: "VersaPay deposit",
          externalId,
          trandate: trandate || formatLocalDate(),
        }),
      });
      const rdJson = await rdRes.json().catch(() => ({}));
      if (!rdRes.ok) {
        throw new Error(
          rdJson?.details || rdJson?.error || "Failed to record deposit"
        );
      }

      onClose && onClose();
      resetVersapaySession();
    } catch (e) {
      setError(e?.message || "Deposit failed");
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
      <DialogTitle>Create Deposit</DialogTitle>
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
          onClick={submitDeposit}
          disabled={submitting || !amount}
        >
          {submitting ? "Processing…" : "Charge & Record Deposit"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
