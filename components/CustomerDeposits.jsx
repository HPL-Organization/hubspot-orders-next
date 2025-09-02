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
} from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";

export default function CustomerDeposits({ netsuiteInternalId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(netsuiteInternalId));
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const abortRef = useRef(null);

  const total = useMemo(() => {
    return items.reduce((sum, it) => {
      const n = Number(it?.amount ?? 0);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
  }, [items]);

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

  const prettyDateTime = (d) =>
    d ? new Date(d).toLocaleString(undefined, { hour12: true }) : "";

  const prettyAmount = (v) => {
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : String(v ?? "");
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
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="h6">Customer Deposits</Typography>
            <Chip
              size="small"
              label={`${items.length} item${items.length === 1 ? "" : "s"}`}
            />
          </Box>
        }
        subheader={
          <Box display="flex" gap={2} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Total: <strong>{prettyAmount(total)}</strong>
            </Typography>
            {lastUpdated && (
              <Typography variant="body2" color="text.secondary">
                Updated: {prettyDateTime(lastUpdated)}
              </Typography>
            )}
          </Box>
        }
        action={
          <Tooltip title="Refresh">
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
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No deposits found for this Sales Order.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="customer deposits">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Number</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    Amount
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Chip
                        size="small"
                        label={row.number ?? `#${row.id}`}
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                    <TableCell>{row.date || "--"}</TableCell>
                    <TableCell align="right">
                      {prettyAmount(row.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
