// "use client";
// /* global versapay */
// import React, { useEffect, useRef, useState } from "react";
// import {
//   Box,
//   Button,
//   Dialog,
//   DialogTitle,
//   DialogContent,
//   DialogActions,
//   IconButton,
// } from "@mui/material";
// import CloseIcon from "@mui/icons-material/Close";
// import PaymentDialog from "./MakePaymentDialog";
// import { useVersapaySession } from "../../src/hooks/useVersapaySession";
// import { looksLikeNotFound } from "../../lib/versapay/session";

// export default function AddPaymentMethod({
//   customerId,
//   onSaved,
//   onError,
//   buttonLabel = "+ Add Payment Method",
//   invoices = [],
//   onPaid,
// }) {
//   const [showAddUI, setShowAddUI] = useState(false);
//   const containerRef = useRef(null);
//   const clientRef = useRef(null);

//   // payment states
//   const [payOpen, setPayOpen] = useState(false);
//   const [payToken, setPayToken] = useState(null);
//   const [vpSessionId, setVpSessionId] = useState(null);

//   // UI-only: control Save button enabled state
//   const [canSubmit, setCanSubmit] = useState(false);

//   const { ensure: ensureVersapaySession, reset: resetVersapaySession } =
//     useVersapaySession();

//   //   async function ensureVersapaySession() {
//   //     if (vpSessionId) return vpSessionId;
//   //     const resp = await fetch("/api/versapay/create-session", {
//   //       method: "POST",
//   //     });
//   //     const json = await resp.json();
//   //     if (!resp.ok || !json?.sessionId)
//   //       throw new Error(json?.message || "Failed to create Versapay session");
//   //     setVpSessionId(json.sessionId);
//   //     return json.sessionId;
//   //   }

//   const teardownFrame = () => {
//     if (containerRef.current) containerRef.current.innerHTML = "";
//     clientRef.current = null;
//     setCanSubmit(false);
//   };

//   // Versapay flow (session -> mount iframe -> onApproval)
//   const handleAddPaymentMethod = async () => {
//     try {
//       if (!customerId) {
//         const msg = "No customerId available.";
//         console.error(msg);
//         onError?.(new Error(msg));
//         return;
//       }

//       setCanSubmit(false);
//       setShowAddUI(true); // open dialog

//       //   const res = await fetch("/api/versapay/create-session", {
//       //     method: "POST",
//       //   });
//       //   const { sessionId } = await res.json();
//       //   if (!sessionId) throw new Error("No session id from Versapay");
//       //   console.log("Session id", sessionId);
//       //   const sessionId = await ensureVersapaySession();
//       // Always force a fresh session for the iframe/tokenization flow
//       const initWithSession = async () => {
//         const sessionId = await ensureVersapaySession({ forceNew: true });

//         // Initialize client (avoid "client" name to prevent collisions)
//         const _vpClient = versapay.initClient(sessionId, {}, []);
//         const vpClient =
//           typeof _vpClient?.then === "function" ? await _vpClient : _vpClient;

//         clientRef.current = vpClient;

//         // Mount iframe (await so we can catch failures)
//         const p = vpClient.initFrame(containerRef.current, "358px", "500px");
//         if (p && typeof p.then === "function") {
//           await p;
//         }
//         return vpClient;
//       };

//       // One-shot retry if the first init blows up with a 404 (stale session)
//       try {
//         await initWithSession();
//       } catch (e) {
//         if (looksLikeNotFound(e)) {
//           resetVersapaySession();
//           await initWithSession();
//         } else {
//           throw e;
//         }
//       }

//       const sdk = typeof versapay !== "undefined" ? versapay : null;
//       if (!sdk) {
//         const msg = "Versapay SDK not loaded.";
//         console.error(msg);
//         onError?.(new Error(msg));
//         return;
//       }

//       // Prevent duplicate mounts in StrictMode
//       if (clientRef.current) {
//         console.log("Versapay client already initialized; skipping re-init.");
//         return;
//       }

//       // Give the Dialog a tick to render #vp-container
//       await new Promise((r) => setTimeout(r, 0));

//       // Clear container to avoid duplicate nodes
//       if (containerRef.current) containerRef.current.innerHTML = "";

//       // Initialize client
//       const _client = sdk.initClient(sessionId, {}, []);
//       const client =
//         typeof _client?.then === "function" ? await _client : _client;
//       clientRef.current = client;

//       const frameReady = client.initFrame(
//         containerRef.current,
//         "358px",
//         "500px"
//       );
//       console.log("Versapay iframe initialized.");

