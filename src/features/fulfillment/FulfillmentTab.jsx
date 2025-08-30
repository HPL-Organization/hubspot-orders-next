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

  const handleTrackingNumberDisplay = (tracking) => {
    if (!tracking) return "—";
    const uniqueTrackingNumbers = Array.from(
      new Set(tracking.split(",").map((num) => num.trim()))
    );
    return uniqueTrackingNumbers.join(", ") || "—";
  };

  //  serial number display helper
  const handleSerialsDisplay = (serials) => {
    if (!serials || (Array.isArray(serials) && serials.length === 0))
      return "—";
    const list = Array.isArray(serials)
      ? serials
      : String(serials).split(/[,;\n]+/);
    const unique = Array.from(
      new Set(list.map((s) => String(s).trim()).filter(Boolean))
    );
    return unique.join(", ") || "—";
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
        console.log(" Fulfillments response from API:", data);
        setFulfillments(data.fulfillments || []);
        console.log(
          " Parsed fulfillments:",
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

      {loading ? (
        <Typography className="text-gray-600 mt-4">
          Loading fulfillments...
        </Typography>
      ) : fulfillments.length === 0 ? (
        <Typography className="text-gray-600 mt-4">
          No fulfillments related to this sales order.
        </Typography>
      ) : (
        fulfillments.map((fulfillment) => {
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

                        <TableCell>Serial #</TableCell>
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
                            <TableCell>
                              {handleSerialsDisplay(
                                item.serialNumbers ??
                                  item.serialnumber ??
                                  item.custcol_hpl_serialnumber
                              )}
                            </TableCell>
                            <TableCell>
                              {handleTrackingNumberDisplay(item.tracking)}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5}>No items found.</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          );
        })
      )}
    </div>
  );
};

export default FulfillmentTab;
