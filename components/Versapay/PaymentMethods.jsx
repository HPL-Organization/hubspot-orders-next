"use client";
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  CircularProgress,
  Typography,
  Button,
  TextField,
  Chip,
} from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";
import PaymentDialog from "./MakePaymentDialog";
import { useVersapaySession } from "../../src/hooks/useVersapaySession";
import PaymentDialogOffline from "../PaymentDialogOffline";
import MakeDepositDialog from "../MakeDepositDialog";
import DepositDialogOffline from "../DepositDialogOffline";

export default function PaymentMethods({
  customerId,
  invoices = [],
  refreshKey = 0,
  onSelect,
  defaultSelectedId = null,
  onPaid,
  salesOrderInternalId = null,
  onDeposited,
  onRefreshStatuses,
}) {
  const [loading, setLoading] = useState(false);
  const [instruments, setInstruments] = useState([]);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(defaultSelectedId);
  const [vpSessionId, setVpSessionId] = useState(null);

  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");

  const [depOpen, setDepOpen] = useState(false);
  const [depOfflineOpen, setDepOfflineOpen] = useState(false);

  const [offlineMethods, setOfflineMethods] = useState([]);
  const [offlineOpen, setOfflineOpen] = useState(false);

  const { withSession, reset: resetVersapaySession } = useVersapaySession();

  useEffect(() => {
    setSelectedId(defaultSelectedId ?? null);
  }, [defaultSelectedId]);

  const subtitle = useMemo(() => {
    if (!instruments?.length) return "No saved payment methods";
    return `${instruments.length} saved payment method${
      instruments.length > 1 ? "s" : ""
    }`;
  }, [instruments]);

  async function load() {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/netsuite/get-payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerInternalId: customerId }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Failed to fetch payment methods");
      }
      setInstruments(data.instruments || []);
      const pmRes = await fetch("/api/netsuite/get-offline-payment-method");
      const pmJson = await pmRes.json();
      setOfflineMethods(pmJson?.methods || []);
    } catch (e) {
      setError(e?.message || "Failed to fetch payment methods");
      setInstruments([]);
      setOfflineMethods([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (customerId) load();
  }, [customerId, refreshKey]);

  // useEffect(() => {
  //   if (selectedId && !instruments.some((pm) => pm.id === selectedId)) {
  //     setSelectedId(null);
  //   }
  // }, [instruments, selectedId]);

  // If current selection disappears from BOTH lists, clear it; otherwise keep it.

  const invoiceOptions = useMemo(() => {
    return (invoices || []).map((inv) => {
      const id = inv?.invoiceId ?? inv?.id ?? String(inv?.tranId ?? "");
      const labelBase = inv?.tranId || id;
      const due = inv?.amountRemaining ?? inv?.total ?? null;
      const label = due != null ? `${labelBase} — Due: ${due}` : labelBase;
      return { id: String(id), label, due };
    });
  }, [invoices]);

  const instrumentOptions = useMemo(
    () =>
      instruments.map((pm) => {
        const title =
          pm.paymentMethod || pm.brand || pm.tokenFamily || "Payment Method";

        let formattedExpiry = null;
        if (pm.expiry) {
          try {
            const dateOnly = new Date(pm.expiry).toISOString().split("T")[0];

            formattedExpiry = dateOnly;
          } catch (err) {
            formattedExpiry = pm.expiry;
          }
        }
        return {
          id: pm.id,
          title,
          brand: pm.brand ?? null,
          last4: pm.last4 ?? null,
          expiry: formattedExpiry ?? null,
          tokenFamily: pm.tokenFamily ?? null,
          kind: "token",
        };
      }),
    [instruments]
  );

  const offlineOptions = useMemo(
    () =>
      (offlineMethods || [])
        .filter(
          (m) =>
            !/^\s*general\s+token\s*$/i.test(m.name) &&
            !/^\s*payment\s*card\s*token\s*$/i.test(m.name)
        )
        .map((m) => ({
          id: String(m.id),
          title: m.name,
          brand: null,
          last4: null,
          expiry: null,
          tokenFamily: m.defaultAccountName ? m.defaultAccountName : "Offline",
          kind: "offline",
          _ns: {
            undepositedDefault: m.undepositedDefault,
            defaultAccountId: m.defaultAccountId,
            defaultAccountName: m.defaultAccountName,
          },
        })),
    [offlineMethods]
  );
  const allOptions = useMemo(
    () => [...instrumentOptions, ...offlineOptions],
    [instrumentOptions, offlineOptions]
  );

  // const selectedOption = useMemo(
  //   () => instrumentOptions.find((o) => o.id === selectedId) ?? null,
  //   [instrumentOptions, selectedId]
  // );
  useEffect(() => {
    if (selectedId && !allOptions.some((o) => o.id === selectedId)) {
      setSelectedId(null);
    }
  }, [allOptions, selectedId]);

  const selectedOption = useMemo(
    () => allOptions.find((o) => o.id === selectedId) ?? null,
    [allOptions, selectedId]
  );

  async function handleMakePayment() {
    if (!customerId || !selectedId) return;
    const sel = selectedOption;
    if (!sel) return;
    const first = invoiceOptions[0];
    if (first) {
      setInvoiceId(first.id);
      if (first.due != null) setAmount(String(first.due));
    }
    if (sel.kind === "token") {
      setPayOpen(true);
    } else {
      setOfflineOpen(true);
    }
  }

  async function handleCreateDeposit() {
    if (!customerId || !selectedId) return;
    const sel = selectedOption;
    if (!sel) return;
    const first = invoiceOptions[0];
    if (first?.due != null) setAmount(String(first.due));
    if (sel.kind === "token") setDepOpen(true);
    else setDepOfflineOpen(true);
  }

  async function submitPayment() {
    if (!customerId || !selectedId || !invoiceId || !amount) return;
    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Amount must be greater than 0");
      return;
    }
    setPaying(true);
    setError(null);
    try {
      // const sessionId = await ensureVersapaySession();
      const data = await withSession(async (sessionId) => {
        const res = await fetch("/api/versapay/make-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            customerId,
            instrumentId: selectedId,
            invoiceId,
            amount: amt,
          }),
        });
        const json = await res.json();
        if (!res.ok || json?.success === false) {
          throw new Error(json?.message || "Payment failed");
        }
        return json;
      });
      setPayOpen(false);
      setAmount("");
      setInvoiceId("");
      //setVpSessionId(null);
      resetVersapaySession();
      onPaid && onPaid(data);
    } catch (e) {
      setError(e?.message || "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  // async function ensureVersapaySession() {
  //   if (vpSessionId) return vpSessionId;
  //   const resp = await fetch("/api/versapay/create-session", {
  //     method: "POST",
  //   });
  //   const json = await resp.json();
  //   if (!resp.ok || !json?.sessionId) {
  //     throw new Error(json?.message || "Failed to create Versapay session");
  //   }
  //   setVpSessionId(json.sessionId);
  //   return json.sessionId;
  // }

  if (!customerId) {
    return (
      <Box className="mb-4">
        <Typography variant="h6" className="text-black">
          Payment Methods
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Customer not loaded yet.
        </Typography>
      </Box>
    );
  }

  return (
    <Box className="mb-6">
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="h6" className="text-black">
          Payment Methods
        </Typography>
        <Box display="flex" gap={1}>
          <Button onClick={load} disabled={loading} size="small">
            Refresh
          </Button>
          <Button
            variant="contained"
            size="small"
            disabled={!selectedId || !invoiceOptions.length}
            onClick={handleMakePayment}
          >
            Make Payment
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={!selectedId || !salesOrderInternalId}
            onClick={handleCreateDeposit}
          >
            Create Deposit
          </Button>
        </Box>
      </Box>
      {loading ? (
        <Box display="flex" alignItems="center" gap={2} mt={1}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading payment methods…
          </Typography>
        </Box>
      ) : error ? (
        <Typography variant="body2" color="error" mt={1}>
          {error}
        </Typography>
      ) : (
        <>
          {/* More space between count and dropdown */}
          <Typography variant="body2" color="text.secondary" mt={0.5} mb={2.25}>
            {subtitle}
          </Typography>

          <Autocomplete
            size="small"
            fullWidth
            options={allOptions}
            groupBy={(o) =>
              o.kind === "token" ? "Saved tokens" : "Offline methods"
            }
            value={selectedOption}
            onChange={(_, val) => {
              const id = val?.id ?? null;
              setSelectedId(id);
              onSelect && onSelect(id);
            }}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            getOptionLabel={(o) =>
              [o.title, o.brand, o.last4 ? `•••• ${o.last4}` : null]
                .filter(Boolean)
                .join(" · ")
            }
            noOptionsText="No payment methods available"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Choose a payment method"
                placeholder={
                  instrumentOptions.length ? "Select…" : "No methods available"
                }
                sx={{
                  mt: 1,
                  "& .MuiInputBase-root": { py: 1.25 },
                }}
              />
            )}
            renderOption={(props, option) => (
              <li {...props}>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                    gap: 0.5,
                    py: 0.5,
                  }}
                >
                  <Typography
                    variant="body1"
                    sx={{ lineHeight: 1.3 }}
                    className="text-black"
                  >
                    {option.title}
                  </Typography>

                  <Box
                    sx={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 0.75,
                    }}
                  >
                    {option.brand && <Chip size="small" label={option.brand} />}
                    {option.last4 && (
                      <Chip size="small" label={`•••• ${option.last4}`} />
                    )}
                    {option.expiry && (
                      <Chip size="small" label={`Exp: ${option.expiry}`} />
                    )}
                    {option.tokenFamily && (
                      <Chip size="small" label={option.tokenFamily} />
                    )}
                  </Box>
                </Box>
              </li>
            )}
            // Slightly roomier listbox
            ListboxProps={{
              sx: {
                maxHeight: 360,
                "& .MuiAutocomplete-option": { alignItems: "flex-start" },
              },
            }}
            PaperProps={{
              elevation: 3,
            }}
            disabled={!allOptions.length}
          />
        </>
      )}
      <PaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        invoices={invoices}
        customerId={customerId}
        paymentSource={{ instrumentId: selectedId }}
        onPaid={(data) => {
          resetVersapaySession();
          setPayOpen(false);
          onPaid && onPaid(data);
        }}
        submitting={paying}
        onSubmit={submitPayment}
        invoiceId={invoiceId}
        setInvoiceId={setInvoiceId}
        amount={amount}
        setAmount={setAmount}
        onRefreshStatuses={onRefreshStatuses}
      />
      {/*  Offline dialog */}
      <PaymentDialogOffline
        open={offlineOpen}
        onClose={() => setOfflineOpen(false)}
        invoices={invoices}
        invoiceId={invoiceId}
        setInvoiceId={setInvoiceId}
        customerId={customerId}
        amount={amount}
        setAmount={setAmount}
        onRefreshStatuses={onRefreshStatuses}
        selectedMethod={
          selectedOption?.kind === "offline" ? selectedOption : null
        }
        onRecorded={(data) => {
          setOfflineOpen(false);
          setAmount("");
          setInvoiceId("");
          onPaid && onPaid(data);
        }}
      />
      {/* NEW: Deposit (token) */}
      <MakeDepositDialog
        open={depOpen}
        onClose={() => setDepOpen(false)}
        salesOrderInternalId={salesOrderInternalId}
        customerId={customerId}
        paymentSource={{ instrumentId: selectedId }}
        amount={amount}
        setAmount={setAmount}
        onPaid={(data) => {
          setDepOpen(false);
          onDeposited && onDeposited(data);
        }}
      />
      {/* NEW: Deposit (offline) */}
      <DepositDialogOffline
        open={depOfflineOpen}
        onClose={() => setDepOfflineOpen(false)}
        customerId={customerId}
        salesOrderInternalId={salesOrderInternalId}
        selectedMethod={
          selectedOption?.kind === "offline" ? selectedOption : null
        }
        amount={amount}
        setAmount={setAmount}
        onRecorded={(json) => {
          setDepOfflineOpen(false);
          onDeposited && onDeposited({ versaPay: null, netsuite: json });
        }}
      />
    </Box>
  );
}
