"use client";

import { useSearchParams } from "next/navigation";

import React, { Suspense, useEffect, useState } from "react";

import { toast } from "react-toastify";

import InfoTab from "../features/info/InfoTab";
import OrderTab from "../features/order/OrderTab";
import FulfillmentTab from "../features/fulfillment/FulfillmentTab";
import PaymentTab from "../features/payment/PaymentTab";
import MainTabs from "../layouts/MainTabs";
import OrderHeader from "../layouts/OrderHeader";

import { getSalesOrderNumberFromDeal } from "../../lib/HubSpot";
import { RepProvider, useRep } from "../../components/RepContext";
import GoogleMapsWrapper from "../../components/GoogleMapsWrapper";

function App() {
  const [repOptions, setRepOptions] = useState([]);
  const [selectedRepEmail, setSelectedRepEmail] = useState("");
  const [netsuiteTranId, setNetsuiteTranId] = useState(null);
  const [netsuiteInternalId, setNetsuiteInternalId] = useState(undefined);

  const searchParams = useSearchParams();
  const dealIdURL = searchParams.get("dealId");

  const { setRepEmail } = useRep();

  const [netsuiteStatus, setNetsuiteStatus] = useState("loading");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("loading");

  const orderData = {
    orderNumber: netsuiteTranId || "No associated sales order",
    paymentStatus: netsuiteStatus || "—",
    fulfillmentStatus: fulfillmentStatus || "Not Started",
    rep: selectedRepEmail, // use email for selection
  };
  useEffect(() => {
    const fetchRepsAndOwner = async () => {
      if (!dealIdURL) return;

      try {
        // 1. Fetch reps from NetSuite
        const repsRes = await fetch("/api/netsuite/employees");
        const reps = await repsRes.json();
        setRepOptions(reps);

        // 2. Fetch current HubSpot deal owner
        const ownerRes = await fetch(`/api/set-deal-owner?dealId=${dealIdURL}`);
        const { ownerEmail } = await ownerRes.json();

        // 3. Match email to one of the reps
        if (ownerEmail && reps.some((r) => r.email === ownerEmail)) {
          setSelectedRepEmail(ownerEmail);
        } else if (reps.length > 0) {
          setSelectedRepEmail(reps[0].email); // fallback to first rep
        }
      } catch (e) {
        console.error(" Failed to fetch reps or owner:", e);
        toast.error("Failed to load rep data.", {
          position: "bottom-center",
          autoClose: 3000,
        });
      }
    };

    fetchRepsAndOwner();
  }, [dealIdURL]);

  //sales order useffect-
  useEffect(() => {
    const fetchSalesOrderInfo = async () => {
      if (!dealIdURL) return;

      try {
        // Fetch tranid
        const tranidRes = await fetch(`/api/tranid?dealId=${dealIdURL}`);
        const { tranid } = await tranidRes.json();
        console.log(" Loaded tranId from API route:", tranid);
        setNetsuiteTranId(tranid);

        // Fetch internal ID
        const intIdRes = await fetch(`/api/so-int-id?dealId=${dealIdURL}`);
        const { internalId } = await intIdRes.json();
        console.log(" Loaded internal NetSuite ID from API route:", internalId);
        await setNetsuiteInternalId(internalId ?? null);
      } catch (err) {
        console.error(" Failed to fetch sales order info:", err.message);
      }
    };

    fetchSalesOrderInfo();
  }, [dealIdURL]);

  //useffect for rep
  useEffect(() => {
    setRepEmail(selectedRepEmail); // sync when it changes
  }, [selectedRepEmail]);

  const handleRepChange = async (newRepEmail) => {
    setSelectedRepEmail(newRepEmail);
    console.log("Rep changed to:", newRepEmail);

    try {
      const dealId = dealIdURL;
      const res = await fetch("/api/set-deal-owner", {
        method: "POST",
        body: JSON.stringify({ email: newRepEmail, dealId }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Unknown error");
      }

      toast.success(" Rep assigned successfully in HubSpot!", {
        position: "top-center",
        autoClose: 2500,
      });
    } catch (err) {
      toast.error("Failed to assign rep. Please try again.", {
        position: "top-center",
        autoClose: 2500,
      });
      console.error("Error setting deal owner:", err.message);
    }
  };

  //calculate payment status
  useEffect(() => {
    if (!netsuiteInternalId) return;

    const fetchInvoiceStatus = async () => {
      try {
        const res = await fetch(
          `/api/netsuite/invoices?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();

        const invoices = data.invoices || [];
        console.log("Invoice status getter ", data);

        if (invoices.length === 0) {
          setNetsuiteStatus("Not Paid");
          return;
        }

        const allPaid = invoices.every(
          (inv) => Number(inv.amountRemaining) === 0
        );
        const anyPaid = invoices.some((inv) => Number(inv.amountPaid) > 0);
        const anyUnpaid = invoices.some(
          (inv) => Number(inv.amountRemaining) > 0
        );

        if (allPaid) {
          setNetsuiteStatus("Paid");
        } else if (anyPaid && anyUnpaid) {
          setNetsuiteStatus("Partially Paid");
        } else {
          setNetsuiteStatus("Not Paid");
        }
      } catch (err) {
        console.error("Failed to compute invoice payment status:", err);
      }
    };

    fetchInvoiceStatus();
  }, [netsuiteInternalId]);

  //fulfillment status useffect
  useEffect(() => {
    if (!netsuiteInternalId) return;

    const computeFulfillmentStatus = async () => {
      try {
        const res = await fetch(
          `/api/netsuite/fulfillment-status-line-items?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();
        const ordered = data.orderedLineIds || [];
        const fulfilled = new Set(data.fulfilledLineIds || []);

        if (ordered.length === 0) {
          setFulfillmentStatus("Not Fulfilled");
          return;
        }

        const fulfilledCount = ordered.filter((id) => fulfilled.has(id)).length;

        if (fulfilledCount === 0) {
          setFulfillmentStatus("Not Fulfilled");
        } else if (fulfilledCount < ordered.length) {
          setFulfillmentStatus("Partially Fulfilled");
        } else {
          setFulfillmentStatus("Fulfilled");
        }
      } catch (err) {
        console.error("Error computing fulfillment status:", err);
      }
    };

    computeFulfillmentStatus();
  }, [netsuiteInternalId]);

  const dealStatus = "closedWon";
  console.log("**", netsuiteInternalId);
  const tabs = [
    { key: "info", label: "Info", component: <InfoTab /> },
    {
      key: "order",
      label: dealStatus === "closedWon" ? "Order" : "Quote",
      component: (
        <OrderTab
          netsuiteInternalId={netsuiteInternalId}
          repOptions={repOptions}
          setNetsuiteTranId={setNetsuiteTranId}
          setNetsuiteInternalId={setNetsuiteInternalId}
        />
      ),
    },
    ...(dealStatus === "closedWon"
      ? [
          {
            key: "payment",
            label: "Payment",
            component: <PaymentTab netsuiteInternalId={netsuiteInternalId} />,
          },
          {
            key: "fulfillment",
            label: "Fulfillment",
            component: (
              <FulfillmentTab netsuiteInternalId={netsuiteInternalId} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <OrderHeader
        orderData={orderData}
        repOptions={repOptions}
        onRepChange={handleRepChange}
      />
      <MainTabs tabs={tabs} />
    </div>
  );
}

export default function Page() {
  return (
    <GoogleMapsWrapper>
      <RepProvider>
        <Suspense fallback={<div className=" text-black">Loading...</div>}>
          <App />
        </Suspense>
      </RepProvider>
    </GoogleMapsWrapper>
  );
}
