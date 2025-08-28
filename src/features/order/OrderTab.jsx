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
  Backdrop,
  LinearProgress,
} from "@mui/material";
import ListboxComponent from "../../../components/ListBoxComponent";
import { Checkbox, FormControlLabel } from "@mui/material";
import { useRep } from "../../../components/RepContext";
import { confirmToast } from "../../../components/Toast/ConfirmToast";

const OrderTab = ({
  netsuiteInternalId,
  repOptions,
  setNetsuiteTranId,
  setNetsuiteInternalId,
  hasAnyFulfillment,
  onRepChange,
  onHubspotStageClosedWonComplete,
}) => {
  //make sure internal id loaded-
  if (netsuiteInternalId === undefined) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Box display="flex" alignItems="center" gap={2}>
          <CircularProgress size={24} />
          <span className="text-gray-600">Loading NetSuite data...</span>
        </Box>
      </div>
    );
  }

  const editsLocked = hasAnyFulfillment === true;

  // Sales Channel
  const [salesChannels, setSalesChannels] = useState([]); // [{ id, value, label }]
  const [salesChannelLoading, setSalesChannelLoading] = useState(true);
  const [selectedSalesChannel, setSelectedSalesChannel] = useState(null);
  const [initialSalesChannelFromDeal, setInitialSalesChannelFromDeal] =
    useState(null);

  // Affiliates
  const [affiliates, setAffiliates] = useState([]); // [{ id, label, entityId?, altName?, inactive? }]
  const [affiliateLoading, setAffiliateLoading] = useState(false);
  const [selectedAffiliate, setSelectedAffiliate] = useState(null);
  const [initialAffiliateFromDeal, setInitialAffiliateFromDeal] =
    useState(null);
  const NO_AFFIL = { id: "__NONE__", label: "No affiliate", altName: null };
  const [affiliateInitDone, setAffiliateInitDone] = useState(false);
  const affiliateOptions = useMemo(
    () => [NO_AFFIL, ...affiliates],
    [affiliates]
  );
  const isNoAffiliate = (opt) => opt?.id === "__NONE__";

  //sales team
  const [salesTeam, setSalesTeam] = useState([
    { id: "-5", isPrimary: true, contribution: 100 },
  ]);

  // SO date
  const [salesOrderDate, setSalesOrderDate] = useState("");

  //deal name
  const [dealName, setDealName] = useState(null);

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
  const [loaderIdx, setLoaderIdx] = useState(0);

  const [useMultiSalesTeam, setUseMultiSalesTeam] = useState(false);

  const { repEmail } = useRep();
  const defaultSalesRepId =
    repOptions.find((r) => r.email === repEmail)?.id || "-5"; // fallback

  const CLOSED_COMPLETE_STAGE = "34773430";

  const memoizedProductCatalog = useMemo(
    () => productCatalog,
    [productCatalog]
  );

  const LOADING_FOOTER = { __footer: true };

  console.log("fulfilment status from props", hasAnyFulfillment);

  const LOADER_TEXT = [
    "Started creating NetSuite order…",
    "Pushing line items…",
    "Applying discounts…",
    "Syncing Sales team",
    "Adding affliates",
    "Finishing up…",
  ];

  const triggerOwnerUpdateFromPrimary = React.useCallback(() => {
    if (!useMultiSalesTeam) return;

    const primary = salesTeam.find((m) => m.isPrimary && m.id);
    if (!primary) return;

    const rep = repOptions.find((r) => String(r.id) === String(primary.id));
    if (!rep?.email) return;

    if (rep.email === repEmail) return;

    onRepChange?.(rep.email);
  }, [useMultiSalesTeam, salesTeam, repOptions, repEmail, onRepChange]);

  //loading text useffect
  useEffect(() => {
    if (!creatingOrder) {
      setLoaderIdx(0);
      return;
    }
    const last = LOADER_TEXT.length - 1;
    const id = setInterval(() => {
      setLoaderIdx((prev) => {
        if (prev >= last) {
          clearInterval(id);
          return last;
        }
        return prev + 1;
      });
    }, 2500);
    return () => clearInterval(id);
  }, [creatingOrder]);

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
          search: normalize(`${p.sku} ${p.name ?? ""} ${p.description ?? ""}`),
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
          search: normalize(`${p.sku} ${p.name ?? ""} ${p.description ?? ""}`),
        }));

        console.log(` Background sync received ${mapped.length} products`);
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

        const itemsArray = Array.isArray(data) ? data : data?.items;
        console.log(itemsArray);
        if (!Array.isArray(itemsArray)) {
          console.error("Unexpected response:", data);
          return;
        }

        // Populate rows for DataGrid
        setRows(
          itemsArray.map((item) => {
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
        const mapped = itemsArray.map((item) => ({
          id: item.id,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitDiscount: item.unitDiscount ?? 0,
          productName: item.productName,
        }));
        setSelectedGridProducts(mapped);

        if (!Array.isArray(data)) {
          setInitialSalesChannelFromDeal({
            id: data?.salesChannelId ?? null,
            value: data?.salesChannel ?? null,
          });
        }
        setDealName(data?.dealName ?? null);
        console.log("Deal name", dealName);
        if (data?.affiliateId || data?.affiliateName) {
          setInitialAffiliateFromDeal({
            id: data?.affiliateId ? String(data.affiliateId) : null,
            name: data?.affiliateName ?? null,
          });
        }
        if (
          data?.salesOrderDate &&
          /^\d{4}-\d{2}-\d{2}$/.test(data.salesOrderDate)
        ) {
          setSalesOrderDate(data.salesOrderDate);
        }
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

  //sales channels useeffects
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setSalesChannelLoading(true);
        const res = await fetch("/api/netsuite/sales-channel");
        const data = await res.json();
        if (!aborted && Array.isArray(data)) {
          setSalesChannels(
            data.map((d) => ({
              id: String(d.id ?? d.value),
              value: String(d.value ?? ""),
              label: d.label ?? d.value ?? "",
            }))
          );
          console.log("Sales channel dets", salesChannels);
        }
      } catch (e) {
        console.error("Failed to load sales channels:", e);
      } finally {
        if (!aborted) setSalesChannelLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  //sales channel useeffect
  useEffect(() => {
    if (
      !selectedSalesChannel &&
      initialSalesChannelFromDeal &&
      salesChannels.length
    ) {
      const wantedId = initialSalesChannelFromDeal.id
        ? String(initialSalesChannelFromDeal.id)
        : null;
      const wantedVal = initialSalesChannelFromDeal.value || null;

      const match =
        (wantedId && salesChannels.find((o) => String(o.id) === wantedId)) ||
        (wantedVal && salesChannels.find((o) => o.value === wantedVal)) ||
        null;

      if (match) {
        setSelectedSalesChannel(match);
      } else if (wantedVal) {
        setSelectedSalesChannel({
          id: wantedId ?? wantedVal,
          value: wantedVal,
          label: wantedVal,
        });
      }
    }
  }, [salesChannels, initialSalesChannelFromDeal, selectedSalesChannel]);

  //affiliate sales channel
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setAffiliateLoading(true);
        const res = await fetch("/api/netsuite/get-affiliates");
        const data = await res.json();
        if (!aborted) {
          const opts = (data?.affiliates ?? []).map((a) => ({
            id: String(a.id),
            label:
              a.label || a.altName || a.companyName || a.entityId || `#${a.id}`,
            entityId: a.entityId ?? null,
            altName: a.altName ?? null,
            inactive: !!a.inactive,
          }));
          setAffiliates(opts);
        }
      } catch (e) {
        console.error("Failed to load affiliates:", e);
      } finally {
        if (!aborted) setAffiliateLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  //affiliate initial load
  useEffect(() => {
    if (affiliateInitDone) return;
    if (!affiliates.length) return;

    if (!initialAffiliateFromDeal?.id && !initialAffiliateFromDeal?.name) {
      setSelectedAffiliate(NO_AFFIL);
      setAffiliateInitDone(true);
      return;
    }

    const wantedId = initialAffiliateFromDeal.id
      ? String(initialAffiliateFromDeal.id)
      : null;
    const wantedName = initialAffiliateFromDeal.name || null;

    const match = wantedId ? affiliates.find((a) => a.id === wantedId) : null;

    if (match) {
      setSelectedAffiliate(match);
      setAffiliateInitDone(true);
      return;
    }

    const fallback = {
      id: wantedId ?? (wantedName || "unknown"),
      label: wantedName ?? (wantedId ? `Partner #${wantedId}` : "Affiliate"),
      altName: wantedName ?? null,
      inactive: true,
    };

    setAffiliates((prev) =>
      wantedId && prev.some((a) => a.id === wantedId)
        ? prev
        : [fallback, ...prev]
    );
    setSelectedAffiliate(fallback);
    setAffiliateInitDone(true);
  }, [affiliates, initialAffiliateFromDeal, affiliateInitDone]);

  //  search helpers
  const normalize = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const tokenize = (q) => normalize(q).split(" ").filter(Boolean);

  const scoreOption = (indexStr, tokens, rawQuery) => {
    if (!tokens.length) return 0;
    const words = indexStr.split(" ");
    let score = 0;
    for (const t of tokens) {
      if (words.includes(t)) {
        score += 6;
        continue;
      }

      if (words.some((w) => w.startsWith(t))) {
        score += 3;
        continue;
      }

      const idx = indexStr.indexOf(t);
      if (idx !== -1) {
        score += 1 + Math.max(0, 10 - Math.floor(idx / 5)) * 0.1;
        continue;
      }

      return -Infinity;
    }

    const normQ = normalize(rawQuery);
    if (normQ && indexStr.includes(normQ)) score += 4;
    return score;
  };

  const handleSaveClick = async () => {
    try {
      const res = await fetch("/api/deal-line-items", {
        method: "POST",
        body: JSON.stringify({
          dealId,
          salesChannel: selectedSalesChannel ?? null,
          salesOrderDate: salesOrderDate || null,
          affiliate:
            selectedAffiliate && !isNoAffiliate(selectedAffiliate)
              ? {
                  id: String(selectedAffiliate.id),
                  name: selectedAffiliate.altName,
                }
              : null,

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
      triggerOwnerUpdateFromPrimary();

      toast.success("Line items saved successfully in Hubspot Deal!");
    } catch (err) {
      console.error(" Save Trigger Failed:", err);
      toast.error("Failed to save line items.");
    }
  };
  const uniqueProducts = useMemo(() => {
    const seen = new Set();
    return productCatalog.filter((product) => {
      if (seen.has(product.id)) {
        return false; // Skip duplicate products based on SKU
      }
      seen.add(product.id);
      return true;
    });
  }, [productCatalog]);

  //quantity available for each product
  const availabilityById = useMemo(() => {
    const m = new Map();
    productCatalog.forEach((p) =>
      m.set(String(p.id), Number(p.available ?? 0))
    );

    return m;
  }, [productCatalog]);

  const availabilityBySku = useMemo(() => {
    const m = new Map();

    productCatalog.forEach((p) =>
      m.set(String(p.sku), Number(p.available ?? 0))
    );
    return m;
  }, [productCatalog]);

  const rowsWithAvailability = useMemo(() => {
    if (!rows?.length) return rows;

    return rows.map((r) => {
      const idKey = r.ns_item_id ?? r.nsItemId ?? r.productId ?? r.id;
      const byId = availabilityById.get(String(idKey));
      const bySku = availabilityBySku.get(String(r.sku));
      const avail = byId ?? bySku ?? 0;

      return { ...r, quantityAvailable: avail };
    });
  }, [rows, availabilityById, availabilityBySku]);

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
      field: "quantityAvailable",
      headerName: "Available",
      flex: 1,
      editable: false,
      sortable: false,
      renderCell: (params) => {
        const qty = Number(params.row?.quantity) || 0;
        const avail = Number(params.value) || 0;
        return (
          <span style={{ color: qty > avail ? "crimson" : "inherit" }}>
            {avail}
          </span>
        );
      },
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

  const handleProcessRowUpdate = (newRow, oldRow) => {
    if (editsLocked) return oldRow ?? newRow;
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
  console.log(selectedSalesChannel);

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
            options={uniqueProducts}
            value={selectedProducts}
            onChange={(e, newValue) => setSelectedProducts(newValue)}
            // getOptionLabel={(option) => `${option.sku} - ${option.name}`}
            getOptionLabel={(option) => `${option.sku} - ${option.name}`}
            loading={!allProductsFetched}
            loadingText="Still loading more products..."
            noOptionsText={
              !allProductsFetched
                ? "Searching all products..."
                : "No matching products"
            }
            filterOptions={(options, { inputValue }) => {
              const tokens = tokenize(inputValue);
              if (!tokens.length) return options.slice(0, 100);
              const ranked = [];
              for (const opt of options) {
                const idxStr =
                  opt.search ?? normalize(`${opt.sku} ${opt.name}`);
                const s = scoreOption(idxStr, tokens, inputValue);
                if (s !== -Infinity) ranked.push([s, opt]);
              }
              ranked.sort((a, b) => b[0] - a[0]);
              return ranked.slice(0, 100).map(([, opt]) => opt);
            }}
            isOptionEqualToValue={(opt, val) => opt.sku === val.sku}
            slotProps={{
              listbox: {
                component: ListboxComponent,
                showFooter: !allProductsFetched,
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
          rows={rowsWithAvailability}
          columns={columns}
          getRowId={(row) => row.id}
          disableRowSelectionOnClick
          processRowUpdate={handleProcessRowUpdate}
          pageSize={100}
          rowsPerPageOptions={[100]}
          isCellEditable={() => !editsLocked}
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
          label="Add Sales team members?"
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
      {/* Sales Channel UI */}
      <Box sx={{ mt: 3, mb: 2, maxWidth: 400 }}>
        <Autocomplete
          options={salesChannels}
          loading={salesChannelLoading}
          value={selectedSalesChannel}
          onChange={(e, newVal) => setSelectedSalesChannel(newVal ?? null)}
          getOptionLabel={(opt) => opt.label || opt.value || ""}
          isOptionEqualToValue={(opt, val) => opt.id === val?.id}
          noOptionsText={
            salesChannelLoading ? "Loading channels..." : "No channels found"
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Sales Channel"
              placeholder="Select sales channel"
            />
          )}
        />
      </Box>

      {/* Affiliate UI */}
      <Box sx={{ mt: 3, mb: 2, maxWidth: 400 }}>
        <Autocomplete
          options={affiliateOptions}
          loading={affiliateLoading}
          value={selectedAffiliate}
          onChange={(e, newVal) => {
            setAffiliateInitDone(true);

            setSelectedAffiliate(
              !newVal || isNoAffiliate(newVal) ? NO_AFFIL : newVal
            );
          }}
          getOptionLabel={(opt) => opt?.label || ""}
          isOptionEqualToValue={(opt, val) => opt.id === val?.id}
          noOptionsText={
            affiliateLoading ? "Loading affiliates..." : "No affiliates found"
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Affiliate"
              placeholder="Select affiliate"
              helperText="Optional"
            />
          )}
        />
      </Box>
      {/* Sales Order Date */}
      <Box sx={{ mt: 3, mb: 2, maxWidth: 260 }}>
        <TextField
          label="Sales Order Date"
          type="date"
          value={salesOrderDate}
          onChange={(e) => setSalesOrderDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          helperText="Optional"
          size="small"
          fullWidth
        />
      </Box>
      {/* Save Buttons */}
      <div className=" flex gap-1">
        <Button
          onClick={handleSaveClick}
          className="bg-[#FF7A59]! hover:bg-[#e76445]!"
        >
          Save to Hubspot
        </Button>
        <Button
          disabled={creatingOrder}
          onClick={async () => {
            if (!contactId || !dealId) {
              toast.error("Missing contact or deal ID.");
              return;
            }
            if (netsuiteInternalId === undefined) {
              toast.error(
                "Please wait until NetSuite data has finished loading."
              );
              return;
            }
            if (netsuiteInternalId === null) {
              const confirmCreate = await confirmToast(
                "Please make sure you saved the customer in netsuite!"
              );
              if (!confirmCreate) return;
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
            console.log("here");
            handleSaveClick();
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
                comment: row.comment || "",
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
                salesChannel: selectedSalesChannel?.id ?? null,
                affiliateId:
                  selectedAffiliate && !isNoAffiliate(selectedAffiliate)
                    ? selectedAffiliate.id
                    : null,
                salesOrderDate: salesOrderDate || null,
                dealName: dealName,
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
              if (data?.id) {
                console.log(data.id);
                setNetsuiteInternalId(data.id);
              }

              if (data?.netsuiteTranId) {
                console.log(data.netsuiteTranId);
                setNetsuiteTranId(data.netsuiteTranId);
              }
              try {
                await fetch("/api/hubspot/set-deal-stage", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    dealId,
                    stage: CLOSED_COMPLETE_STAGE,
                  }),
                });
                console.log(
                  "onhubspot",
                  onHubspotStageClosedWonComplete ? "present" : "not present"
                );
                onHubspotStageClosedWonComplete?.();
                toast.success(
                  "Deal moved to 'Closed won - Complete' in HubSpot."
                );
              } catch (e) {
                console.error("Failed to update HubSpot dealstage", e);
              }
            } catch (err) {
              console.error(" Sales Order creation failed:", err);
              toast.error(" Failed to submit Sales Order.");
            } finally {
              setCreatingOrder(false); //  done
            }
          }}
        >
          {creatingOrder ? "Submitting..." : "Mark Closed, send to Netsuite "}
        </Button>
      </div>
      <Backdrop
        open={creatingOrder}
        sx={{
          color: "#fff",
          zIndex: (theme) => theme.zIndex.modal + 1,
          flexDirection: "column",
          gap: 2,
        }}
      >
        <CircularProgress />

        <div className="text-white text-lg font-medium">
          {LOADER_TEXT[loaderIdx]}
        </div>
        <Box sx={{ width: 320 }}>
          <LinearProgress />
        </Box>
      </Backdrop>
    </div>
  );
};

export default OrderTab;
