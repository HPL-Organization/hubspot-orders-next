import React, { useEffect, useState } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SettingsIcon from "@mui/icons-material/Settings";
import IconButton from "@mui/material/IconButton";

const FulfillmentTab = ({ netsuiteInternalId }) => {
  // User's chosen locale

  const [locale, setLocale] = useState("en-US");
  const [fulfillments, setFulfillments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // const fulfillments = [
  //   {
  //     id: 1,
  //     number: "Fulfillment #1",
  //     shippedAt: "2025-06-21",
  //     items: [
  //       {
  //         sku: "10001",
  //         productName: "Product Name",
  //         quantity: 1,
  //         tracking: "1Z9999TRACK",
  //       },
  //       {
  //         sku: "20075",
  //         productName: "Model 10",
  //         quantity: 5,
  //         tracking: "1Z8888TRACK",
  //       },
  //     ],
  //   },
  //   {
  //     id: 2,
  //     number: "Fulfillment #2",
  //     shippedAt: "2025-06-18",
  //     items: [
  //       {
  //         sku: "30001",
  //         productName: "Another Product",
  //         quantity: 2,
  //         tracking: "1Z8888TRACK",
  //       },
  //     ],
  //   },
  // ];

  // Formats YYYY-MM-DD into localized format
  const formatDate = (isoDate) => {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };

  useEffect(() => {
    if (!netsuiteInternalId) return;

    const fetchFulfillments = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/fulfillments?internalId=${netsuiteInternalId}`
        );
        const data = await res.json();
        console.log("📦 Fulfillments response from API:", data);
        setFulfillments(data.fulfillments || []);
        console.log(
          "🔍 Parsed fulfillments:",
          JSON.stringify(data.fulfillments, null, 2)
        );
        console.log("Rendering items:", fulfillment.items);
      } catch (err) {
        console.error(" Failed to fetch fulfillments:", err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFulfillments();
  }, [netsuiteInternalId]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-black">Fulfillment</h1>
        <IconButton onClick={() => setShowSettings(!showSettings)} size="small">
          <SettingsIcon />
        </IconButton>
      </div>

      {/* Locale selector */}
      <div className="mb-4 flex items-center gap-2">
        {showSettings && (
          <FormControl size="small">
            <InputLabel id="locale-label">Date Format</InputLabel>
            <Select
              labelId="locale-label"
              value={locale}
              label="Date Format"
              onChange={(e) => setLocale(e.target.value)}
            >
              <MenuItem value="en-US">MM/DD/YYYY (US)</MenuItem>
              <MenuItem value="en-GB">DD/MM/YYYY (UK)</MenuItem>
              <MenuItem value="de-DE">DD.MM.YYYY (Germany)</MenuItem>
              <MenuItem value="en-CA">YYYY-MM-DD (ISO)</MenuItem>
            </Select>
          </FormControl>
        )}
      </div>

      {fulfillments?.map((fulfillment) => {
        console.log("Rendering items:", fulfillment.items);
        return (
          <Accordion key={fulfillment.id} className="mb-4">
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              className="bg-gray-50"
            >
              <div className="flex justify-between w-full">
                <Typography className="font-semibold">
                  {fulfillment.number}
                </Typography>
                <Typography className="text-gray-600">
                  {fulfillment.status || "Status Unknown"} —{" "}
                  {formatDate(fulfillment.shippedAt)}
                </Typography>
              </div>
            </AccordionSummary>

            <AccordionDetails>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead className="bg-gray-100">
                    <TableRow>
                      <TableCell>SKU</TableCell>
                      <TableCell>Display Name</TableCell>
                      <TableCell>Quantity Shipped</TableCell>
                      <TableCell>Tracking #</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {fulfillment.items?.length > 0 ? (
                      fulfillment.items.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell>{item.sku || "—"}</TableCell>
                          <TableCell>{item.productName || "—"}</TableCell>
                          <TableCell>{item.quantity || "—"}</TableCell>
                          <TableCell>{item.tracking || "—"}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4}>No items found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </div>
  );
};

export default FulfillmentTab;
