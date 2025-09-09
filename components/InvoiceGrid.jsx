"use client";
import React, { useState } from "react";
import { DataGrid } from "@mui/x-data-grid";
import { Box, Button, Collapse, Stack, Tooltip } from "@mui/material";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";

const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;

function renderInvoiceHTML(inv, rows) {
  const paymentsTable =
    inv.payments?.length || 0
      ? `
      <div class="section">
        <div class="section-title">Related Payments</div>
        <table>
          <thead>
            <tr><th>Date</th><th>Payment #</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${inv.payments
              .map(
                (p) => `
              <tr>
                <td>${p.paymentDate || ""}</td>
                <td>${p.tranId || ""}</td>
                <td>${fmtMoney(p.amount)}</td>
                <td>${p.status || ""}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice #${inv.tranId}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, "Helvetica Neue", Helvetica, system-ui, sans-serif; margin: 24px; color: #111; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
  .title { font-size: 22px; font-weight: 800; letter-spacing: .3px; }
  .meta { font-size: 12px; color:#555; margin-top:4px; }
  .section { margin-top: 18px; }
  .section-title { font-weight: 700; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; border: 1px solid #e5e7eb; font-size: 12px; }
  th { background: #f8fafc; text-align: left; }
  .totals { display:flex; gap:24px; flex-wrap:wrap; margin-top: 14px; }
  .tag { display:inline-block; padding:4px 8px; border:1px solid #e5e7eb; border-radius: 8px; font-size: 11px; color:#334155; background:#f8fafc; }
  @media print {
    @page { margin: 16mm; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">Invoice #${inv.tranId}</div>
      <div class="meta">
        ${inv.tranDate ? `Date: ${inv.tranDate}` : ""} ${
    inv.invoiceId
      ? `&nbsp;&nbsp;•&nbsp;&nbsp;Internal ID: ${inv.invoiceId}`
      : ""
  }
      </div>
    </div>
    <div class="tag">Amount Due: <strong>${fmtMoney(
      inv.amountRemaining
    )}</strong></div>
  </div>

  <div class="section">
    <div class="section-title">Line Items</div>
    <table>
      <thead>
        <tr>
          <th>Item ID</th>
          <th>SKU</th>
          <th>Qty</th>
          <th>Rate</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr>
            <td>${r.itemId ?? ""}</td>
            <td>${r.itemName ?? ""}</td>
            <td>${r.quantity ?? ""}</td>
            <td>${fmtMoney(r.rate)}</td>
            <td>${fmtMoney(r.amount)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="totals">
    <div><strong>Total:</strong> ${fmtMoney(inv.total)}</div>
    <div><strong>Amount Paid:</strong> ${fmtMoney(inv.amountPaid)}</div>
    <div><strong>Remaining:</strong> ${fmtMoney(inv.amountRemaining)}</div>
  </div>

  ${paymentsTable}
</body>
</html>`;
}

export default function InvoiceGrid({
  invoices,
  netsuiteInternalId,
  productCatalog = [],
}) {
  const [openPayments, setOpenPayments] = useState({});

  const togglePayments = (invoiceId) => {
    setOpenPayments((prev) => ({
      ...prev,
      [invoiceId]: !prev[invoiceId],
    }));
  };

  const columns = [
    {
      field: "invoiceNumber",
      headerName: "Invoice #",
      flex: 1,
      renderCell: (params) => {
        const href = params.row?.netsuiteUrl;
        const num = params.value;
        if (href) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1976d2", textDecoration: "underline" }}
              onClick={(e) => e.stopPropagation()} // prevent row focus
              aria-label={`Open invoice ${num} in NetSuite`}
            >
              #{num}
            </a>
          );
        }
        return <span>#{num}</span>;
      },
    },
    { field: "itemId", headerName: "Item ID", flex: 1 },
    { field: "itemName", headerName: "SKU", flex: 2 },
    { field: "quantity", headerName: "Qty", flex: 1 },
    {
      field: "rate",
      headerName: "Rate",
      flex: 1,
      renderCell: (params) => fmtMoney(params.value),
    },
    {
      field: "amount",
      headerName: "Amount",
      flex: 1,
      renderCell: (params) => fmtMoney(params.value),
    },
  ];

  const uniqueInvoicesMap = new Map();
  invoices.forEach((inv) => {
    if (!uniqueInvoicesMap.has(inv.invoiceId)) {
      uniqueInvoicesMap.set(inv.invoiceId, inv);
    }
  });
  const uniqueInvoices = Array.from(uniqueInvoicesMap.values());

  const handlePrint = (inv, rows) => {
    try {
      const html = renderInvoiceHTML(inv, rows);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      const cleanup = () => {
        try {
          document.body.removeChild(iframe);
        } catch {}
      };

      const armAfterPrint = (w) => {
        const onAfter = () => {
          w.removeEventListener("afterprint", onAfter);
          cleanup();
        };
        w.addEventListener("afterprint", onAfter);
        setTimeout(cleanup, 6000);
      };

      iframe.onload = () => {
        const w = iframe.contentWindow;
        if (!w) {
          cleanup();
          alert("Print failed to initialize.");
          return;
        }
        armAfterPrint(w);
        setTimeout(() => {
          w.focus();
          w.print();
        }, 50);
      };

      iframe.srcdoc = html;
    } catch (e) {
      console.error("Print failed:", e);
      alert("Failed to open print dialog for this invoice.");
    }
  };

  const handleDownloadPdf = async (inv, rows) => {
    try {
      const [{ default: jsPDF }, autoTableMod] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const autoTable = autoTableMod.default || autoTableMod;

      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`Invoice #${inv.tranId}`, 14, 18);
      doc.setFontSize(10);
      if (inv.tranDate) doc.text(`Date: ${inv.tranDate}`, 14, 26);
      if (inv.invoiceId) doc.text(`Internal ID: ${inv.invoiceId}`, 14, 32);

      autoTable(doc, {
        startY: 40,
        head: [["Item ID", "SKU", "Qty", "Rate", "Amount"]],
        body: rows.map((r) => [
          r.itemId ?? "",
          r.itemName ?? "",
          String(r.quantity ?? ""),
          fmtMoney(r.rate),
          fmtMoney(r.amount),
        ]),
        styles: { fontSize: 9 },
        headStyles: { halign: "left" },
        bodyStyles: { halign: "left" },
      });

      let y = doc.lastAutoTable?.finalY || 40;
      y += 10;

      doc.setFontSize(11);
      doc.text(`Total: ${fmtMoney(inv.total)}`, 14, y);
      doc.text(`Amount Paid: ${fmtMoney(inv.amountPaid)}`, 14, y + 6);
      doc.text(`Remaining: ${fmtMoney(inv.amountRemaining)}`, 14, y + 12);

      doc.save(`Invoice_${inv.tranId}.pdf`);
    } catch (e) {
      console.error("PDF export failed:", e);
      alert("PDF export failed. Falling back to print.");
      handlePrint(inv, rows);
    }
  };

  return (
    <Box sx={{ mt: 4 }}>
      {uniqueInvoices.map((inv) => {
        const invoiceRows =
          inv.lines?.map((line, index) => ({
            id: `inv-${inv.invoiceId}-${index}`,
            invoiceNumber: inv.tranId,
            netsuiteUrl: inv.netsuiteUrl || null,
            ...line,
          })) || [];

        return (
          <Box
            key={inv.invoiceId}
            sx={{
              mb: 4,
              p: 2,
              border: "1px solid #e0e0e0",
              borderRadius: 2,
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              backgroundColor: "#fff",
            }}
          >
            {/* Header with clickable invoice number */}
            <Box
              sx={{
                mb: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box sx={{ fontWeight: 600, fontSize: "1rem", color: "#333" }}>
                Invoice{" "}
                {inv.netsuiteUrl ? (
                  <Tooltip title="Open in NetSuite">
                    <a
                      href={inv.netsuiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#1976d2", textDecoration: "underline" }}
                    >
                      #{inv.tranId}
                    </a>
                  </Tooltip>
                ) : (
                  <span style={{ color: "#1976d2" }}>#{inv.tranId}</span>
                )}
              </Box>

              <Stack direction="row" spacing={1}>
                <Tooltip title="Print this invoice">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PrintOutlinedIcon />}
                    onClick={() => handlePrint(inv, invoiceRows)}
                  >
                    Print
                  </Button>
                </Tooltip>
                <Tooltip title="Download as PDF">
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<DownloadOutlinedIcon />}
                    onClick={() => handleDownloadPdf(inv, invoiceRows)}
                  >
                    PDF
                  </Button>
                </Tooltip>
              </Stack>
            </Box>

            <div style={{ height: 300, width: "100%", marginBottom: "16px" }}>
              <DataGrid
                rows={invoiceRows}
                columns={columns}
                pageSize={50}
                rowsPerPageOptions={[50]}
                disableRowSelectionOnClick
              />
            </div>

            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                rowGap: 1,
                fontSize: "0.95rem",
                color: "#444",
              }}
            >
              <Box>
                Amount Paid: <strong>{fmtMoney(inv.amountPaid)}</strong>
              </Box>
              <Box>
                Total: <strong>{fmtMoney(inv.total)}</strong>
              </Box>
              <Box>
                Remaining: <strong>{fmtMoney(inv.amountRemaining)}</strong>
              </Box>

              {inv.payments?.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => togglePayments(inv.invoiceId)}
                  >
                    {openPayments[inv.invoiceId]
                      ? "Hide Related Payments ▲"
                      : "Show Related Payments ▼"}
                  </Button>
                </Box>
              )}
            </Box>

            {inv.payments?.length > 0 && (
              <Collapse
                in={openPayments[inv.invoiceId]}
                timeout="auto"
                unmountOnExit
              >
                <Box mt={2}>
                  <Box
                    sx={{
                      fontWeight: 600,
                      fontSize: "0.95rem",
                      color: "#333",
                      mb: 1,
                    }}
                  >
                    Related Payments
                  </Box>
                  <table className="w-full text-sm text-gray-800 border">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-2 border text-left">Date</th>
                        <th className="p-2 border text-left">Payment #</th>
                        <th className="p-2 border text-left">Amount</th>
                        <th className="p-2 border text-left">Method</th>
                        <th className="p-2 border text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.payments.map((p) => (
                        <tr key={p.paymentId}>
                          <td className="p-2 border">{p.paymentDate}</td>
                          <td className="p-2 border">{p.tranId}</td>
                          <td className="p-2 border">{fmtMoney(p.amount)}</td>
                          <td className="p-2 border">
                            {p.paymentOption || ""}
                          </td>
                          <td className="p-2 border">{p.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Collapse>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
