"use client";
import React, { useRef, useEffect, useState } from "react";

const AddressAutocomplete = ({ onAddressSelect }) => {
  const inputRef = useRef(null);
  const [parsed, setParsed] = useState(null);

  useEffect(() => {
    if (!window.google || !window.google.maps) return;

    const autocomplete = new window.google.maps.places.Autocomplete(
      inputRef.current,
      {
        types: ["address"],
        //componentRestrictions: { country: "us" },
      }
    );

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place.address_components) return;

      const result = {
        address1: "",
        city: "",
        state: "",
        zip: "",
        country: "",
      };

      for (const comp of place.address_components) {
        const types = comp.types;
        if (types.includes("street_number")) result.address1 = comp.long_name;
        if (types.includes("route")) result.address1 += " " + comp.long_name;
        if (types.includes("locality")) result.city = comp.long_name;
        if (types.includes("administrative_area_level_1"))
          result.state = comp.short_name;
        if (types.includes("postal_code")) result.zip = comp.long_name;
        if (types.includes("country")) result.country = comp.long_name;
      }

      setParsed(result); // Store temporarily, wait for Apply
    });
  }, []);

  const handleApply = () => {
    if (parsed) {
      onAddressSelect(parsed);
      setParsed(null); // Clear after applying
      if (inputRef.current) inputRef.current.value = ""; // Optional: reset input
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        placeholder="Start typing address..."
        className="w-full border border-gray-300 rounded px-2 py-1 text-black"
      />
      {parsed && (
        <button
          onClick={handleApply}
          className="bg-blue-500 text-white px-3 py-1 rounded"
        >
          Apply
        </button>
      )}
    </div>
  );
};

export default AddressAutocomplete;
