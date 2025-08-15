"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CircularProgress, Box } from "@mui/material";
import AddPaymentMethod from "../../../components/versapay/AddPaymentMethod";
import PaymentMethods from "../../../components/versapay/PaymentMethods";

const InvoiceGrid = dynamic(() => import("../../../components/InvoiceGrid"), {
  ssr: false,
});

const PaymentTab = ({ netsuiteInternalId }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pmRefreshKey, setPmRefreshKey] = useState(0);
  const uniqueInvoicesMap = new Map();
  invoices.forEach((inv) => {
    if (!uniqueInvoicesMap.has(inv.invoiceId)) {
      uniqueInvoicesMap.set(inv.invoiceId, inv);
    }
  });
  const uniqueInvoices = Array.from(uniqueInvoicesMap.values());

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

  const customerId = invoices?.[0]?.customerId ?? null;

  if (netsuiteInternalId === undefined) {
    return (
      <Box display="flex" alignItems="center" gap={2}>
        <CircularProgress size={24} />
        <span className="text-gray-600">Loading NetSuite data...</span>
      </Box>
    );
  }

  if (netsuiteInternalId === null) {
    return (
      <Box display="flex" alignItems="center" gap={2}>
        <span className="text-gray-600">
          No associated NetSuite Sales Order.
        </span>
      </Box>
    );
  }

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
      {/*  existing saved payment methods (masked) */}
      {customerId && (
        <PaymentMethods
          customerId={customerId}
          refreshKey={pmRefreshKey}
          invoices={uniqueInvoices}
        />
      )}

      {/** Add payment method */}
      <AddPaymentMethod
        customerId={customerId}
        invoices={uniqueInvoices}
        onSaved={() => {
          console.log("Payment method saved.");
          setPmRefreshKey((k) => k + 1);
        }}
        onError={(e) => {
          console.error("Versapay add method error:", e);
        }}
      />

      <h1 className="text-2xl font-bold mb-4 text-black">Invoices</h1>
      {invoices.length > 0 ? (
        <InvoiceGrid
          invoices={invoices}
          netsuiteInternalId={netsuiteInternalId}
          productCatalog={[]}
        />
      ) : (
        <div>No invoices related to this sales order.</div>
      )}
    </div>
  );
};

export default PaymentTab;
