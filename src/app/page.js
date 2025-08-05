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

  const orderData = {
    orderNumber: netsuiteTranId || "No associated sales order",
    paymentStatus: "Pending",
    fulfillmentStatus: "Not Started",
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
