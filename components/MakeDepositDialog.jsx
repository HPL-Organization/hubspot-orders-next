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
  Portal,
  Backdrop,
  LinearProgress,
  CircularProgress,
} from "@mui/material";
import { useVersapaySession } from "../src/hooks/useVersapaySession";
import { toast } from "react-toastify";

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function softParseJSON(val) {
  if (typeof val !== "string") return null;
  const s = val.trim();
  if (!s || (s[0] !== "{" && s[0] !== "[")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function messageFromObj(o) {
  if (!o || typeof o !== "object") return null;
  if (o.message || o.detail || o.title) return o.message || o.detail || o.title;
  return null;
}

function extractDetailStringsAny(input, seenCodes) {
  const out = [];

  const pushMsg = (m) => {
    if (typeof m === "string") {
      const t = m.trim();
      if (t) out.push(t);
    }
  };

  const pushFromArr = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      if (!d) continue;
      if (typeof d === "string") {
        const parsed = softParseJSON(d);
        if (parsed && Array.isArray(parsed)) {
          pushFromArr(parsed);
        } else if (parsed && typeof parsed === "object") {
          const msg = messageFromObj(parsed);
          if (parsed["o:errorCode"] && !seenCodes.code) {
            seenCodes.code = parsed["o:errorCode"];
          }
          pushMsg(msg || JSON.stringify(parsed));
        } else {
          pushMsg(d);
        }
      } else if (typeof d === "object") {
        if (d["o:errorCode"] && !seenCodes.code) {
          seenCodes.code = d["o:errorCode"];
        }
        const msg = messageFromObj(d);
        pushMsg(msg || JSON.stringify(d));
      }
    }
  };

  if (typeof input === "string") {
    const parsed = softParseJSON(input);
    if (parsed && Array.isArray(parsed)) {
      pushFromArr(parsed);
      return out;
    }
    if (parsed && typeof parsed === "object") {
      const msg = messageFromObj(parsed);
      if (parsed["o:errorCode"] && !seenCodes.code) {
        seenCodes.code = parsed["o:errorCode"];
      }
      pushMsg(msg || JSON.stringify(parsed));
      return out;
    }
    pushMsg(input);
    return out;
  }

  if (!input || typeof input !== "object") return out;

  if (Array.isArray(input["o:errorDetails"]))
    pushFromArr(input["o:errorDetails"]);

  if (Array.isArray(input.details)) pushFromArr(input.details);
  if (typeof input.details === "string") {
    const parsed = softParseJSON(input.details);
    if (parsed && Array.isArray(parsed)) pushFromArr(parsed);
    else if (parsed && typeof parsed === "object") {
      const msg = messageFromObj(parsed);
      if (parsed["o:errorCode"] && !seenCodes.code) {
        seenCodes.code = parsed["o:errorCode"];
      }
      pushMsg(msg || JSON.stringify(parsed));
    } else {
      pushMsg(input.details);
    }
  }
  if (
    input.details &&
    typeof input.details === "object" &&
    !Array.isArray(input.details)
  ) {
    const msg = messageFromObj(input.details);
    if (input.details["o:errorCode"] && !seenCodes.code) {
      seenCodes.code = input.details["o:errorCode"];
    }
    pushMsg(msg || JSON.stringify(input.details));
  }

  if (Array.isArray(input.errors)) pushFromArr(input.errors);
  if (Array.isArray(input.messages)) pushFromArr(input.messages);

  const single = input.message || input.detail || input.title;
  if (single) pushMsg(single);

  return out;
}

function dig(obj, key) {
  return obj && typeof obj === "object" ? obj[key] : undefined;
}

function buildPrettyNsError(json, fallback = "Operation failed") {
  if (!json) return fallback;

  const primaryCandidate =
    (typeof json.pretty === "string" && json.pretty.trim()) ||
    json.title ||
    json.message ||
    json.detail ||
    json.error ||
    dig(json.payload, "title") ||
    dig(json.payload, "message") ||
    dig(json.payload, "detail") ||
    (typeof json.rawText === "string" ? json.rawText : "") ||
    (typeof json === "string" ? json : "") ||
    fallback;

  const seenCodes = {
    code:
      json["o:errorCode"] ||
      json.errorCode ||
      json.code ||
      dig(json.payload, "o:errorCode") ||
      dig(json.payload, "errorCode") ||
      dig(json.payload, "code") ||
      undefined,
  };

  const detailsArr = [
    ...extractDetailStringsAny(json, seenCodes),
    ...extractDetailStringsAny(json.payload, seenCodes),
    ...extractDetailStringsAny(json.raw, seenCodes),
    ...extractDetailStringsAny(json.rawText, seenCodes),
  ]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s, i, a) => s && a.indexOf(s) === i && s !== primaryCandidate);

  const errSuffix = seenCodes.code ? ` [${seenCodes.code}]` : "";
  const detailsSuffix = detailsArr.length ? ` — ${detailsArr.join(" | ")}` : "";

  return `${primaryCandidate}${errSuffix}${detailsSuffix}`;
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
  onRefreshStatuses,
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
      const externalId = `HPL_${salesOrderInternalId}_${Date.now()}`;

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

      const txt = await rdRes.text();
      let rdJson = {};
      try {
        rdJson = txt ? JSON.parse(txt) : {};
      } catch {
        rdJson = { rawText: txt };
      }

      if (!rdRes.ok) {
        const msg =
          buildPrettyNsError(
            rdJson,
            `Failed to record deposit (HTTP ${rdRes.status})`
          ) || `Failed to record deposit (HTTP ${rdRes.status})`;

        console.error("Deposit failed", { status: rdRes.status, rdJson, txt });

        setError(msg);
        return;
      }

      toast.success("Deposit created");
      onRefreshStatuses?.();
      onClose && onClose();
      resetVersapaySession();
    } catch (e) {
      const msg = e?.message || "Deposit failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
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
            <Typography
              variant="body2"
              color="error"
              mt={1}
              sx={{ whiteSpace: "pre-wrap", userSelect: "text" }}
            >
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

      <Portal>
        <Backdrop
          open={!!open && submitting}
          sx={{
            color: "#fff",
            zIndex: 2147483647,
            flexDirection: "column",
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography sx={{ fontWeight: 600 }}>Recording deposit…</Typography>
          <LinearProgress sx={{ width: 320 }} />
        </Backdrop>
      </Portal>
    </>
  );
}
