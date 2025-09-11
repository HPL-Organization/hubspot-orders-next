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
} from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";

export default function CustomerDeposits({
  netsuiteInternalId,
  deposits = [],
  unappliedDeposits = [],
}) {
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(netsuiteInternalId));
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState();
  const abortRef = useRef(null);

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
      if (e?.name !== "AbortError") {
        console.error("Deposit fetch failed:", e);
        setError(e?.message || String(e));
      }
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
    if (/fully\s*applied/i.test(s)) {
      return <Chip size="small" label="Fully Applied" color="success" />;
    }
    if (/partially\s*applied/i.test(s)) {
      return <Chip size="small" label="Partially Applied" color="warning" />;
    }
    const cleaned = s.replace(/^\s*Customer Deposit\s*:\s*/i, "").trim();
    return <Chip size="small" label={cleaned || "—"} variant="outlined" />;
  };

  const soTotals = useMemo(() => {
    const total = items.reduce((sum, it) => {
      const n = Number(it?.amount ?? 0);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
    return { count: items.length, total };
  }, [items]);

  const custAllTotals = useMemo(() => {
    const count = deposits.length;
    const total = deposits.reduce(
      (sum, d) => (Number.isFinite(+d.total) ? sum + +d.total : sum),
      0
    );
    const appliedToThisSO = deposits.filter(
      (d) =>
        d?.appliedTo?.soId &&
        Number(d.appliedTo.soId) === Number(netsuiteInternalId)
    );
    const appliedElsewhere = deposits.filter(
      (d) =>
        d?.appliedTo?.soId &&
        Number(d.appliedTo.soId) !== Number(netsuiteInternalId)
    );
    const unappliedToSO = deposits.filter((d) => d?.isUnappliedToSO);
    return {
      count,
      total,
      appliedToThisSO: { count: appliedToThisSO.length },
      appliedElsewhere: { count: appliedElsewhere.length },
      unappliedToSO: { count: unappliedToSO.length },
    };
  }, [deposits, netsuiteInternalId]);

  const custUnappliedTotals = useMemo(() => {
    const count = unappliedDeposits.length;
    const total = unappliedDeposits.reduce(
      (sum, d) => (Number.isFinite(+d.total) ? sum + +d.total : sum),
      0
    );
    return { count, total };
  }, [unappliedDeposits]);

  // ---------- table sources ----------
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
      })),
    [items]
  );

  const tableForUnapplied = useMemo(
    () =>
      (unappliedDeposits || []).map((d) => ({
        id: d.depositId,
        tranId: d.tranId ?? `#${d.depositId}`,
        date: d.trandate || "",
        amount: d.total,
        status: d.status,
        appliedTo: d.appliedTo || null,
        link: d.netsuiteUrl || null,
      })),
    [unappliedDeposits]
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
      })),
    [deposits]
  );

  const renderTable = (
    rows,
    showAppliedCol = false,
    emptyText = "No deposits found."
  ) => {
    if (!rows?.length) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          {emptyText}
        </Typography>
      );
    }
    return (
      <TableContainer>
        <Table size="small" aria-label="customer deposits">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Number</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 140 }}>Date</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, width: 140 }}>
                Amount
              </TableCell>
              {showAppliedCol && (
                <>
                  <TableCell sx={{ fontWeight: 600, width: 220 }}>
                    Applied To (SO)
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 160 }}>
                    Status
                  </TableCell>
                </>
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

              return (
                <TableRow key={row.id} hover>
                  <TableCell>{numEl}</TableCell>
                  <TableCell>{row.date || "—"}</TableCell>
                  <TableCell align="right">
                    {prettyAmount(row.amount)}
                  </TableCell>
                  {showAppliedCol && (
                    <>
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
                    </>
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
    <Card
      variant="outlined"
      sx={{
        mb: 3,
        borderRadius: 3,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <CardHeader
        title={
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="h6">Customer Deposits</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Divider orientation="vertical" flexItem />
              <Chip
                size="small"
                color="info"
                label={`Unapplied: ${custUnappliedTotals.count}`}
              />
              <Chip
                size="small"
                color="info"
                variant="outlined"
                label={`Unapplied Total: ${prettyAmount(
                  custUnappliedTotals.total
                )}`}
              />
              <Divider orientation="vertical" flexItem />
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={`Applied to this SO: ${custAllTotals.appliedToThisSO.count}`}
              />
            </Stack>
          </Box>
        }
        subheader={
          lastUpdated && (
            <Typography variant="body2" color="text.secondary">
              Updated: {lastUpdated.toLocaleString(undefined, { hour12: true })}
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
        {!netsuiteInternalId ? (
          <Typography variant="body2" color="text.secondary">
            No associated NetSuite Sales Order.
          </Typography>
        ) : error ? (
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
              <Tab
                label={`Unapplied (Customer) (${custUnappliedTotals.count})`}
              />
              <Tab label={`All (Customer) (${custAllTotals.count})`} />
            </Tabs>

            {tab === 0 &&
              renderTable(
                tableForThisSO,
                false,
                "No deposits found for this Sales Order."
              )}
            {tab === 1 &&
              renderTable(
                tableForUnapplied,
                true,
                "No unapplied deposits for this customer."
              )}
            {tab === 2 &&
              renderTable(tableForAll, true, "No deposits for this customer.")}
          </>
        )}
      </CardContent>
    </Card>
  );
}
