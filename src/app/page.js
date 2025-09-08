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
  const [hasAnyFulfillment, setHasAnyFulfillment] = useState(null);
  const [contactId, setContactId] = useState(null);
  const [customerId, setCustomerId] = useState(null);
  const [customerName, setCustomerName] = useState(null);
  const [isTaxable, setIsTaxable] = useState(null);

  const [statusRefreshTick, setStatusRefreshTick] = useState(0);
  const bumpStatusRefresh = React.useCallback(() => {
    setNetsuiteStatus("loading");
    setStatusRefreshTick((t) => t + 1);
  }, []);

  //deal stage states
  const [dealStage, setDealStage] = useState();
  const [dealStageOverride, setDealStageOverride] = useState(null);
  const effectiveDealStage = dealStageOverride ?? dealStage;
  const CLOSED_WON_COMPLETE_ID = 34773430;

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
        const { ownerEmail, dealStage } = await ownerRes.json();
        console.log("Deal Stage", dealStage);
        setDealStage(dealStage);

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
        if (tranid) {
          await fetch("/api/hubspot/prepend-tranid", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dealId: dealIdURL, tranid }),
          });
        }
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

    const fetchStatus = async () => {
      try {
        const [invRes, depRes] = await Promise.all([
          fetch(`/api/netsuite/invoices?internalId=${netsuiteInternalId}`),
          fetch(`/api/netsuite/get-deposits?internalId=${netsuiteInternalId}`),
        ]);

        const invData = await invRes.json();
        const depData = await depRes.json();

        const invoices = invData?.invoices ?? [];
        const deposits = depData?.items ?? [];

        const sum = (arr, key) =>
          arr.reduce((s, x) => s + (Number(x?.[key]) || 0), 0);

        const totalInvoiced = sum(invoices, "total");
        const amountPaid = sum(invoices, "amountPaid");
        const amountRemaining = sum(invoices, "amountRemaining");
        const depositTotal = sum(deposits, "amount");

        if (invoices.length === 0) {
          setNetsuiteStatus(depositTotal > 0 ? "Deposit Received" : "Not Paid");
          return;
        }

        if (amountRemaining <= 1e-6) {
          setNetsuiteStatus("Paid");
        } else if (amountPaid > 0) {
          setNetsuiteStatus("Partially Paid");
        } else if (depositTotal > 0) {
          setNetsuiteStatus("Partially Paid (Deposit)");
        } else {
          setNetsuiteStatus("Not Paid");
        }

        console.log("NS status breakdown", {
          totalInvoiced,
          amountPaid,
          amountRemaining,
          depositTotal,
        });
      } catch (err) {
        console.error("Failed to compute invoice payment status:", err);
      }
    };

    fetchStatus();
  }, [netsuiteInternalId, statusRefreshTick]);

  //fulfillment status useffect
  useEffect(() => {
    if (!netsuiteInternalId) {
      setHasAnyFulfillment(null);
      return;
    }

    const computeFulfillmentStatus = async () => {
      try {
        const res = await fetch(
          `/api/netsuite/fulfillment-status-line-items?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();
        const ordered = data.orderedLineIds || [];
        const fulfilled = new Set(data.fulfilledLineIds || []);

        setHasAnyFulfillment(fulfilled.size > 0);
        console.log("Full to order", hasAnyFulfillment);
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

  //contactid useffect

  useEffect(() => {
    if (!dealIdURL) return;
    let aborted = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/hubspot/get-contact?dealId=${dealIdURL}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (aborted) return;

        if (!res.ok) {
          console.error(
            "Failed to fetch contactId:",
            data?.error || res.statusText
          );
          setContactId(null);
          return;
        }

        setContactId(data?.contactId ?? null);
        console.log("Loaded contactId:", data?.contactId ?? null);
      } catch (err) {
        if (!aborted) {
          console.error("Error fetching contactId:", err);
          setContactId(null);
        }
      }
    })();

    return () => {
      aborted = true;
    };
  }, [dealIdURL]);

  //customer details from netsuite fetch
  useEffect(() => {
    if (!contactId) {
      setCustomerId(null);
      setCustomerName(null);
      setIsTaxable(null);
      return;
    }
    let aborted = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/netsuite/get-customer?contactId=${contactId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (aborted) return;

        if (!res.ok) {
          console.error(
            "Failed to fetch customer:",
            data?.error || res.statusText
          );
          setCustomerId(null);
          setCustomerName(null);
          setIsTaxable(null);
          return;
        }

        setCustomerId(data?.internalId ?? null);
        setCustomerName(data?.name ?? null);

        const flag = data?.bodyFields?.taxable ?? null;
        setIsTaxable(flag === "T" ? true : flag === "F" ? false : null);

        console.log("Customer loaded:", {
          id: data?.internalId,
          name: data?.name,
          taxable: flag,
        });
      } catch (err) {
        if (!aborted) {
          console.error("Error fetching customer:", err);
          setCustomerId(null);
          setCustomerName(null);
          setIsTaxable(null);
        }
      }
    })();

    return () => {
      aborted = true;
    };
  }, [contactId]);

  const dealStatus = "closedWon";
  console.log("**", netsuiteInternalId);
  const hasSalesOrder = !!netsuiteInternalId;
  const tabs = [
    {
      key: "info",
      label: "Info",
      component: <InfoTab netsuiteInternalId={netsuiteInternalId} />,
    },
    {
      key: "order",
      label: dealStatus === "closedWon" ? "Order" : "Quote",
      component: (
        <OrderTab
          netsuiteInternalId={netsuiteInternalId}
          repOptions={repOptions}
          setNetsuiteTranId={setNetsuiteTranId}
          setNetsuiteInternalId={setNetsuiteInternalId}
          hasAnyFulfillment={hasAnyFulfillment}
          onRepChange={handleRepChange}
          onHubspotStageClosedWonComplete={() =>
            setDealStageOverride(CLOSED_WON_COMPLETE_ID)
          }
          isTaxable={isTaxable}
        />
      ),
    },
    ...(dealStatus === "closedWon"
      ? [
          {
            key: "payment",
            label: "Payment",
            disabled: !hasSalesOrder,
            disabledReason: "Create a NetSuite Sales Order to enable payments.",
            component: (
              <PaymentTab
                netsuiteInternalId={netsuiteInternalId}
                onRefreshStatuses={bumpStatusRefresh}
              />
            ),
          },
          {
            key: "fulfillment",
            label: "Fulfillment",
            disabled: !hasSalesOrder,
            disabledReason:
              "Create a NetSuite Sales Order to enable fulfillment.",
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
        dealStage={effectiveDealStage}
        netsuiteInternalId={netsuiteInternalId}
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