//       // Enable Save when iframe is ready (promise or not)
//       const markReady = () => setCanSubmit(true);

//       if (frameReady && typeof frameReady.then === "function") {
//         frameReady.then(markReady).catch(markReady);
//       } else {
//         // Fallbacks: check now, next frame, and via mutation
//         if (containerRef.current?.querySelector("iframe")) {
//           markReady();
//         } else {
//           requestAnimationFrame(() => {
//             if (containerRef.current?.querySelector("iframe")) markReady();
//           });
//           const mo = new MutationObserver(() => {
//             if (containerRef.current?.querySelector("iframe")) {
//               markReady();
//               mo.disconnect();
//             }
//           });
//           if (containerRef.current) {
//             mo.observe(containerRef.current, { childList: true });
//           }
//         }
//       }

//       client.onApproval(
//         async (result) => {
//           console.log("result from iframe", result);
//           try {
//             // $1 auth-only to retrieve meta + ensure token works
//             const authResp = await fetch("/api/versapay/process-sale", {
//               method: "POST",
//               headers: { "Content-Type": "application/json" },
//               body: JSON.stringify({
//                 sessionId,
//                 token: result.token,
//                 amount: 1.0,
//                 capture: false,
//                 currency: "USD",
//                 orderNumber: `AUTH-${Date.now()}`,
//               }),
//             });

//             const auth = await authResp.json();
//             if (!authResp.ok) throw auth;
//             console.log("Auth test", auth);

//             // Save the payment method to NetSuite
//             const saveResp = await fetch("/api/netsuite/save-payment-method", {
//               method: "POST",
//               headers: { "Content-Type": "application/json" },
//               body: JSON.stringify({
//                 customerInternalId: customerId,
//                 token: result.token,
//                 accountNumberLastFour: auth?.payment?.accountNumberLastFour,
//                 accountType: auth?.payment?.accountType,
//               }),
//             });

//             const saveData = await saveResp.json();
//             if (!saveResp.ok) throw saveData;
//             console.log("Payment method saved in NetSuite:", saveData);
//             onSaved?.(saveData);

//             // Void the $1 auth
//             try {
//               const txId = auth?.payment?.transactionId;
//               if (txId) {
//                 await fetch("/api/versapay/void-sale", {
//                   method: "POST",
//                   headers: { "Content-Type": "application/json" },
//                   body: JSON.stringify({ transactionId: txId }),
//                 });
//               }
//             } catch (e) {
//               console.warn("Could not void auth:", e);
//             }

//             setPayToken(result.token);
//             setPayOpen(true);
//             teardownFrame();
//             setShowAddUI(false); // close dialog after success
//             resetVersapaySession();
//           } catch (err) {
//             console.error("Flow error:", err);
//             onError?.(err);
//           }
//         },
//         (error) => {
//           console.error("Payment rejected:", error?.error || error);
//           onError?.(error);
//         }
//       );
//     } catch (err) {
//       console.error(
//         "Failed to create Versapay session:",
//         err?.response?.data || err
//       );
//       onError?.(err);
//     }
//   };

//   const handleDialogClose = () => {
//     setShowAddUI(false);
//     teardownFrame();
//     resetVersapaySession();
//   };

//   // Cleanup on unmount to avoid sticky iframe
//   useEffect(() => {
//     return () => {
//       teardownFrame();
//       setPayToken(null);
//     };
//   }, []);

//   return (
//     <Box
//       sx={{
//         mb: 4,
//         p: 2,
//         border: "1px solid #e0e0e0",
//         borderRadius: 2,
//         boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
//         backgroundColor: "#fff",
//       }}
//     >
//       <Button
//         size="small"
//         variant="outlined"
//         onClick={handleAddPaymentMethod}
//         disabled={!customerId}
//       >
//         {buttonLabel}
//       </Button>

//       {/* Dialog iframe (UI only) */}
//       <Dialog
//         open={showAddUI}
//         onClose={handleDialogClose}
//         keepMounted
//         fullWidth
//         maxWidth="sm"
//         aria-labelledby="add-payment-method-title"
//       >
//         <DialogTitle id="add-payment-method-title" sx={{ pr: 6 }}>
//           Add a Payment Method
//           <IconButton
//             aria-label="close"
//             onClick={handleDialogClose}
//             sx={{ position: "absolute", right: 12, top: 12 }}
//           >
//             <CloseIcon />
//           </IconButton>
//         </DialogTitle>

