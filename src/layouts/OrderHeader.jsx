import React, { useEffect, useState } from "react";

const OrderHeader = ({ orderData, repOptions, onRepChange }) => {
  const [selectedRep, setSelectedRep] = useState("");

  useEffect(() => {
    setSelectedRep(orderData.rep || "");
  }, [orderData.rep]);

  const handleRepChange = (e) => {
    const value = e.target.value;
    setSelectedRep(value);
    onRepChange?.(value);
  };

  return (
    <div className="bg-gray-50 p-4 rounded-md mb-4 grid grid-cols-4 gap-x-12 gap-y-4">
      <div className="flex flex-col">
        <span className="text-gray-500 text-xs">Order #</span>
        <span className="text-gray-800 font-medium">
          {orderData.orderNumber || "—"}
        </span>
      </div>

      <div className="flex flex-col">
        <span className="text-gray-500 text-xs">Payment Status</span>
        <span className="text-gray-800 font-medium">
          {orderData.paymentStatus || "—"}
        </span>
      </div>

      <div className="flex flex-col">
        <span className="text-gray-500 text-xs">Fulfillment Status</span>
        <span className="text-gray-800 font-medium">
          {orderData.fulfillmentStatus || "—"}
        </span>
      </div>

      <div className="flex flex-col">
        <span className="text-gray-500 text-xs">Rep</span>
        <select
          value={selectedRep}
          onChange={handleRepChange}
          className="border border-gray-300 rounded px-2 py-1 mt-1 text-gray-800"
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
  );
};

export default OrderHeader;
