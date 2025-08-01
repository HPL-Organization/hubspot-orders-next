"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CircularProgress, Box } from "@mui/material";

const InvoiceGrid = dynamic(() => import("../../../components/InvoiceGrid"), {
  ssr: false,
});

const PaymentTab = ({ netsuiteInternalId }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!netsuiteInternalId) return;

    const fetchInvoices = async () => {
      try {
        const res = await fetch(
          `/api/netsuite/invoices?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();
        console.log(" Related Invoices:", data.invoices);
        setInvoices(data.invoices || []);
      } catch (err) {
        console.error(" Failed to fetch related invoices:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchInvoices();
  }, [netsuiteInternalId]);

  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={2}>
        <CircularProgress size={24} />
        <span className="text-gray-600">Loading invoices...</span>
      </Box>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-black">Invoices</h1>
      {invoices.length > 0 ? (
        <InvoiceGrid invoices={invoices} productCatalog={[]} />
      ) : (
        <div>No invoices related to this sales order.</div>
      )}
    </div>
  );
};

export default PaymentTab;