//         <DialogContent dividers sx={{ bgcolor: "#fafafa" }}>
//           <form
//             id="vp-form-global"
//             onSubmit={(e) => {
//               e.preventDefault();
//               const c = clientRef.current;
//               if (!c) {
//                 console.error("Versapay client not ready");
//                 return;
//               }
//               const p = c.submitEvents();
//               if (p && typeof p.then === "function") {
//                 p.catch((err) => console.error("submitEvents error:", err));
//               }
//             }}
//           >
//             <div
//               id="vp-container"
//               ref={containerRef}
//               style={{
//                 height: "358px",
//                 width: "100%",
//                 maxWidth: "500px",
//                 border: "1px solid #e5e7eb",
//                 borderRadius: "8px",
//                 padding: "8px",
//                 background: "#fff",
//                 margin: "8px 0",
//               }}
//             />
//           </form>
//         </DialogContent>

//         <DialogActions sx={{ px: 3, py: 2 }}>
//           <Button onClick={handleDialogClose} variant="text">
//             Cancel
//           </Button>
//           <Button
//             id="vp-save-global"
//             disabled={!canSubmit}
//             type="button"
//             onClick={() =>
//               document
//                 .getElementById("vp-form-global")
//                 ?.dispatchEvent(
//                   new Event("submit", { cancelable: true, bubbles: true })
//                 )
//             }
//             variant="contained"
//           >
//             Save Payment Method
//           </Button>
//         </DialogActions>
//       </Dialog>

//       <PaymentDialog
//         open={payOpen}
//         onClose={() => {
//           setPayOpen(false);
//           setPayToken(null);
//           setVpSessionId(null);
//         }}
//         invoices={invoices}
//         ensureSession={ensureVersapaySession}
//         customerId={customerId}
//         paymentSource={{ token: payToken || undefined }}
//         onPaid={(data) => {
//           setPayOpen(false);
//           setPayToken(null);
//           setVpSessionId(null);
//           onPaid && onPaid(data);
//           resetVersapaySession();
//         }}
//       />
//     </Box>
//   );
// }

"use client";
/* global versapay */
import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PaymentDialog from "./MakePaymentDialog";
import { useVersapaySession } from "../../src/hooks/useVersapaySession";
import { looksLikeNotFound } from "../../lib/versapay/session";

