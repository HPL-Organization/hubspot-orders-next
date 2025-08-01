"use client";
import React, { useState, useEffect, useMemo } from "react";
import { DataGrid } from "@mui/x-data-grid";
import Button from "../../../components/button";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";
import {
  Autocomplete,
  TextField,
  Chip,
  Avatar,
  Button as MuiButton,
  Box,
  CircularProgress,
  MenuItem,
} from "@mui/material";
import ListboxComponent from "../../../components/ListBoxComponent";
import { Checkbox, FormControlLabel } from "@mui/material";
import { useRep } from "../../../components/RepContext";

const OrderTab = ({ netsuiteInternalId, repOptions }) => {
  //make sure we have netsuite sales order internal id loaded-
  if (!netsuiteInternalId) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Box display="flex" alignItems="center" gap={2}>
          <CircularProgress size={24} />
          <span className="text-gray-600">Loading NetSuite data...</span>
        </Box>
      </div>
    );
  }

  //sales team
  const [salesTeam, setSalesTeam] = useState([
    { id: "-5", isPrimary: true, contribution: 100 },
  ]);

  const [rows, setRows] = useState([]);
  const [selectedGridProducts, setSelectedGridProducts] = useState([]);
  const searchParams = useSearchParams();
  const dealId = searchParams.get("dealId");

  const [backgroundOffset, setBackgroundOffset] = useState(1000);
  const [allProductsFetched, setAllProductsFetched] = useState(false);
  const [productCatalog, setProductCatalog] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [loadingAllProducts, setLoadingAllProducts] = useState(true);
  const [shipComplete, setShipComplete] = useState(false);
  const [deletedRows, setDeletedRows] = useState([]);

  const [contactId, setContactId] = useState(null);

  const [fulfilledItemIds, setFulfilledItemIds] = useState([]);

  const [creatingOrder, setCreatingOrder] = useState(false);

  const [useMultiSalesTeam, setUseMultiSalesTeam] = useState(false);

  const { repEmail } = useRep();
  const defaultSalesRepId =
    repOptions.find((r) => r.email === repEmail)?.id || "-5"; // fallback

  const memoizedProductCatalog = useMemo(
    () => productCatalog,
    [productCatalog]
  );

  useEffect(() => {
    if (!dealId) return;

    const fetchContactId = async () => {
      try {
        const res = await fetch(`/api/contact?dealId=${dealId}`);
        const data = await res.json();
        if (data?.id) {
          setContactId(data.id);
          console.log(" Contact ID fetched:", data.id);
        } else {
          console.warn("No contact ID found in response");
        }
      } catch (err) {
        console.error(" Failed to fetch contact ID:", err);
      }
    };

    fetchContactId();
  }, [dealId]);

  useEffect(() => {
    const fetchAllProducts = async () => {
      try {
        const res = await fetch("/api/netsuite/products?maxPages=1");
        const data = await res.json();

        const mapped = data.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name || "Unnamed Product",
          available: p.available ?? 0,
          imageUrl: p.imageUrl || "https://via.placeholder.com/40",
          unitPrice: p.price ?? 0,
        }));

        setProductCatalog(mapped);
      } catch (err) {
        console.error("Failed to load products:", err);
      } finally {
        setLoadingAllProducts(false);
      }
    };

    fetchAllProducts();
  }, []);
  //change-
  useEffect(() => {
    let cancelled = false;

    const fetchRemainingInBackground = async () => {
      try {
        const res = await fetch(`/api/netsuite/products?maxPages=Infinity`);
        const data = await res.json();

        const mapped = data.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name || "Unnamed Product",
          available: p.available ?? 0,
          imageUrl: p.imageUrl || "https://via.placeholder.com/40",
          unitPrice: p.price ?? 0,
        }));

        console.log(`✅ Background sync received ${mapped.length} products`);
        if (!cancelled) {
          setProductCatalog((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const newUniqueItems = mapped.filter((p) => !existingIds.has(p.id));
            const finalCatalog = [...prev, ...newUniqueItems];

            console.log(
              " Deduplicated merge complete. Final count:",
              finalCatalog.length
            );
            return finalCatalog;
          });
          console.log(
            " All products loaded. Final count:",
            finalCatalog.length
          );

          setAllProductsFetched(true);
        }
      } catch (err) {
        console.error(" Background fetch failed:", err);
      }
    };

    if (
      !loadingAllProducts &&
      productCatalog.length > 0 &&
      !allProductsFetched
    ) {
      fetchRemainingInBackground();
    }

    return () => {
      cancelled = true;
    };
  }, [loadingAllProducts]);

  useEffect(() => {
    if (!dealId) return;

    const fetchExistingLineItems = async () => {
      try {
        const res = await fetch(`/api/deal-line-items?dealId=${dealId}`);
        const data = await res.json();

        if (!Array.isArray(data)) {
          console.error("Unexpected response:", data);
          return;
        }

        // Populate rows for DataGrid
        setRows(
          data.map((item) => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unitPrice) || 0;
            const discount = Number(item.unitDiscount) || 0;
            const discountedPrice = price * (1 - discount / 100);
            const total = qty * discountedPrice;

            return {
              ...item,
              ns_item_id: item.ns_item_id || item.id,
              lineItemId: item.lineItemId ?? item.id, // Ensure it's preserved
              total,
              fulfilled: fulfilledItemIds.includes(item.ns_item_id || item.id),
            };
          })
        );

        // Also set selectedGridProducts for saving/editing
        const mapped = data.map((item) => ({
          id: item.id,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitDiscount: item.unitDiscount ?? 0,
          productName: item.productName,
        }));
        setSelectedGridProducts(mapped);
      } catch (err) {
        console.error("Failed to fetch existing line items:", err);
      }
    };

    fetchExistingLineItems();
  }, [dealId, fulfilledItemIds]);

  //useffect for fetching fulfilled items
  useEffect(() => {
    const fetchFulfilledItems = async () => {
      if (!dealId) return;

      try {
        console.log("***", netsuiteInternalId);
        const res = await fetch(
          `/api/netsuite/fulfilled-items?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();
        console.log("fulfilled line items", data);
        setFulfilledItemIds(data.fulfilledItemIds || []);
      } catch (err) {
        console.error(" Failed to load fulfilled item IDs", err);
      }
    };

    fetchFulfilledItems();
  }, [dealId]);

  //useeffect for fetching sales team from netsuite

  useEffect(() => {
    if (!netsuiteInternalId) return;

    const fetchSalesTeam = async () => {
      try {
        const res = await fetch(
          `/api/netsuite/getSalesTeam?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();
        if (data?.team) {
          const mapped = data.team.map((m) => ({
            id: m.id,
            contribution: m.contribution,
            isPrimary: m.isPrimary,
          }));
          setSalesTeam(mapped);
        }
      } catch (err) {
        console.error("Failed to fetch sales team from NetSuite:", err);
      }
    };

    fetchSalesTeam();
  }, [netsuiteInternalId]);

  const handleSaveClick = async () => {
    try {
      const res = await fetch("/api/deal-line-items", {
        method: "POST",
        body: JSON.stringify({
          dealId,
          selectedProducts: rows
            .filter(
              (row) => !fulfilledItemIds.includes(row.ns_item_id || row.id)
            )
            .map((row) => ({
              id: row.ns_item_id || row.id,
              lineItemId: row.lineItemId ?? null,
              quantity: row.quantity,
              unitPrice: row.unitPrice,
              unitDiscount: row.unitDiscount,
            })),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      console.log(" Save Trigger Response:", data.message);
      console.log(" Match Results:", data.results);

      const resultMap = new Map();
      data.results.forEach((result) => {
        if (result.lineItemId) {
          resultMap.set(result.ns_item_id, result.lineItemId);
        }
      });

      setRows((prev) =>
        prev.map((row) => {
          const newId = resultMap.get(row.ns_item_id || row.id);
          if (newId) {
            return {
              ...row,
              id: newId,
              lineItemId: newId,
            };
          }
          return row;
        })
      );

      toast.success("Line items saved successfully in Hubspot Deal!");
    } catch (err) {
      console.error(" Save Trigger Failed:", err);
      toast.error("Failed to save line items.");
    }
  };

  const columns = [
    { field: "sku", headerName: "SKU", flex: 1, editable: true },
    { field: "productName", headerName: "Product", flex: 2, editable: true },
    { field: "comment", headerName: "Comment", flex: 2, editable: true },
    {
      field: "quantity",
      headerName: "Quantity",
      flex: 1,
      editable: true,
    },
    {
      field: "unitPrice",
      headerName: "Unit Price",
      flex: 1,
      editable: true,
      renderCell: (params) => {
        const val = params.value ?? 0;
        return `$${Number(val).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      },
    },
    {
      field: "unitDiscount",
      headerName: "Unit Discount (%)",
      flex: 1,
      editable: true,
      renderCell: (params) => {
        const val = params.value ?? 0;
        return `${Number(val).toFixed(0)}%`;
      },
    },

    {
      field: "total",
      headerName: "Total",
      flex: 1,
      editable: false,
      sortable: true,
      renderCell: (params) => {
        const val = params.value ?? 0;
        return `$${Number(val).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      },
    },
    {
      field: "actions",
      headerName: "",
      sortable: false,
      flex: 0.3,
      disableColumnMenu: true,
      renderCell: (params) => (
        <MuiButton
          onClick={() => handleDelete(params.id)}
          style={{
            minWidth: "24px",
            width: "24px",
            height: "24px",
            padding: 0,
            margin: 0,
            color: "red",
            fontWeight: "bold",
            fontSize: "14px",
            lineHeight: 1,
          }}
        >
          x
        </MuiButton>
      ),
    },
  ];

  const handleDelete = async (id) => {
    const matchedRow = rows.find(
      (row) => row.id === id || row.lineItemId === id
    );
    const itemIdToCheck = String(
      matchedRow?.ns_item_id || matchedRow?.id || id
    );
    console.log(" Matched row:", matchedRow);
    console.log(" Checking item ID:", itemIdToCheck);
    if (fulfilledItemIds.includes(itemIdToCheck)) {
      toast.error("Cannot delete a fulfilled line item.");
      return;
    }

    try {
      // 1. Find the row being deleted
      const deletedRow = rows.find(
        (row) => row.id === id || row.lineItemId === id
      );
      if (!deletedRow) return;

      // 2. Remove from UI (rows)
      setRows((prev) =>
        prev.filter((row) => row.id !== id && row.lineItemId !== id)
      );

      // 3. Add to deletedRows with isClosed: true
      if (deletedRow.lineItemId) {
        //skip frontend only temp rows (trying to delete non existent items)
        setDeletedRows((prev) => [
          ...prev,
          {
            ...deletedRow,
            isClosed: true,
            quantity: 0,
            unitPrice: 0,
            total: 0,
          },
        ]);
      }

      // 4. Remove from grid products
      setSelectedGridProducts((prev) => prev.filter((p) => p.id !== id));

      // Call backend to delete from HubSpot
      const res = await fetch(`/api/deal-line-items?lineItemId=${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errData = await res.json();
        console.error(" Failed to delete from HubSpot:", errData.error);
        console.error("Delete failed:", errData.error);
      } else {
        toast.success(
          <span style={{ color: "red", fontWeight: "bold" }}>
            Line item deleted.
          </span>
        );
        console.log(` Line item ${id} deleted from HubSpot`);
      }
    } catch (err) {
      console.error(" Delete request failed:", err);
    }
  };

  const handleProcessRowUpdate = (newRow) => {
    const qty = Number(newRow.quantity) || 0;
    const price = Number(newRow.unitPrice) || 0;
    const discount = Number(newRow.unitDiscount) || 0;
    const discountedPrice = price * (1 - discount / 100);
    const total = qty * discountedPrice;

    const updatedRow = {
      ...newRow,
      total,
      unitDiscount: discount,
    };

    const updatedRows = rows.map((row) =>
      row.id === newRow.id ? updatedRow : row
    );
    setRows(updatedRows);

    setSelectedGridProducts((prev) =>
      prev.map((p) =>
        p.id === newRow.id
          ? {
              ...p,
              quantity: qty,
              unitPrice: price,
              unitDiscount: discount,
            }
          : p
      )
    );

    return updatedRow;
  };

  const totalSum = rows.reduce((acc, row) => acc + (row.total || 0), 0);

  const handleAddSelectedProducts = () => {
    const newRows = selectedProducts.map((product) => {
      const discount = product.unitDiscount ?? 0;
      const discountedPrice = product.unitPrice * (1 - discount / 100);
      const total = discountedPrice * 1;

      const productRow = {
        rowId: Date.now() + Math.random(),
        id: product.id,
        ns_item_id: product.id,
        sku: product.sku,
        productName: product.name,
        comment: "",
        quantity: 1,
        unitPrice: product.unitPrice ?? 0,
        total,
        imageUrl: product.imageUrl,
      };

      setSelectedGridProducts((prev) => [
        ...prev,
        {
          id: product.id,
          sku: product.sku,
          quantity: 1,
          unitPrice: product.unitPrice ?? 0,
          productName: product.name,
        },
      ]);

      return productRow;
    });

    setRows((prev) => [...prev, ...newRows]);
    setSelectedProducts([]);
  };

  console.log(" Final productCatalog size:", productCatalog.length);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-black">Order</h1>

      <Box sx={{ mb: 2 }}>
        {loadingAllProducts ? (
          <Box sx={{ mt: 2 }}>
            <CircularProgress size={24} />
            <span className="ml-2 text-gray-600">Loading products...</span>
          </Box>
        ) : (
          <Autocomplete
            multiple
            options={productCatalog}
            value={selectedProducts}
            onChange={(e, newValue) => setSelectedProducts(newValue)}
            getOptionLabel={(option) => `${option.sku} - ${option.name}`}
            loading={!allProductsFetched}
            loadingText="Still loading more products..."
            noOptionsText={
              !allProductsFetched
                ? "Searching all products..."
                : "No matching products"
            }
            filterOptions={(options, { inputValue }) =>
              options
                .filter((opt) =>
                  `${opt.sku} ${opt.name}`
                    .toLowerCase()
                    .includes(inputValue.toLowerCase())
                )
                .slice(0, 100)
            }
            isOptionEqualToValue={(opt, val) => opt.sku === val.sku}
            slotProps={{
              listbox: {
                component: ListboxComponent,
              },
            }}
            renderOption={(props, option) => (
              <li {...props}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    width: "100%",
                  }}
                >
                  <Avatar
                    src={option.imageUrl}
                    alt={option.name}
                    sx={{ width: 30, height: 30 }}
                  />
                  <Box sx={{ flexGrow: 1 }}>
                    <div className="font-medium">{option.sku}</div>
                    <div className="text-gray-500 text-sm">{option.name}</div>
                  </Box>
                  <span className="text-gray-600 text-sm">
                    Avail: {option.available}
                  </span>
                </Box>
              </li>
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  avatar={<Avatar src={option.imageUrl} />}
                  label={`${option.sku} - ${option.name}`}
                  {...getTagProps({ index })}
                  key={option.sku}
                />
              ))
            }
            sx={{ width: 600 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search and Add Products"
                placeholder="Type SKU or product name"
              />
            )}
          />
        )}

        {selectedProducts.length > 0 && (
          <MuiButton
            sx={{ mt: 2 }}
            variant="contained"
            onClick={handleAddSelectedProducts}
          >
            Add Selected Products
          </MuiButton>
        )}
      </Box>

      <div style={{ height: 400, width: "100%" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          disableRowSelectionOnClick
          processRowUpdate={handleProcessRowUpdate}
          pageSize={100}
          rowsPerPageOptions={[100]}
        />
      </div>

      <div className="flex justify-end mt-4 text-xl font-semibold text-slate-700">
        Total: $
        {totalSum.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
      <div className="flex flex-col ">
        <FormControlLabel
          control={
            <Checkbox
              checked={shipComplete}
              onChange={(e) => setShipComplete(e.target.checked)}
              color="primary"
              className=" text-black"
            />
          }
          label="Ship Complete (send to NetSuite)"
          sx={{ color: "black" }}
        />
        {/* sales team UI */}
        <FormControlLabel
          control={
            <Checkbox
              checked={useMultiSalesTeam}
              onChange={(e) => setUseMultiSalesTeam(e.target.checked)}
            />
          }
          label="Add Sales team memnbers?"
          sx={{ color: "black", mt: 1 }}
        />
      </div>
      {useMultiSalesTeam && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-black mb-2">Sales Team</h2>
          {salesTeam.map((member, index) => (
            <div key={index} className="flex items-center gap-4 mb-2">
              <TextField
                select
                label="Sales Rep"
                value={member.id}
                onChange={(e) => {
                  const newTeam = [...salesTeam];
                  newTeam[index].id = e.target.value;
                  setSalesTeam(newTeam);
                }}
                size="small"
                sx={{ width: 200 }}
              >
                {repOptions.map((rep) => (
                  <MenuItem key={rep.id} value={rep.id}>
                    {rep.name}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="Contribution %"
                type="number"
                inputProps={{ min: 0, max: 100 }}
                value={member.contribution}
                onChange={(e) => {
                  const inputVal = Number(e.target.value);
                  const currentTotal = salesTeam.reduce(
                    (sum, m, i) =>
                      sum + (i === index ? 0 : Number(m.contribution)),
                    0
                  );

                  if (inputVal + currentTotal > 100) {
                    toast.error("Total contribution cannot exceed 100%");
                    return;
                  }

                  const newTeam = [...salesTeam];
                  newTeam[index].contribution = inputVal;
                  setSalesTeam(newTeam);
                }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={member.isPrimary}
                    onChange={() => {
                      setSalesTeam((prev) =>
                        prev.map((m, i) => ({
                          ...m,
                          isPrimary: i === index,
                        }))
                      );
                    }}
                  />
                }
                className=" text-black"
                label="Primary"
              />

              {salesTeam.length > 1 && (
                <MuiButton
                  size="small"
                  color="error"
                  onClick={() =>
                    setSalesTeam((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </MuiButton>
              )}
            </div>
          ))}

          <MuiButton
            size="small"
            variant="outlined"
            disabled={
              salesTeam.reduce((sum, m) => sum + Number(m.contribution), 0) >=
              100
            }
            onClick={() =>
              setSalesTeam((prev) => [
                ...prev,
                { id: "", contribution: 0, isPrimary: false },
              ])
            }
          >
            Add Member
          </MuiButton>

          <div className="text-sm text-gray-600 mt-2">
            Total Contribution:{" "}
            {salesTeam.reduce((sum, m) => sum + Number(m.contribution), 0)}%
          </div>
        </div>
      )}

      {/* Save Buttons */}
      <div className=" flex gap-1">
        <Button onClick={handleSaveClick}>Save to Hubspot</Button>
        <Button
          disabled={creatingOrder}
          onClick={async () => {
            if (!contactId || !dealId) {
              toast.error("Missing contact or deal ID.");
              return;
            }

            const totalContribution = salesTeam.reduce(
              (sum, member) => sum + Number(member.contribution),
              0
            );

            if (salesTeam.some((member) => !member.id)) {
              toast.error(
                "All Sales Team members must have a valid Sales Rep selected."
              );
              return;
            }

            if (totalContribution < 100) {
              toast.error("Total sales team contribution must be 100%");
              return;
            }

            setCreatingOrder(true); //  start loading state

            try {
              //working line items(CRUD complete)
              const visibleRows = rows.filter(
                (row) => !fulfilledItemIds.includes(row.ns_item_id || row.id)
              );

              const lineItems = [...visibleRows, ...deletedRows].map((row) => ({
                itemId: row.ns_item_id,
                quantity: Number(row.quantity) || 1,
                unitPrice: Number(row.unitPrice) || 0,
                unitDiscount: Number(row.unitDiscount) || 0,
                isClosed: row.isClosed === true,
              }));

              console.log("Line items to netsuite", lineItems);

              const formattedSalesTeam = useMultiSalesTeam
                ? salesTeam.map((member) => ({
                    employee: { id: member.id },
                    contribution: Number(member.contribution),
                    isPrimary: member.isPrimary,
                  }))
                : [
                    {
                      employee: { id: defaultSalesRepId },
                      contribution: 100,
                      isPrimary: true,
                    },
                  ];

              const payload = {
                hubspotSoId: dealId,
                hubspotContactId: contactId,
                lineItems,
                shipComplete,
                salesTeam: {
                  replaceAll: true,
                  items: formattedSalesTeam,
                },
                //unfulfilledLines,
                //fulfilledLinesToEdit,
              };

              console.log(" Final Sales Order Payload to NetSuite:", payload);

              const res = await fetch("/api/netsuite/salesorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              console.log("Response status: in CSO", res.status);
              let data;
              try {
                data = await res.json();
              } catch {
                data = null;
              }

              if (!res.ok) {
                throw new Error(data?.error || "Unknown error");
              }

              console.log(" Sales Order created:", data);
              toast.success(" Sales Order submitted to NetSuite.");
            } catch (err) {
              console.error(" Sales Order creation failed:", err);
              toast.error(" Failed to submit Sales Order.");
            } finally {
              setCreatingOrder(false); //  done
            }
          }}
        >
          {creatingOrder ? "Submitting..." : "Save to Netsuite "}
        </Button>
      </div>
    </div>
  );
};

export default OrderTab;
