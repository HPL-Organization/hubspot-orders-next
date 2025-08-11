"use client";
import React, { useRef, useState } from "react";
import { DataGrid } from "@mui/x-data-grid";
import { Box, Button, Collapse } from "@mui/material";

const InvoiceGrid = ({ invoices, productCatalog = [] }) => {
  const [openPayments, setOpenPayments] = useState({}); // Track which invoices are expanded

  const togglePayments = (invoiceId) => {
    setOpenPayments((prev) => ({
      ...prev,
      [invoiceId]: !prev[invoiceId],
    }));
  };

  const columns = [
    { field: "invoiceNumber", headerName: "Invoice #", flex: 1 },
    { field: "itemId", headerName: "Item ID", flex: 1 },
    { field: "itemName", headerName: "SKU", flex: 2 },
    { field: "quantity", headerName: "Qty", flex: 1 },
    {
      field: "rate",
      headerName: "Rate",
      flex: 1,
      renderCell: (params) => `$${Number(params.value || 0).toFixed(2)}`,
    },
    {
      field: "amount",
      headerName: "Amount",
      flex: 1,
      renderCell: (params) => `$${Number(params.value || 0).toFixed(2)}`,
    },
  ];

  const uniqueInvoicesMap = new Map();
  invoices.forEach((inv) => {
    if (!uniqueInvoicesMap.has(inv.invoiceId)) {
      uniqueInvoicesMap.set(inv.invoiceId, inv);
    }
  });
  const uniqueInvoices = Array.from(uniqueInvoicesMap.values());
  const [showAddUI, setShowAddUI] = useState({});
  const clientRefs = useRef({});

  //versapy
  const handleAddPaymentMethod = async (invoiceId, inv) => {
    try {
      // Show the UI block
      setShowAddUI((prev) => ({ ...prev, [invoiceId]: true }));

      const res = await fetch("/api/versapay/create-session", {
        method: "POST",
      });
      const { sessionId } = await res.json();
      console.log("Session id", sessionId);
      if (typeof versapay === "undefined") {
        console.error("Versapay SDK not loaded.");
        return;
      }

      // Mount target
      const container = document.querySelector(`#vp-container-${invoiceId}`);
      if (!container) {
        console.error("No container found for invoice:", invoiceId);
        return;
      }

      // Prevent duplicate mounts in dev/StrictMode
      if (clientRefs.current[invoiceId]) {
        // already initialized once for this invoice
        return;
      }

      // Clear any previous inner content to avoid removeChild errors
      container.innerHTML = "";
      // Initialize the client and mount the iframe
      const _client = versapay.initClient(sessionId, {}, []);
      console.log("Versapay Client initialized:", _client);
      const client =
        typeof _client?.then === "function" ? await _client : _client;
      clientRefs.current[invoiceId] = client;

      const frameReady = client.initFrame(container, "358px", "500px");
      console.log("Versapay iframe successfully initialized.", frameReady);
      console.log();
      client.onApproval(
        async (result) => {
          console.log("Token received:", result);

          const token = result.token;
          const customerId = inv.customerId;

          const response = await fetch("/api/netsuite/save-payment-method", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              customerInternalId: customerId,
              token,
            }),
          });

          if (response.ok) {
            console.log("Payment method saved successfully.");
          } else {
            console.error("Failed to save payment method.");
          }
        },
        (error) => {
          console.error("Payment rejected:", error?.error || error);
        }
      );

      frameReady.then(() => {
        // Enable the save button
        const saveBtn = document.querySelector(`#vp-save-${invoiceId}`);
        saveBtn?.removeAttribute("disabled");
      });
    } catch (err) {
      console.error(
        "Failed to create Versapay session:",
        err.response?.data || err
      );
    }
  };

  return (
    <Box sx={{ mt: 4 }}>
      <h2 className="text-xl font-semibold text-black mb-4">
        Related Invoices
      </h2>

      {uniqueInvoices.map((inv) => {
        const invoiceRows =
          inv.lines?.map((line, index) => ({
            id: `inv-${inv.invoiceId}-${index}`,
            invoiceNumber: inv.tranId,
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
            <Box
              sx={{ mb: 2, fontWeight: 600, fontSize: "1rem", color: "#333" }}
            >
              Invoice <span style={{ color: "#1976d2" }}>#{inv.tranId}</span>
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
                Amount Paid:{" "}
                <strong>${Number(inv.amountPaid || 0).toFixed(2)}</strong>
              </Box>
              <Box>
                Total: <strong>${Number(inv.total || 0).toFixed(2)}</strong>
              </Box>
              <Box>
                Remaining:{" "}
                <strong>${Number(inv.amountRemaining || 0).toFixed(2)}</strong>
              </Box>
              <Box sx={{ mt: 2 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => handleAddPaymentMethod(inv.invoiceId, inv)}
                >
                  + Add Payment Method
                </Button>
              </Box>
              <form
                id={`vp-form-${inv.invoiceId}`}
                style={{ display: showAddUI[inv.invoiceId] ? "block" : "none" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = clientRefs.current[inv.invoiceId];
                  if (!c) {
                    console.error("Versapay client not ready");
                    return;
                  }
                  const p = c.submitEvents();
                  if (p && typeof p.then === "function") {
                    p.catch((err) => console.error("submitEvents error:", err));
                  }
                }}
              >
                <div
                  id={`vp-container-${inv.invoiceId}`}
                  style={{
                    height: "358px",
                    width: "100%",
                    maxWidth: "500px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "8px",
                    background: "#fafafa",
                  }}
                ></div>

                <div style={{ marginTop: 8 }}>
                  <button
                    id={`vp-save-${inv.invoiceId}`}
                    disabled
                    type="submit" // 👈 submit the form
                    onClick={() => {
                      // also trigger programmatically in case the SDK ignores submit type
                      const c = clientRefs.current[inv.invoiceId];
                      c?.submitEvents();
                    }}
                    style={{
                      height: "36px",
                      padding: "0 14px",
                      backgroundColor: "#1976d2",
                      color: "#fff",
                      fontSize: "14px",
                      borderRadius: "6px",
                      border: 0,
                      cursor: "pointer",
                    }}
                  >
                    Save Payment Method
                  </button>
                </div>
              </form>

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
                        <th className="p-2 border text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.payments.map((p) => (
                        <tr key={p.paymentId}>
                          <td className="p-2 border">{p.paymentDate}</td>
                          <td className="p-2 border">{p.tranId}</td>
                          <td className="p-2 border">
                            ${Number(p.amount).toFixed(2)}
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
};

export default InvoiceGrid;
