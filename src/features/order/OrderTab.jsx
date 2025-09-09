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
import { Paper, Stack } from "@mui/material";
import { Collapse, Divider, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ListboxComponent from "../../../components/ListBoxComponent";
import { Checkbox, FormControlLabel } from "@mui/material";
import { useRep } from "../../../components/RepContext";
import { confirmToast } from "../../../components/Toast/ConfirmToast";
import Tooltip from "@mui/material/Tooltip";
import FallbacksIndicator from "../../../components/FallBackIndicator";

const mkRowId = () =>
  `tmp_${Math.random().toString(36).slice(2)}_${Date.now()}`;

const OrderTab = ({
  netsuiteInternalId,
  repOptions,
  setNetsuiteTranId,
  setNetsuiteInternalId,
  hasAnyFulfillment,
  onRepChange,
  onHubspotStageClosedWonComplete,
  isTaxable,
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

  //order notes
  const [orderNotes, setOrderNotes] = useState("");

  //billing terms
  const BILLING_TERMS = [
    { id: "2", label: "Net 30" },
    { id: "7", label: "Paid before shipped" },
  ];
  const [billingTermsId, setBillingTermsId] = useState("7");

  const [rows, setRows] = useState([]);
  const [selectedGridProducts, setSelectedGridProducts] = useState([]);
  const searchParams = useSearchParams();
  const dealId = searchParams.get("dealId");

  //overall discount
  const [overallDiscountPct, setOverallDiscountPct] = useState(null);

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

  //so reference
  const [soReference, setSoReference] = useState("");

  const { repEmail } = useRep();
  const defaultSalesRepId =
    repOptions.find((r) => r.email === repEmail)?.id || "-5"; // fallback

  const CLOSED_COMPLETE_STAGE = "34773430";

  const memoizedProductCatalog = useMemo(
    () => productCatalog,
    [productCatalog]
  );

  // Row identity: saved rows → HubSpot lineItemId; temp rows → local rowId; fallback → product id.
  const rowKey = (r) => r?.lineItemId ?? r?.rowId ?? r?.id;

  //tax
  const TAX_RATE_PCT = isTaxable ? 6.25 : 0;
  const TAX_RATE = TAX_RATE_PCT / 100;

  const LOADING_FOOTER = { __footer: true };

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
  }, [loadingAllProducts, productCatalog.length, allProductsFetched]);

  useEffect(() => {
    if (!dealId) return;

    const fetchExistingLineItems = async () => {
      try {
        const res = await fetch(`/api/deal-line-items?dealId=${dealId}`);
        const data = await res.json();

        const itemsArray = Array.isArray(data) ? data : data?.items;
        if (!Array.isArray(itemsArray)) {
          console.error("Unexpected response:", data);
          return;
        }

        // Populate rows for DataGrid (saved rows keyed by HubSpot lineItemId)
        setRows(
          itemsArray.map((item) => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unitPrice) || 0;
            const discount = Number(item.unitDiscount) || 0;
            const discountedPrice = price * (1 - discount / 100);
            const total = qty * discountedPrice;
            console.log("tax", total * TAX_RATE);
            return {
              ...item,
              ns_item_id: item.ns_item_id || item.id,
              // hubspot line item id (what the grid uses as primary id for saved rows)
              lineItemId: item.lineItemId ?? item.id,
              // id used by the grid; use lineItemId when present, else product id
              id: item.lineItemId ? String(item.lineItemId) : String(item.id),
              total,
              estimatedTax: total * TAX_RATE,
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
        if (typeof data?.orderNotes === "string") {
          setOrderNotes(data.orderNotes);
        }
        if (data?.billingTermsId) {
          setBillingTermsId(String(data.billingTermsId));
        } else if (data?.billingTerms?.id) {
          setBillingTermsId(String(data.billingTerms.id));
        }
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
        const res = await fetch(
          `/api/netsuite/fulfilled-items?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();
        setFulfilledItemIds(data.fulfilledItemIds || []);
      } catch (err) {
        console.error(" Failed to load fulfilled item IDs", err);
      }
    };

    fetchFulfilledItems();
  }, [dealId, netsuiteInternalId]);

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

  //overall discount
  useEffect(() => {
    if (overallDiscountPct === null) return;
    const d = Math.max(0, Math.min(100, Number(overallDiscountPct) || 0));

    setRows((prev) =>
      prev.map((row) => {
        const qty = Number(row.quantity) || 0;
        const price = Number(row.unitPrice) || 0;
        const total = qty * price * (1 - d / 100);
        return {
          ...row,
          unitDiscount: d,
          total,
          estimatedTax: total * TAX_RATE,
        };
      })
    );
  }, [overallDiscountPct]);

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

  const todayInEasternYYYYMMDD = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  const handleSaveClick = async () => {
    const isYMD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());

    const effectiveSoDate = isYMD(salesOrderDate)
      ? salesOrderDate
      : salesOrderDate
      ? ""
      : todayInEasternYYYYMMDD();
    console.log("salesOrderDate", salesOrderDate);
    try {
      const res = await fetch("/api/deal-line-items", {
        method: "POST",
        body: JSON.stringify({
          dealId,
          salesChannel: selectedSalesChannel ?? null,
          salesOrderDate: effectiveSoDate || null,
          orderNotes,
          billingTermsId: billingTermsId || null,
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
              id: row.ns_item_id || row.id, // product id
              lineItemId: row.lineItemId ?? null, // preexisting hubspot id (if any)
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
      console.log(" Save Trigger Response:", data?.message);
      console.log(" Match Results:", data?.results);

      // === Duplicate-aware merge ===
      // Group new HubSpot line item ids by product id (ns_item_id)
      const groups = new Map(); // key: productId, val: array of new lineItemIds
      (data?.results ?? []).forEach((r) => {
        const prodKey = String(r?.ns_item_id ?? r?.id ?? "");
        const li = r?.lineItemId ? String(r.lineItemId) : null;
        if (!prodKey || !li) return;
        if (!groups.has(prodKey)) groups.set(prodKey, []);
        groups.get(prodKey).push(li);
      });

      setRows((prev) => {
        //  assign lineItemIds only to rows that don't have one yet.
        const next = prev.map((row) => ({ ...row }));
        for (const row of next) {
          if (!row.lineItemId) {
            const prodKey = String(row.ns_item_id ?? row.id);
            const pool = groups.get(prodKey);
            if (pool?.length) {
              const li = pool.shift(); // consume exactly one per duplicate
              row.id = li; // DataGrid primary id for saved rows
              row.lineItemId = li; // HubSpot line item id
            }
          }
        }
        return next;
      });

      triggerOwnerUpdateFromPrimary();
      toast.success("Line items saved successfully in HubSpot Deal!");
    } catch (err) {
      console.error(" Save Trigger Failed:", err);
      toast.error("Failed to save line items.");
    }
  };

  const uniqueProducts = useMemo(() => {
    const seen = new Set();
    return productCatalog.filter((product) => {
      if (seen.has(product.id)) return false;
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
      const total = Number(r.total ?? 0);
      const estimatedTax = total * TAX_RATE;
      return { ...r, quantityAvailable: avail, estimatedTax };
    });
  }, [rows, availabilityById, availabilityBySku]);

  //ns id fallback from product catalog(by SKU)
  const skuToNsId = useMemo(() => {
    const m = new Map();
    for (const p of productCatalog) {
      const key = (p?.sku ?? "").toString().trim().toUpperCase();
      if (!key) continue;
      const val = String(p.id);
      if (m.has(key) && m.get(key) !== val) {
        console.warn(`SKU collision for ${key}: ${m.get(key)} -> ${val}`);
      }
      m.set(key, val);
    }
    return m;
  }, [productCatalog]);

  const resolveNsItemId = React.useCallback(
    (row) => {
      const skuKey = (row?.sku ?? "").toString().trim().toUpperCase();
      const bySku = skuKey ? skuToNsId.get(skuKey) : null;
      if (bySku) return bySku; // avoids stale ns ids

      const explicit = row?.ns_item_id ?? row?.nsItemId ?? null;
      if (explicit) return String(explicit);

      toast.error("Missing NetSuite item id and unknown SKU for row:", row);
      return "";
    },
    [skuToNsId]
  );

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

  const handleDelete = async (gridId) => {
    const matchedRow = rows.find((r) => rowKey(r) === gridId);
    if (!matchedRow) return;

    const itemIdToCheck = String(
      matchedRow.ns_item_id || matchedRow.id || gridId
    );
    if (fulfilledItemIds.includes(itemIdToCheck)) {
      toast.error("Cannot delete a fulfilled line item.");
      return;
    }

    // remove from UI
    setRows((prev) => prev.filter((r) => rowKey(r) !== gridId));

    if (matchedRow.lineItemId) {
      setDeletedRows((prev) => [
        ...prev,
        {
          ...matchedRow,
          isClosed: true,
          quantity: 0,
          unitPrice: 0,
          total: 0,
          estimatedTax: 0,
        },
      ]);
    }

    try {
      const res = await fetch(
        `/api/deal-line-items?lineItemId=${matchedRow.lineItemId ?? gridId}`,
        {
          method: "DELETE",
        }
      );
      if (!res.ok) {
        const errData = await res.json();
        console.error(" Failed to delete from HubSpot:", errData.error);
      } else {
        toast.success(
          <span style={{ color: "red", fontWeight: "bold" }}>
            Line item deleted.
          </span>
        );
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

    const targetKey = rowKey(newRow);

    const updatedRow = {
      ...newRow,
      total,
      unitDiscount: discount,
      estimatedTax: total * TAX_RATE,
    };

    setRows((prev) =>
      prev.map((r) => (rowKey(r) === targetKey ? updatedRow : r))
    );

    setSelectedGridProducts((prev) =>
      prev.map((p) =>
        p.id === (newRow.ns_item_id || newRow.id)
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

  //tax+grandtotal

  const fmtMoney = (n) =>
    `$${Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const estimatedOrderTax = useMemo(() => totalSum * TAX_RATE, [totalSum]);
  const grandTotal = useMemo(
    () => totalSum + estimatedOrderTax,
    [totalSum, estimatedOrderTax]
  );

  const handleAddSelectedProducts = () => {
    const newRows = selectedProducts.map((product) => {
      const discount = product.unitDiscount ?? 0;
      const discountedPrice = product.unitPrice * (1 - discount / 100);
      const total = discountedPrice * 1;

      const productRow = {
        rowId: mkRowId(),
        id: product.id,
        ns_item_id: product.id,
        sku: product.sku,
        productName: product.name,
        comment: "",
        quantity: 1,
        unitPrice: product.unitPrice ?? 0,
        unitDiscount: discount,
        total,
        estimatedTax: total * TAX_RATE,
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

  //ns id, tran id fallback helper
  const lookupSoByDealId = async (dealId) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxTries = 2;
    let delay = 1000;
    for (let i = 0; i < maxTries; i++) {
      try {
        const r = await fetch(
          `/api/netsuite/lookup-salesorder?dealId=${encodeURIComponent(dealId)}`
        );
        if (r.ok) {
          const j = await r.json();
          if (j?.id && (j?.tranid || j?.netsuiteTranId)) {
            return {
              id: String(j.id),
              tranid: String(j.tranid || j.netsuiteTranId),
            };
          }
        }
      } catch (e) {
        console.debug("lookup retry", i + 1, e);
      }
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.5), 4000);
    }
    return null;
  };
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-black">Order</h1>

      {/* Product search + Add button (inline) */}
      <Box
        sx={{
          mb: 2,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr auto" },
          gap: 1.5,
          alignItems: "center",
        }}
      >
        {loadingAllProducts ? (
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <CircularProgress size={24} />
            <span className="ml-2 text-gray-600">Loading products...</span>
          </Box>
        ) : (
          <Autocomplete
            multiple
            options={uniqueProducts}
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
            sx={{ width: "100%" }} // was 600; now fluid
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search and Add Products"
                placeholder="Type SKU or product name"
              />
            )}
          />
        )}

        <MuiButton
          sx={{
            height: 40,
            whiteSpace: "nowrap",
            visibility: selectedProducts.length ? "visible" : "hidden",
          }}
          variant="contained"
          onClick={handleAddSelectedProducts}
        >
          Add Selected
        </MuiButton>
      </Box>

      {/* Grid */}
      <Box sx={{ height: { xs: 360, md: 520 }, width: "100%" }}>
        <DataGrid
          rows={rowsWithAvailability}
          columns={columns}
          getRowId={rowKey}
          disableRowSelectionOnClick
          processRowUpdate={handleProcessRowUpdate}
          pageSize={100}
          rowsPerPageOptions={[100]}
          isCellEditable={() => !editsLocked}
        />
      </Box>

      {/* Totals + quick toggles (single row) */}
      <Box
        sx={{
          mt: 2,
          mb: 1,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 360px" },
          gap: 1.5,
          alignItems: "start",
        }}
      >
        {/* LEFT COLUMN */}
        <Box>
          {/* Toggles only */}
          <Stack
            spacing={1.25}
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            flexWrap="wrap"
            useFlexGap
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={shipComplete}
                  onChange={(e) => setShipComplete(e.target.checked)}
                  color="primary"
                  className="text-black"
                />
              }
              label="Ship Complete"
              sx={{ color: "black", m: 0 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={useMultiSalesTeam}
                  onChange={(e) => setUseMultiSalesTeam(e.target.checked)}
                />
              }
              label="Add Sales team members?"
              sx={{ color: "black", m: 0 }}
            />
          </Stack>

          {/* 🔽 Sales Team appears right under the checkbox */}
          <Collapse in={useMultiSalesTeam} timeout={200} unmountOnExit>
            <Box sx={{ mt: 1.5 }}>
              <Typography
                variant="h6"
                sx={{
                  fontSize: 16,
                  fontWeight: 700,
                  mb: 1,
                  color: "text.primary",
                }}
              >
                Sales Team
              </Typography>

              {salesTeam.map((member, index) => (
                <Box
                  key={index}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      sm: "220px 160px auto auto",
                    },
                    gap: 1.5,
                    mb: 1.5,
                    alignItems: "center",
                  }}
                >
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
                    SelectProps={{
                      MenuProps: {
                        // keep the menu positioned correctly in this column
                        disablePortal: false,
                        container: () =>
                          typeof window !== "undefined"
                            ? document.body
                            : undefined,
                        PaperProps: {
                          sx: { zIndex: (theme) => theme.zIndex.modal + 2 },
                        },
                      },
                    }}
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
                    size="small"
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
                    sx={{ m: 0 }}
                  />

                  {salesTeam.length > 1 && (
                    <MuiButton
                      size="small"
                      color="error"
                      onClick={() =>
                        setSalesTeam((prev) =>
                          prev.filter((_, i) => i !== index)
                        )
                      }
                    >
                      Remove
                    </MuiButton>
                  )}
                </Box>
              ))}

              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <MuiButton
                  size="small"
                  variant="outlined"
                  disabled={
                    salesTeam.reduce(
                      (sum, m) => sum + Number(m.contribution),
                      0
                    ) >= 100
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
                <div className="text-sm text-gray-600">
                  Total Contribution:{" "}
                  {salesTeam.reduce((s, m) => s + Number(m.contribution), 0)}%
                </div>
              </Box>

              <Divider sx={{ my: 1.5 }} />
            </Box>
          </Collapse>

          {/* 2-col grid under sales team / toggles */}
          <Box
            sx={{
              mt: 1.25,
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0,1fr))",
              },
              gap: 1.25,
              alignItems: "start",
            }}
          >
            {/* Left row 1 */}
            <Autocomplete
              options={salesChannels}
              loading={salesChannelLoading}
              value={selectedSalesChannel}
              onChange={(e, newVal) => setSelectedSalesChannel(newVal ?? null)}
              getOptionLabel={(opt) => opt?.label || opt?.value || ""}
              isOptionEqualToValue={(opt, val) => opt.id === val?.id}
              noOptionsText={
                salesChannelLoading
                  ? "Loading channels..."
                  : "No channels found"
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Sales Channel"
                  placeholder="Select"
                  size="small"
                />
              )}
              disabled={editsLocked}
            />
            {/* Right row 1 */}
            <TextField
              label="Overall Discount (%)"
              type="number"
              size="small"
              value={overallDiscountPct ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return setOverallDiscountPct(null);
                let n = Number(v);
                if (Number.isNaN(n)) n = 0;
                n = Math.max(0, Math.min(100, n));
                setOverallDiscountPct(n);
              }}
              InputProps={{ inputProps: { min: 0, max: 100 } }}
              fullWidth
              disabled={editsLocked}
            />
            {/* Left row 2 */}
            <TextField
              select
              label="Billing Terms"
              value={billingTermsId}
              onChange={(e) => setBillingTermsId(String(e.target.value))}
              size="small"
              fullWidth
              helperText="Defaults to paid before shipping"
              disabled={editsLocked}
            >
              {BILLING_TERMS.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.label}
                </MenuItem>
              ))}
            </TextField>
            {/* Right row 2 */}
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
                affiliateLoading
                  ? "Loading affiliates..."
                  : "No affiliates found"
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Affiliate"
                  placeholder="Select (optional)"
                  helperText="Optional"
                  size="small"
                />
              )}
              disabled={editsLocked}
            />
            {/* Left row 3 */}
            <TextField
              label="Sales Order Date"
              type="date"
              value={salesOrderDate}
              onChange={(e) => setSalesOrderDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText="Optional"
              size="small"
              fullWidth
              disabled={editsLocked}
            />
            <TextField
              label="Reference text"
              placeholder=""
              value={soReference}
              onChange={(e) => setSoReference(e.target.value)}
              size="small"
              fullWidth
              disabled={editsLocked}
              sx={{ gridColumn: { xs: "auto", sm: "1 / -1" } }}
            />
          </Box>
        </Box>

        {/* Right: polished order summary card */}
        <Paper
          variant="outlined"
          sx={{
            p: 2.25,
            borderRadius: 3,
            bgcolor: "background.paper",
            boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 1,
            }}
          >
            <Typography
              variant="subtitle1"
              fontWeight={700}
              color="text.primary"
            >
              Order Summary
            </Typography>
            <Box
              sx={{
                fontSize: 12,
                px: 1,
                py: 0.25,
                borderRadius: 999,
                bgcolor: "rgba(59,130,246,0.08)",
                color: "rgb(37,99,235)",
                fontWeight: 600,
                lineHeight: 1.6,
              }}
            >
              Tax {TAX_RATE_PCT}%
            </Box>
          </Box>

          <Divider sx={{ mb: 1.25 }} />

          {/* Rows */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              rowGap: 0.5,
              columnGap: 2,
              alignItems: "center",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Subtotal
            </Typography>
            <Typography variant="body2" color="text.primary" fontWeight={600}>
              {fmtMoney(totalSum)}
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Est. Tax
              </Typography>
              <Tooltip title="Estimated for display; NetSuite will calculate actual tax at booking.">
                <InfoOutlinedIcon fontSize="inherit" sx={{ opacity: 0.8 }} />
              </Tooltip>
            </Box>
            <Typography variant="body2" color="text.primary" fontWeight={600}>
              {fmtMoney(estimatedOrderTax)}
            </Typography>
          </Box>

          <Divider sx={{ my: 1.25 }} />

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              alignItems: "center",
            }}
          >
            <Typography
              variant="subtitle2"
              color="text.primary"
              fontWeight={800}
            >
              Grand Total
            </Typography>
            <Typography
              variant="h6"
              fontWeight={800}
              color="text.primary"
              sx={{ letterSpacing: 0.2 }}
            >
              {fmtMoney(grandTotal)}
            </Typography>
          </Box>
        </Paper>
      </Box>

      {/*  Order Notes */}
      <Box>
        <TextField
          label="Order notes"
          placeholder="Internal notes for this order…"
          value={orderNotes}
          onChange={(e) => setOrderNotes(e.target.value)}
          multiline
          minRows={6}
          fullWidth
          disabled={editsLocked}
        />
      </Box>

      {/* Save Buttons */}
      <Box
        sx={{
          mt: 2,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "auto auto" },
          gap: 1,
          justifyContent: { xs: "stretch", sm: "start" },
        }}
      >
        <Button
          onClick={handleSaveClick}
          className="bg-[#FF7A59]! hover:bg-[#e76445]!"
        >
          Save to Hubspot
        </Button>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <Button
            disabled={creatingOrder}
            onClick={async () => {
              // unchanged
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
                  "Please make sure you have verified the billing and shipping address, saved the customer in netsuite!"
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

              handleSaveClick();
              setCreatingOrder(true);

              try {
                const visibleRows = rows.filter(
                  (row) => !fulfilledItemIds.includes(row.ns_item_id || row.id)
                );

                const rowsForCheck = [...visibleRows, ...deletedRows];

                const preflight = rowsForCheck.map((row, idx) => {
                  const skuRaw = row?.sku ?? "";
                  const skuKey = skuRaw.toString().trim().toUpperCase();
                  const fallbackBySku = skuKey ? skuToNsId.get(skuKey) : null;
                  const currentExplicit =
                    row?.ns_item_id ?? row?.nsItemId ?? null;
                  const resolved = resolveNsItemId(row);
                  const usedFallback =
                    Boolean(fallbackBySku) &&
                    String(resolved) === String(fallbackBySku);
                  const wouldChange =
                    String(currentExplicit ?? "") !== String(resolved ?? "");

                  return {
                    i: idx + 1,
                    sku: skuRaw,
                    name: row?.productName ?? "",
                    current_ns_item_id: currentExplicit ?? "",
                    fallback_ns_item_id: fallbackBySku ?? "",
                    resolved_ns_item_id: resolved ?? "",
                    used_fallback: usedFallback,
                    would_change: wouldChange,
                  };
                });

                const summary = preflight.reduce(
                  (acc, r) => {
                    acc.total += 1;
                    if (r.used_fallback) acc.fallback_used += 1;
                    if (r.would_change) acc.would_change += 1;
                    if (!r.resolved_ns_item_id) acc.missing_resolved += 1;
                    return acc;
                  },
                  {
                    total: 0,
                    fallback_used: 0,
                    would_change: 0,
                    missing_resolved: 0,
                  }
                );

                console.groupCollapsed(
                  `[OrderTab] NS itemId preflight — total=${summary.total}, fallback_used=${summary.fallback_used}, would_change=${summary.would_change}, missing_resolved=${summary.missing_resolved}`
                );
                console.table(preflight);
                console.groupEnd();

                const lineItems = [...visibleRows, ...deletedRows].map(
                  (row) => ({
                    itemId: resolveNsItemId(row), // NetSuite item id
                    quantity: Number(row.quantity) || 1,
                    unitPrice: Number(row.unitPrice) || 0,
                    unitDiscount: Number(row.unitDiscount) || 0,
                    isClosed: row.isClosed === true,
                    comment: row.comment || "",
                  })
                );

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
                  salesTeam: { replaceAll: true, items: formattedSalesTeam },
                  salesChannel: selectedSalesChannel?.id ?? null,
                  affiliateId:
                    selectedAffiliate && !isNoAffiliate(selectedAffiliate)
                      ? selectedAffiliate.id
                      : null,
                  salesOrderDate: salesOrderDate || null,
                  dealName: dealName,
                  orderNotes: orderNotes,
                  billingTermsId: billingTermsId,
                  soReference: soReference || "",
                };

                const res = await fetch("/api/netsuite/salesorder", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                });

                let data;
                try {
                  data = await res.json();
                } catch {
                  data = null;
                }
                if (!res.ok) throw new Error(data?.error || "Unknown error");

                toast.success(" Sales Order submitted to NetSuite.");
                let gotId = data?.id ? String(data.id) : null;
                let gotTran = data?.netsuiteTranId
                  ? String(data.netsuiteTranId)
                  : data?.tranid
                  ? String(data.tranid)
                  : null;
                if (gotId) setNetsuiteInternalId(gotId);
                if (gotTran) setNetsuiteTranId(gotTran);
                console.log("Hey hey in order");
                //fallback on custbody_hs_so_id
                if (!gotId || !gotTran) {
                  try {
                    console.log(
                      "Confirming SO via lookup-salesorder fallback…"
                    );
                    const found = await lookupSoByDealId(dealId);
                    if (found) {
                      console.log("found", found);
                      if (!gotId && found.id) {
                        gotId = found.id;
                        setNetsuiteInternalId(gotId);
                      }
                      if (!gotTran && found.tranid) {
                        gotTran = found.tranid;
                        setNetsuiteTranId(gotTran);
                      }
                      if (gotId && gotTran) {
                        console.debug("Confirmed SO from fallback:", {
                          id: gotId,
                          tranid: gotTran,
                        });
                      }
                    }
                  } catch (e) {
                    console.warn(
                      "Fallback lookup failed; will rely on later refresh.",
                      e
                    );
                  }
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
                setCreatingOrder(false);
              }
            }}
          >
            {creatingOrder ? "Submitting..." : "Mark Closed, send to Netsuite "}
          </Button>
          {/* Fallbacks readiness indicator */}
          <FallbacksIndicator ready={allProductsFetched} />
        </Box>
      </Box>

      {/* Loading overlay (unchanged) */}
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
