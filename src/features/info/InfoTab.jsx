"use client";
import React, { useState, useEffect } from "react";
import InputField from "../../../components/inputField";
import Button from "../../../components/button";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";

import GoogleMapsLoader from "../../../components/GoogleMapsLoader";
import AddressAutocomplete from "../../../components/AddressAutocomplete";

import { Backdrop, CircularProgress, LinearProgress, Box } from "@mui/material";

const InfoTab = ({ netsuiteInternalId }) => {
  const searchParams = useSearchParams();
  const dealId = searchParams.get("dealId");
  console.log("Ns id", netsuiteInternalId);

  const [contactId, setContactId] = useState(null);

  const [shippingMethodOptions, setShippingMethodOptions] = useState([]);

  const [formData, setFormData] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    phone: "",
    mobile: "",
    shipping: {
      address1: "",
      address2: "",
      city: "",
      state: "",
      zip: "",
      country: "",
    },
    billing: {
      address1: "",
      address2: "",
      city: "",
      state: "",
      zip: "",
      country: "",
    },

    requiredShippingMethod: "",
  });

  const LOADER_TEXT_DEFAULT = [
    "Saving details…",
    "Saving Shipping address",
    "Saving Billing Address",
    "Almost done…",
  ];
  // loader state
  const [saving, setSaving] = useState(false);
  const [loaderIdx, setLoaderIdx] = useState(0);
  const [loaderMsgs, setLoaderMsgs] = useState(LOADER_TEXT_DEFAULT);
  const timeoutRef = React.useRef(null);
  //  rotate loader text
  useEffect(() => {
    if (!saving) return;

    setLoaderIdx(0);

    const step = (i) => {
      if (i >= loaderMsgs.length - 1) return;

      timeoutRef.current = window.setTimeout(() => {
        setLoaderIdx(i + 1);
        step(i + 1);
      }, 1200);
    };

    step(0);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [saving, loaderMsgs]);

  useEffect(() => {
    if (!dealId) return;

    const fetchContact = async () => {
      try {
        const res = await fetch(`/api/contact?dealId=${dealId}`);
        const data = await res.json();
        if (!data.properties) return;

        setContactId(data.id);

        setFormData((prev) => ({
          ...prev,
          firstName: data.properties.firstname || "",
          middleName: data.properties.middle_name || "",
          lastName: data.properties.lastname || "",
          email: data.properties.email || "",
          phone: data.properties.phone || "",
          mobile: data.properties.mobilephone || "",
          shipping: {
            ...prev.shipping,
            address1: data.properties.shipping_address || "",
            address2: data.properties.shipping_address_line_2 || "",
            city: data.properties.shipping_city || "",
            state: data.properties.shipping_state_region || "",
            zip: data.properties.shipping_postalcode || "",
            country: data.properties.shipping_country_region || "",
          },
          billing: {
            ...prev.billing,
            address1: data.properties.address || "",
            address2: data.properties.address_line_2 || "",
            city: data.properties.city || "",
            state: data.properties.state || "",
            zip: data.properties.zip || "",
            country: data.properties.country || "",
          },
          requiredShippingMethod:
            data.properties.required_shipping_method || "",
        }));
      } catch (err) {
        toast.error("Failed to fetch contact.");
        console.error("Failed to fetch contact", err);
      }
    };

    fetchContact();
  }, [dealId]);

  useEffect(() => {
    const fetchShippingOptions = async () => {
      try {
        const res = await fetch("/api/shipping-method-options");
        const data = await res.json();
        if (data.options) {
          setShippingMethodOptions(data.options);
        }
      } catch (error) {
        console.error("Error fetching shipping method options", error);
        toast.error("Failed to fetch shipping method options.");
      }
    };

    fetchShippingOptions();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAddressChange = (type, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: value,
      },
    }));
  };

  // Save to HubSpot
  const handleSaveHubSpot = async () => {
    if (!contactId) {
      toast.error("Contact ID not available.");
      return;
    }
    setLoaderMsgs(["Saving to HubSpot…", "Updating contact…", "Finishing up…"]);
    setSaving(true);

    const updatePayload = {
      contactId,
      update: {
        firstname: formData.firstName,
        middle_name: formData.middleName,
        lastname: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        mobilephone: formData.mobile,
        shipping_address: formData.shipping.address1,
        shipping_address_line_2: formData.shipping.address2,
        shipping_city: formData.shipping.city,
        shipping_state_region: formData.shipping.state,
        shipping_postalcode: formData.shipping.zip,
        shipping_country_region: formData.shipping.country,
        address: formData.billing.address1,
        address_line_2: formData.billing.address2,
        city: formData.billing.city,
        state: formData.billing.state,
        zip: formData.billing.zip,
        country: formData.billing.country,
        required_shipping_method: formData.requiredShippingMethod,
      },
    };

    try {
      const res = await fetch("/api/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to update contact in HubSpot.");
        return;
      }

      toast.success("Contact saved in HubSpot");
    } catch (error) {
      console.error("HubSpot Save Error", error);
      toast.error("Something went wrong while saving to HubSpot.");
    } finally {
      setSaving(false);
    }
  };

  // Save to NetSuite
  const handleSaveNetSuite = async () => {
    if (!contactId) {
      toast.error("Contact ID not available.");
      return;
    }
    setLoaderMsgs([
      "Saving to NetSuite…",
      "Sending customer…",
      "Finishing up…",
    ]);
    setSaving(true);
    const netsuitePayload = {
      id: contactId,
      firstName: formData.firstName,
      middleName: formData.middleName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      mobile: formData.mobile,
      billingAddress1: formData.billing.address1,
      billingAddress2: formData.billing.address2,
      billingCity: formData.billing.city,
      billingState: formData.billing.state,
      billingZip: formData.billing.zip,
      billingCountry: formData.billing.country,
      shippingAddress1: formData.shipping.address1,
      shippingAddress2: formData.shipping.address2,
      shippingCity: formData.shipping.city,
      shippingState: formData.shipping.state,
      shippingZip: formData.shipping.zip,
      shippingCountry: formData.shipping.country,
      shippingcarrier: formData.requiredShippingMethod,
    };
    console.log("netsuite", netsuitePayload);

    try {
      const netsuiteRes = await fetch("/api/netsuite/createcustomer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(netsuitePayload),
      });

      if (!netsuiteRes.ok) {
        const err = await netsuiteRes.json();
        toast.error("NetSuite failed: " + err.error);
        return;
      }

      toast.success("Contact sent to NetSuite!");
    } catch (error) {
      console.error("NetSuite Save Error", error);
      toast.error("Something went wrong while saving to NetSuite.");
    } finally {
      setSaving(false);
    }
  };

  // Save both
  const handleSave = async () => {
    if (!contactId) {
      toast.error("Contact ID not available.");
      return;
    }
    setLoaderMsgs([
      "Saving to HubSpot…",
      "Syncing to NetSuite…",
      "Finishing up…",
    ]);
    setSaving(true);

    const updatePayload = {
      contactId,
      update: {
        firstname: formData.firstName,
        middle_name: formData.middleName,
        lastname: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        mobilephone: formData.mobile,
        shipping_address: formData.shipping.address1,
        shipping_address_line_2: formData.shipping.address2,
        shipping_city: formData.shipping.city,
        shipping_state_region: formData.shipping.state,
        shipping_postalcode: formData.shipping.zip,
        shipping_country_region: formData.shipping.country,
        address: formData.billing.address1,
        address_line_2: formData.billing.address2,
        city: formData.billing.city,
        state: formData.billing.state,
        zip: formData.billing.zip,
        country: formData.billing.country,
      },
    };

    try {
      const res = await fetch("/api/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to update contact.");
        return;
      }
      toast.success("Contact saved in Hubspot");

      const netsuitePayload = {
        id: contactId,
        firstName: formData.firstName,
        middleName: formData.middleName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        mobile: formData.mobile,
        billingAddress1: formData.billing.address1,
        billingAddress2: formData.billing.address2,
        billingCity: formData.billing.city,
        billingState: formData.billing.state,
        billingZip: formData.billing.zip,
        billingCountry: formData.billing.country,
        shippingAddress1: formData.shipping.address1,
        shippingAddress2: formData.shipping.address2,
        shippingCity: formData.shipping.city,
        shippingState: formData.shipping.state,
        shippingZip: formData.shipping.zip,
        shippingCountry: formData.shipping.country,
      };

      const netsuiteRes = await fetch("/api/netsuite/createcustomer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(netsuitePayload),
      });

      if (!netsuiteRes.ok) {
        const err = await netsuiteRes.json();
        toast.error("NetSuite failed: " + err.error);
        return;
      }

      toast.success("Contact saved and sent to NetSuite!");
    } catch (error) {
      console.error("Error saving contact or sending to NetSuite", error);
      toast.error("Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-black">Info</h1>

      <div className="flex justify-end mb-2">
        <Button
          onClick={handleSaveHubSpot}
          className="mr-1 px-3 py-1 text-sm bg-[#FF7A59]! hover:bg-[#e76445]!"
        >
          Save to HubSpot
        </Button>
        <Button onClick={handleSaveNetSuite} className="mr-4 px-3 py-1 text-sm">
          Save to NetSuite
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8 text-black">
        <InputField
          label="First Name"
          name="firstName"
          value={formData.firstName}
          onChange={handleChange}
        />
        <InputField
          label="Middle Name"
          name="middleName"
          value={formData.middleName}
          onChange={handleChange}
        />
        <InputField
          label="Last Name"
          name="lastName"
          value={formData.lastName}
          onChange={handleChange}
        />
        <InputField
          label="Email"
          name="email"
          value={formData.email}
          onChange={handleChange}
        />
        <InputField
          label="Phone"
          name="phone"
          value={formData.phone}
          onChange={handleChange}
        />
        <InputField
          label="Mobile"
          name="mobile"
          value={formData.mobile}
          onChange={handleChange}
        />
      </div>

      <div className="mb-6">
        <label className="text-lg font-semibold text-black">
          Required Shipping Method
        </label>
        <select
          name="requiredShippingMethod"
          value={formData.requiredShippingMethod}
          onChange={handleChange}
          className="block w-full mt-2 p-2 border border-gray-300 rounded-md text-black"
        >
          <option value="">Select a shipping method</option>
          {shippingMethodOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Shipping section (always visible, simple heading) */}
      <h2 className="text-lg font-semibold mb-2 text-black">
        Shipping Address
      </h2>
      <div className="mb-4">
        <label className="block text-gray-700 mb-1">
          <span className="text-blue-500 font-bold">Google</span> Shipping
          Address Lookup
        </label>
        <GoogleMapsLoader>
          <AddressAutocomplete
            onAddressSelect={(parsed) => {
              handleAddressChange("shipping", "address1", parsed.address1);
              handleAddressChange("shipping", "city", parsed.city);
              handleAddressChange("shipping", "state", parsed.state);
              handleAddressChange("shipping", "zip", parsed.zip);
              handleAddressChange("shipping", "country", parsed.country);
            }}
          />
        </GoogleMapsLoader>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8 text-black">
        {["address1", "city", "address2", "state", "zip", "country"].map(
          (field) => (
            <InputField
              key={field}
              label={field.charAt(0).toUpperCase() + field.slice(1)}
              value={formData.shipping[field]}
              onChange={(e) =>
                handleAddressChange("shipping", field, e.target.value)
              }
            />
          )
        )}
      </div>

      {/* Billing section (only shown if not same as shipping), simple heading */}

      <h2 className="text-lg font-semibold mb-2 text-black">Billing Address</h2>
      <div className="mb-4">
        <label className="block text-gray-700 mb-1">
          <span className="text-blue-500 font-bold">Google</span> Billing
          Address Lookup
        </label>
        <GoogleMapsLoader>
          <AddressAutocomplete
            onAddressSelect={(parsed) => {
              handleAddressChange("billing", "address1", parsed.address1);
              handleAddressChange("billing", "city", parsed.city);
              handleAddressChange("billing", "state", parsed.state);
              handleAddressChange("billing", "zip", parsed.zip);
              handleAddressChange("billing", "country", parsed.country);
            }}
          />
        </GoogleMapsLoader>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8 text-black">
        {["address1", "city", "address2", "state", "zip", "country"].map(
          (field) => (
            <InputField
              key={field}
              label={field.charAt(0).toUpperCase() + field.slice(1)}
              value={formData.billing[field]}
              onChange={(e) =>
                handleAddressChange("billing", field, e.target.value)
              }
            />
          )
        )}
      </div>

      <div className="flex justify-end mb-2">
        <Button
          onClick={handleSaveHubSpot}
          className="mr-1 px-3 py-1 text-sm bg-[#FF7A59]! hover:bg-[#e76445]!"
        >
          Save to HubSpot
        </Button>
        <Button onClick={handleSaveNetSuite} className="mr-4 px-3 py-1 text-sm">
          Save to NetSuite
        </Button>
      </div>
      {/* loader overlay */}
      <Backdrop
        open={saving}
        sx={{
          color: "#fff",
          zIndex: (theme) => theme.zIndex.modal + 1,
          flexDirection: "column",
          gap: 2,
        }}
      >
        <CircularProgress />
        <div className="text-white text-lg font-medium">
          {loaderMsgs[loaderIdx] ?? "Working…"}
        </div>
        <Box sx={{ width: 320 }}>
          <LinearProgress />
        </Box>
      </Backdrop>
    </div>
  );
};

export default InfoTab;
