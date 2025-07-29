"use client";
import React, { useState, useEffect } from "react";
import InputField from "../../../components/inputField";
import Button from "../../../components/Button";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify"; //  import toast

import GoogleMapsLoader from "../../../components/GoogleMapsLoader";
import AddressAutocomplete from "../../../components/AddressAutocomplete";
import { LoadScript } from "@react-google-maps/api";

const InfoTab = () => {
  const searchParams = useSearchParams();
  const dealId = searchParams.get("dealId");

  const [contactId, setContactId] = useState(null);
  const [prevBilling, setPrevBilling] = useState(null);
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
    sameAsShipping: false,
  });

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
        }));
      } catch (err) {
        toast.error("Failed to fetch contact.");
        console.error("Failed to fetch contact", err);
      }
    };

    fetchContact();
  }, [dealId]);

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

  const handleSameAsShipping = () => {
    setFormData((prev) => {
      const isEnabling = !prev.sameAsShipping;

      return {
        ...prev,
        sameAsShipping: isEnabling,
        billing: isEnabling
          ? (setPrevBilling(prev.billing), { ...prev.shipping }) //  Backup billing, apply shipping
          : prevBilling || prev.billing, //  Restore if backup exists
      };
    });
  };

  const handleSave = async () => {
    if (!contactId) {
      toast.error("Contact ID not available.");
      return;
    }

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
      // Step 1 - Update contact in HubSpot
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

      //  Step 2 - Send to NetSuite
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
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-black">Info</h1>
      <div className="flex justify-end">
        <Button onClick={handleSave}>Save</Button>
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
        <label className="block text-gray-700 mb-1">
          <span className=" text-blue-500 font-bold">Google</span> Address
          Lookup
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
      <h2 className="text-lg font-semibold mb-2 text-black">
        Shipping Address
      </h2>
      <div className="grid grid-cols-2 gap-4 mb-6 text-black">
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

      <div className="mb-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.sameAsShipping}
            onChange={handleSameAsShipping}
          />
          <span className="text-gray-700">Billing same as Shipping</span>
        </label>
      </div>
      {!formData.sameAsShipping && (
        <div className="mb-6">
          <label className="block text-gray-700 mb-1">
            <span className=" text-blue-500 font-bold">Google</span> Billing
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
      )}

      {!formData.sameAsShipping && (
        <>
          <h2 className="text-lg font-semibold mb-2 text-black">
            Billing Address
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-6 text-black">
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
        </>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  );
};

const WrappedInfoTab = () => (
  <LoadScript
    googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
    libraries={["places"]}
  >
    <InfoTab />
  </LoadScript>
);

export default WrappedInfoTab;
