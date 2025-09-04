"use client";
import React, { useEffect, useState } from "react";

const DEAL_STAGE_LABELS = {
  34773425: "Interested",
  194770530: "Customer Building",
  34773427: "Selection/Demo",
  34773429: "Proposal sent",
  117818008: "Closed Won - Ready to Process",
  34773430: "Closed won - Complete",
  96360511: "Closed won",
  34773431: "Closed lost",
  checkout_abandoned: "Checkout Abandoned",
  checkout_pending: "Checkout Pending",
};

const stageClass = (label) => {
  const map = {
    Interested: "bg-blue-50 text-blue-700 ring-blue-200",
    "Customer Building": "bg-teal-50 text-teal-700 ring-teal-200",
    "Selection/Demo": "bg-indigo-50 text-indigo-700 ring-indigo-200",
    "Proposal sent": "bg-amber-50 text-amber-700 ring-amber-200",
    "Closed Won - Ready to Process":
      "bg-green-50 text-green-700 ring-green-200",
    "Closed won - Complete": "bg-emerald-50 text-emerald-700 ring-emerald-200",
    "Closed won": "bg-lime-50 text-lime-700 ring-lime-200",
    "Closed lost": "bg-rose-50 text-rose-700 ring-rose-200",
    "Checkout Abandoned": "bg-yellow-50 text-yellow-700 ring-yellow-200",
    "Checkout Pending": "bg-gray-50 text-gray-700 ring-gray-200",
  };
  return map[label] || "bg-gray-50 text-gray-700 ring-gray-200";
};

const Stat = ({ label, value }) => (
  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
    <div className="text-[11px] uppercase tracking-wide text-gray-500">
      {label}
    </div>
    <div className="mt-0.5 text-sm font-medium text-gray-800">
      {value || "—"}
    </div>
  </div>
);

const OrderHeader = ({
  orderData,
  repOptions,
  onRepChange,
  dealStage,
  netsuiteInternalId,
}) => {
  const [selectedRep, setSelectedRep] = useState("");
  const [soUrl, setSoUrl] = useState(null);

  const dealStageLabel =
    dealStage != null
      ? DEAL_STAGE_LABELS[String(dealStage)] ?? String(dealStage)
      : "—";

  const showOrderLink =
    Boolean(soUrl) &&
    orderData?.orderNumber &&
    orderData.orderNumber !== "No associated sales order";

  useEffect(() => {
    setSelectedRep(orderData.rep || "");
  }, [orderData.rep]);

  const handleRepChange = (e) => {
    const value = e.target.value;
    setSelectedRep(value);
    onRepChange?.(value);
  };
  useEffect(() => {
    let ignore = false;
    async function run() {
      setSoUrl(null);
      if (!netsuiteInternalId) return;
      try {
        const res = await fetch(
          `/api/netsuite/so-url?id=${netsuiteInternalId}`
        );
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Failed to build SO URL");
        if (!ignore) setSoUrl(j.url);
      } catch (e) {
        console.error("SO URL fetch failed:", e);
      }
    }
    run();
    return () => {
      ignore = true;
    };
  }, [netsuiteInternalId]);

  return (
    <div className="bg-white border rounded-lg p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs text-gray-500">Order #</div>
            <div className="text-lg font-semibold tracking-wide">
              {showOrderLink ? (
                <a
                  href={soUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 hover:decoration-solid focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
                  title="Open Sales Order in NetSuite"
                >
                  {orderData.orderNumber}
                </a>
              ) : (
                <span className="text-gray-900">
                  {orderData.orderNumber || "—"}
                </span>
              )}
            </div>
          </div>

          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${stageClass(
              dealStageLabel
            )}`}
            title="Deal Stage"
          >
            {dealStageLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Rep</label>
          <select
            value={selectedRep}
            onChange={handleRepChange}
            className="border border-gray-300 rounded px-2 py-1 text-gray-800"
            aria-label="Select Rep"
          >
            <option value="">— Select Rep —</option>
            {repOptions.map((rep) => (
              <option key={rep.id} value={rep.email}>
                {rep.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Payment Status" value={orderData.paymentStatus} />
        <Stat label="Fulfillment Status" value={orderData.fulfillmentStatus} />
      </div>
    </div>
  );
};

export default OrderHeader;
