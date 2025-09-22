"use client";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Card,
  CardHeader,
  CardContent,
  IconButton,
  Tooltip,
  LinearProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Box,
  Chip,
  Typography,
  Tabs,
  Tab,
  Link,
  Stack,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Backdrop,
  CircularProgress,
  Portal,
  Snackbar,
} from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";

export default function CustomerDeposits({
  netsuiteInternalId,
  deposits = [],
  invoices = [],
  customerId,
  onApplied,
}) {
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(netsuiteInternalId));
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState();
  const abortRef = useRef(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [selectedDeposit, setSelectedDeposit] = useState(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");

  const [backdropText, setBackdropText] = useState("");
  const [backdropOpen, setBackdropOpen] = useState(false);

  const [toast, setToast] = useState({
    open: false,
    message: "",
    severity: "success",
  });

  const fetchDeposits = useCallback(async () => {
    if (!netsuiteInternalId) return;
    setLoading(true);
    setError(null);
    abortRef.current?.abort?.();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        `/api/netsuite/get-deposits?internalId=${encodeURIComponent(
          netsuiteInternalId
        )}`,
        { signal: ctrl.signal }
      );
      const json = await res.json();
      if (!res.ok)
        throw new Error(
          json?.details || json?.error || "Failed to load deposits"
        );
      setItems(Array.isArray(json?.items) ? json.items : []);
      setLastUpdated(new Date());
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [netsuiteInternalId]);

  useEffect(() => {
    fetchDeposits();
    return () => abortRef.current?.abort?.();
  }, [fetchDeposits]);

  const prettyAmount = (v) => {
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : String(v ?? "");
  };

  const statusChip = (statusStr) => {
    const s = String(statusStr || "");
    if (/fully\s*applied/i.test(s))
      return <Chip size="small" label="Fully Applied" color="success" />;
    if (/partially\s*applied/i.test(s))
      return <Chip size="small" label="Partially Applied" color="warning" />;
    const cleaned = s.replace(/^\s*Customer Deposit\s*:\s*/i, "").trim();
    return <Chip size="small" label={cleaned || "—"} variant="outlined" />;
  };

  const soTotals = useMemo(() => {
    const total = items.reduce(
      (sum, it) => (Number.isFinite(+it?.amount) ? sum + +it.amount : sum),
      0
    );
    return { count: items.length, total };
  }, [items]);

  const tableForThisSO = useMemo(
    () =>
      items.map((r) => ({
        id: r.id,
        tranId: r.number ?? `#${r.id}`,
        date: r.date || "",
        amount: r.amount,
        status: "",
        appliedTo: null,
        link: null,
        isFullyApplied: false,
      })),
    [items]
  );

  const tableForAll = useMemo(
    () =>
      (deposits || []).map((d) => ({
        id: d.depositId,
        tranId: d.tranId ?? `#${d.depositId}`,
        date: d.trandate || "",
        amount: d.total,
        status: d.status,
        appliedTo: d.appliedTo || null,
        link: d.netsuiteUrl || null,
        isFullyApplied:
          Boolean(d.isFullyApplied) ||
          /fully\s*applied/i.test(String(d.status || "")),
      })),
    [deposits]
  );

  const openApply = (depositRow) => {
    setSelectedDeposit(depositRow);
    setApplyError(null);
    const firstInvoiceWithBalance =
      invoices.find((inv) => Number(inv?.amountRemaining ?? 0) > 0) ||
      invoices[0] ||
      null;
    const defaultInvoiceId =
      firstInvoiceWithBalance?.invoiceId ??
      firstInvoiceWithBalance?.id ??
      firstInvoiceWithBalance?.internalId ??
      "";
    setSelectedInvoiceId(defaultInvoiceId ? String(defaultInvoiceId) : "");
    setApplyOpen(true);
  };

  const handleApply = async () => {
    if (!customerId || !selectedDeposit?.id || !selectedInvoiceId) {
      setApplyError("Missing customer, deposit, or invoice.");
      return;
    }
    setApplyBusy(true);
    setApplyError(null);
    setBackdropText("Applying deposit…");
    setBackdropOpen(true);
    try {
      const inv = invoices.find(
        (i) =>
          String(i.invoiceId ?? i.id ?? i.internalId) ===
          String(selectedInvoiceId)
      );
      const invoiceRemaining = Number(inv?.amountRemaining ?? 0);
      if (!(invoiceRemaining > 0))
        throw new Error("Selected invoice has no remaining balance.");

      const payload = {
        customerId: Number(customerId),
        depositId: Number(selectedDeposit.id),
        invoiceId: Number(selectedInvoiceId),
        amount: invoiceRemaining,
      };

      const res = await fetch(`/api/netsuite/apply-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(
          json?.details?.o?.errorDetails?.[0]?.detail || json?.error || "Failed"
        );

      setApplyOpen(false);
      setSelectedDeposit(null);
      setToast({
        open: true,
        severity: "success",
        message: `Applied to ${inv?.tranId || `#${payload.invoiceId}`}.`,
      });
      if (typeof onApplied === "function") await onApplied();
      else await fetchDeposits();
    } catch (e) {
      setApplyError(e?.message || String(e));
      setToast({
        open: true,
        severity: "error",
        message: e?.message || "Failed to apply deposit",
      });
    } finally {
      setApplyBusy(false);
      setBackdropOpen(false);
      setBackdropText("");
    }
  };

  const renderTable = (
    rows,
    showAction = false,
    emptyText = "No deposits found."
  ) => {
    if (!rows?.length)
      return (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          {emptyText}
        </Typography>
      );
    return (
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Number</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 140 }}>Date</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, width: 140 }}>
                Amount
              </TableCell>
              <TableCell sx={{ fontWeight: 600, width: 220 }}>
                Applied To (SO)
              </TableCell>
              <TableCell sx={{ fontWeight: 600, width: 160 }}>Status</TableCell>
              {showAction && (
                <TableCell sx={{ fontWeight: 600, width: 120 }} align="center">
                  Action
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const numEl = row.link ? (
                <Link
                  href={row.link}
                  target="_blank"
                  underline="hover"
                  sx={{ fontWeight: 600 }}
                >
                  {row.tranId}
                </Link>
              ) : (
                <Chip
                  size="small"
                  label={row.tranId}
                  sx={{ fontWeight: 600 }}
                />
              );
              const fullyApplied = !!row.isFullyApplied;
              const canApply = showAction && !fullyApplied;

              return (
                <TableRow key={row.id} hover>
                  <TableCell>{numEl}</TableCell>
                  <TableCell>{row.date || "—"}</TableCell>
                  <TableCell align="right">
                    {prettyAmount(row.amount)}
                  </TableCell>
                  <TableCell>
                    {row.appliedTo?.soId ? (
                      row.appliedTo?.netsuiteUrl ? (
                        <Link
                          href={row.appliedTo.netsuiteUrl}
                          target="_blank"
                          underline="hover"
                          sx={{ fontWeight: 600 }}
                        >
                          {row.appliedTo?.soTranId ||
                            `SO #${row.appliedTo.soId}`}
                        </Link>
                      ) : (
                        <Chip
                          size="small"
                          label={
                            row.appliedTo?.soTranId ||
                            `SO #${row.appliedTo.soId}`
                          }
                        />
                      )
                    ) : (
                      <Chip
                        size="small"
                        label="Unapplied"
                        color="info"
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                  <TableCell>{statusChip(row.status)}</TableCell>
                  {showAction && (
                    <TableCell align="center">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => openApply(row)}
                        disabled={!invoices?.length || !customerId || !canApply}
                      >
                        Apply
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <>
      <Card
        variant="outlined"
        sx={{ mb: 3, borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
      >
        <CardHeader
          title={
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="h6">Customer Deposits</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Divider orientation="vertical" flexItem />
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={`Applied to this SO: ${
                    deposits.filter(
                      (d) => d?.appliedTo?.soId === Number(netsuiteInternalId)
                    ).length
                  }`}
                />
              </Stack>
            </Box>
          }
          subheader={
            lastUpdated && (
              <Typography variant="body2" color="text.secondary">
                Updated:{" "}
                {lastUpdated.toLocaleString(undefined, { hour12: true })}
              </Typography>
            )
          }
          action={
            <Tooltip title="Refresh SO deposits">
              <span>
                <IconButton
                  onClick={fetchDeposits}
                  disabled={loading || !netsuiteInternalId}
                >
                  <RefreshOutlinedIcon />
                </IconButton>
              </span>
            </Tooltip>
          }
          sx={{ pb: 0.5 }}
        />

        {loading && (
          <Box px={2}>
            <LinearProgress />
          </Box>
        )}

        <CardContent sx={{ pt: 1.5 }}>
          {error ? (
            <Alert severity="error">{error}</Alert>
          ) : (
            <>
              <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ mb: 1 }}
              >
                <Tab label={`This SO (${soTotals.count})`} />
                <Tab label={`All (Customer) (${deposits.length})`} />
              </Tabs>

              {tab === 0 &&
                renderTable(
                  tableForThisSO,
                  false,
                  "No deposits found for this Sales Order."
                )}
              {tab === 1 &&
                renderTable(
                  tableForAll,
                  true,
                  "No deposits for this customer."
                )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={applyOpen}
        onClose={() => !applyBusy && setApplyOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Apply Deposit</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              select
              label="Invoice"
              value={selectedInvoiceId}
              onChange={(e) => setSelectedInvoiceId(e.target.value)}
              fullWidth
            >
              {invoices.map((inv) => {
                const id = inv.invoiceId ?? inv.id ?? inv.internalId;
                const rem = Number(inv.amountRemaining ?? 0);
                const label = `${
                  inv.tranId || `#${id}`
                } — Remaining ${rem.toFixed(2)}`;
                return (
                  <MenuItem key={id} value={String(id)}>
                    {label}
                  </MenuItem>
                );
              })}
            </TextField>
            {applyError && <Alert severity="error">{applyError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplyOpen(false)} disabled={applyBusy}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={applyBusy || !selectedInvoiceId}
            variant="contained"
          >
            {applyBusy ? "Applying..." : "Apply"}
          </Button>
        </DialogActions>
      </Dialog>

      <Portal>
        <Backdrop
          open={backdropOpen}
          sx={{
            color: "#fff",
            zIndex: 2147483647,
            flexDirection: "column",
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography sx={{ fontWeight: 600 }}>
            {backdropText || "Working…"}
          </Typography>
          <LinearProgress sx={{ width: 320 }} />
        </Backdrop>
      </Portal>

      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={toast.message}
        ContentProps={{
          sx:
            toast.severity === "error"
              ? { bgcolor: "error.main", color: "#fff" }
              : { bgcolor: "success.main", color: "#fff" },
        }}
      />
    </>
  );
}