export default function AddPaymentMethod({
  customerId,
  onSaved,
  onError,
  buttonLabel = "+ Add Payment Method",
  invoices = [],
  onPaid,
}) {
  const [showAddUI, setShowAddUI] = useState(false);
  const containerRef = useRef(null);
  const clientRef = useRef(null);
  const sessionIdRef = useRef(null);

  // payment states
  const [payOpen, setPayOpen] = useState(false);
  const [payToken, setPayToken] = useState(null);

  // UI-only: control Save button enabled state
  const [canSubmit, setCanSubmit] = useState(false);

  const { ensure: ensureVersapaySession, reset: resetVersapaySession } =
    useVersapaySession();

  const teardownFrame = () => {
    if (containerRef.current) containerRef.current.innerHTML = "";
    clientRef.current = null;
    setCanSubmit(false);
  };

  // Versapay flow (session -> mount iframe -> onApproval)
  const handleAddPaymentMethod = async () => {
    try {
      if (!customerId) {
        const msg = "No customerId available.";
        console.error(msg);
        onError?.(new Error(msg));
        return;
      }

      setCanSubmit(false);
      setShowAddUI(true); // open dialog

      // ensure the dialog content has rendered
      await new Promise((r) => setTimeout(r, 0));

      const mountWithNewSession = async () => {
        const sid = await ensureVersapaySession({ forceNew: true });
        sessionIdRef.current = sid;

        if (typeof versapay === "undefined") {
          throw new Error("Versapay SDK not loaded.");
        }

        // Init client
        const maybeClient = versapay.initClient(sid, {}, []);
        const vpClient =
          typeof maybeClient?.then === "function"
            ? await maybeClient
            : maybeClient;

        clientRef.current = vpClient;

        // Clear any prior DOM and mount iframe
        if (containerRef.current) containerRef.current.innerHTML = "";
        const initP = vpClient.initFrame(
          containerRef.current,
          "358px",
          "500px"
        );
        if (initP && typeof initP.then === "function") {
          await initP;
        }

        setCanSubmit(true); // enable Save once mounted
        return vpClient;
      };

      try {
        await mountWithNewSession();
      } catch (e) {
        if (looksLikeNotFound(e)) {
          // stale/invalid session—reset and retry once
          resetVersapaySession();
          await mountWithNewSession();
        } else {
          throw e;
        }
      }

      const client = clientRef.current;
      client.onApproval(
        async (result) => {
          try {
            const sid = sessionIdRef.current;
            if (!sid) throw new Error("Missing Versapay session id.");

            // $1 auth-only to retrieve meta + ensure token works
            const authResp = await fetch("/api/versapay/process-sale", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sid,
                token: result.token,
                amount: 1.0,
                capture: false,
                currency: "USD",
                orderNumber: `AUTH-${Date.now()}`,
              }),
            });

            const auth = await authResp.json();
            if (!authResp.ok) throw auth;

            // Save the payment method to NetSuite
            const saveResp = await fetch("/api/netsuite/save-payment-method", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customerInternalId: customerId,
                token: result.token,
                accountNumberLastFour: auth?.payment?.accountNumberLastFour,
                accountType: auth?.payment?.accountType,
              }),
            });

            const saveData = await saveResp.json();
            if (!saveResp.ok) throw saveData;
            onSaved?.(saveData);

            try {
              const txId = auth?.payment?.transactionId;
              if (txId) {
                await fetch("/api/versapay/void-sale", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ transactionId: txId }),
                });
              }
            } catch {}

            setPayToken(result.token);
            setPayOpen(true);
            teardownFrame();
            setShowAddUI(false);
            resetVersapaySession();
          } catch (err) {
            console.error("Flow error:", err);
            onError?.(err);
          }
        },
        (error) => {
          console.error("Payment rejected:", error?.error || error);
          onError?.(error);
        }
      );
    } catch (err) {
      console.error(
        "Failed to create Versapay session:",
        err?.response?.data || err
      );
      onError?.(err);
    }
  };

  const handleDialogClose = () => {
    setShowAddUI(false);
    teardownFrame();
    resetVersapaySession();
  };

  useEffect(() => {
    return () => {
      teardownFrame();
      setPayToken(null);
      sessionIdRef.current = null;
    };
  }, []);

  return (
    <Box
      sx={{
        mb: 4,
        p: 2,
        border: "1px solid #e0e0e0",
        borderRadius: 2,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        backgroundColor: "#fff",
      }}
    >
      <Button
        size="small"
        variant="outlined"
        onClick={handleAddPaymentMethod}
        disabled={!customerId}
      >
        {buttonLabel}
      </Button>

      {/* Dialog iframe (UI only) */}
      <Dialog
        open={showAddUI}
        onClose={handleDialogClose}
        keepMounted
        fullWidth
        maxWidth="sm"
        aria-labelledby="add-payment-method-title"
      >
        <DialogTitle id="add-payment-method-title" sx={{ pr: 6 }}>
          Add a Payment Method
          <IconButton
            aria-label="close"
            onClick={handleDialogClose}
            sx={{ position: "absolute", right: 12, top: 12 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ bgcolor: "#fafafa" }}>
          <form
            id="vp-form-global"
            onSubmit={(e) => {
              e.preventDefault();
              const c = clientRef.current;
              if (!c) {
                console.error("Versapay client not ready");
                return;
              }
              const p = c.submitEvents();
              if (p && typeof p.then === "function") {
                p.catch((err) => console.error("submitEvents error:", err));
              }
            }}
          >
            <div
              id="vp-container"
              ref={containerRef}
              style={{
                height: "358px",
                width: "100%",
                maxWidth: "500px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "8px",
                background: "#fff",
                margin: "8px 0",
              }}
            />
          </form>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={handleDialogClose} variant="text">
            Cancel
          </Button>
          <Button
            id="vp-save-global"
            disabled={!canSubmit}
            type="button"
            onClick={() =>
              document
                .getElementById("vp-form-global")
                ?.dispatchEvent(
                  new Event("submit", { cancelable: true, bubbles: true })
                )
            }
            variant="contained"
          >
            Save Payment Method
          </Button>
        </DialogActions>
      </Dialog>

      <PaymentDialog
        open={payOpen}
        onClose={() => {
          setPayOpen(false);
          setPayToken(null);
        }}
        invoices={invoices}
        ensureSession={ensureVersapaySession}
        customerId={customerId}
        paymentSource={{ token: payToken || undefined }}
        onPaid={(data) => {
          setPayOpen(false);
          setPayToken(null);
          onPaid && onPaid(data);
          resetVersapaySession();
        }}
      />
    </Box>
  );
}
