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

// components/versapay/AddPaymentMethod.jsx
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
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PaymentDialog from "./MakePaymentDialog";
import { useVersapaySession } from "../../src/hooks/useVersapaySession";
import {
  vpLog,
  color,
  enableVpFetchProbe,
  disableVpFetchProbe,
} from "../../lib/versapay/vpTrace";

// Global guard for the active flow
let VP_ACTIVE = { key: 0, sid: null, handled: false };

export default function AddPaymentMethod({
  customerId,
  onSaved,
  onError,
  buttonLabel = "+ Add Payment Method",
  invoices = [],
  onPaid,
  openPaymentDialogOnSave = false,
}) {
  const [showAddUI, setShowAddUI] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [containerKey, setContainerKey] = useState(0);

  const containerRef = useRef(null);
  const clientRef = useRef(null);
  const offApprovalRef = useRef(null);
  const mountIdRef = useRef(0);
  const flowSidRef = useRef(null);

  const [mounting, setMounting] = useState(false);
  const [submittingUI, setSubmittingUI] = useState(false);

  // payment states
  const [payOpen, setPayOpen] = useState(false);
  const [payToken, setPayToken] = useState(null);

  // UI-only
  const [canSubmit, setCanSubmit] = useState(false);
  const [frameLoading, setFrameLoading] = useState(false);

  const { ensure: ensureVersapaySession, reset: resetVersapaySession } =
    useVersapaySession();

  const teardownFrame = () => {
    vpLog(
      `teardownFrame() mount=${mountIdRef.current} sid=${
        flowSidRef.current ?? "∅"
      }`
    );
    const sidAtTeardown = flowSidRef.current;

    try {
      if (typeof offApprovalRef.current === "function") {
        offApprovalRef.current();
        vpLog("onApproval unsubscribed");
      }
    } catch (e) {
      vpLog("onApproval unsubscribe threw", e);
    }
    offApprovalRef.current = null;

    try {
      clientRef.current?.destroy?.();
    } catch {}
    try {
      clientRef.current?.removeFrame?.();
    } catch {}

    if (containerRef.current) containerRef.current.innerHTML = "";
    clientRef.current = null;

    VP_ACTIVE = { key: 0, sid: null, handled: false };
    if (sidAtTeardown && flowSidRef.current === sidAtTeardown) {
      flowSidRef.current = null;
    }

    setCanSubmit(false);
    setSubmittingUI(false);
    setFrameLoading(false);
    disableVpFetchProbe();
    setTimeout(() => {}, 0);
  };

  const handleAddPaymentMethod = async () => {
    if (mounting) return;
    setMounting(true);
    try {
      if (!customerId) {
        const msg = "No customerId available.";
        console.error(msg);
        onError?.(new Error(msg));
        return;
      }

      setCanSubmit(false);
      teardownFrame();
      setDialogKey((k) => k + 1);
      setContainerKey((k) => k + 1);
      enableVpFetchProbe("pre-mount");
      setShowAddUI(true);
      setFrameLoading(true);

      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const myMountId = ++mountIdRef.current;
      vpLog(...color(`BEGIN mount=${myMountId}`, "#2f6fed"));
      disableVpFetchProbe();
      enableVpFetchProbe(`mount#${myMountId}`);

      const mountWithNewSession = async () => {
        const sid = await ensureVersapaySession({ forceNew: true });
        flowSidRef.current = sid;
        vpLog(`created session sid=${sid} (mount=${myMountId})`);

        VP_ACTIVE.key += 1;
        VP_ACTIVE.sid = sid;
        VP_ACTIVE.handled = false;
        const myFlowKey = VP_ACTIVE.key;

        await new Promise((r) => setTimeout(r, 100));

        if (typeof versapay === "undefined") {
          throw new Error("Versapay SDK not loaded.");
        }

        try {
          versapay.destroyClient?.();
        } catch {}

        const maybeClient = versapay.initClient(sid, {}, []);
        const vpClient =
          typeof maybeClient?.then === "function"
            ? await maybeClient
            : maybeClient;

        clientRef.current = vpClient;
        vpLog("versapay.initClient() → client set");

        if (containerRef.current) containerRef.current.innerHTML = "";
        const initP = vpClient.initFrame(
          containerRef.current,
          "420px", // taller to avoid field/captcha overflow
          "100%" // responsive width
        );
        if (initP && typeof initP.then === "function") {
          await initP;
        }

        const hasIframe = !!containerRef.current?.querySelector("iframe");
        if (!hasIframe)
          throw new Error("VersaPay iframe missing after initFrame()");

        try {
          const iframeEl = containerRef.current?.querySelector("iframe");
          if (iframeEl) {
            const onLoad = () => setFrameLoading(false);
            iframeEl.addEventListener("load", onLoad, { once: true });
            setTimeout(() => setFrameLoading(false), 2500); // fallback
          } else {
            setFrameLoading(false);
          }
        } catch {
          setFrameLoading(false);
        }

        try {
          vpClient?.on?.("error", (e) => vpLog("VP client error", e));
          vpClient?.on?.("stateChange", (s) => vpLog("VP state", s));
        } catch {}

        setCanSubmit(true);
        return { vpClient, sid, myFlowKey };
      };

      let vpClient, flowSid, myFlowKey;
      try {
        ({ vpClient, sid: flowSid, myFlowKey } = await mountWithNewSession());
      } catch (e) {
        vpLog("mountWithNewSession() failed; resetting & retrying", e);
        resetVersapaySession();
        ({ vpClient, sid: flowSid, myFlowKey } = await mountWithNewSession());
      }

      const client = clientRef.current;
      const maybeOff = client.onApproval(
        async (result) => {
          if (mountIdRef.current !== myMountId) return;
          if (VP_ACTIVE.key !== myFlowKey || VP_ACTIVE.sid !== flowSid) return;
          if (VP_ACTIVE.handled) return;
          VP_ACTIVE.handled = true;

          try {
            const sid = flowSid;

            // $1 auth-only
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

            // Void the $1 auth (best-effort)
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

            // ⬇️ Only open PaymentDialog if explicitly enabled
            if (openPaymentDialogOnSave) {
              setPayToken(result.token);
              setPayOpen(true);
            }

            setSubmittingUI(false);
            teardownFrame();
            setShowAddUI(false);
            resetVersapaySession();
            vpLog(...color(`END mount=${myMountId} success`, "#2f6fed"));
          } catch (err) {
            console.error("Flow error:", err);
            setSubmittingUI(false);
            onError?.(err);
          }
        },
        (error) => {
          if (mountIdRef.current !== myMountId) return;
          console.error("Payment rejected:", error?.error || error);
          setSubmittingUI(false);
          onError?.(error);
        }
      );
      offApprovalRef.current = typeof maybeOff === "function" ? maybeOff : null;
    } catch (err) {
      console.error(
        "Failed to create Versapay session:",
        err?.response?.data || err
      );
      setFrameLoading(false);
      onError?.(err);
    } finally {
      setMounting(false);
    }
  };

  const handleDialogClose = (_e, reason) => {
    vpLog(`Dialog closing. reason=${reason || "unknown"}`);
    setShowAddUI(false);
    setSubmittingUI(false);
    teardownFrame();
    resetVersapaySession();
  };

  useEffect(() => {
    return () => {
      teardownFrame();
      setPayToken(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        disabled={!customerId || mounting}
      >
        {buttonLabel}
      </Button>

      <Dialog
        key={dialogKey}
        open={showAddUI}
        onClose={handleDialogClose}
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
          <Box sx={{ position: "relative", width: "100%" }}>
            {frameLoading && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(255,255,255,0.6)",
                  zIndex: 1,
                }}
              >
                <CircularProgress />
              </Box>
            )}
            <div
              key={containerKey}
              id="vp-container"
              ref={containerRef}
              style={{
                height: "420px",
                width: "100%",
                maxWidth: "500px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "8px",
                background: "#fff",
                margin: "8px 0",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            />
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={handleDialogClose} variant="text">
            Cancel
          </Button>
          <Button
            id="vp-save-global"
            disabled={!canSubmit || submittingUI}
            type="button"
            onClick={async () => {
              const c = clientRef.current;
              if (!c || submittingUI) return;
              try {
                setSubmittingUI(true); // button loader on
                vpLog("Save clicked; calling submitEvents()");
                const p = c.submitEvents();
                if (p && typeof p.then === "function") await p;
                // loader will be cleared on approval/reject/error
              } catch (err) {
                console.error("submitEvents error:", err);
                setSubmittingUI(false); // immediate failure
              }
            }}
            variant="contained"
          >
            {submittingUI ? "Saving…" : "Save Payment Method"}
            {submittingUI && <CircularProgress size={18} sx={{ ml: 1 }} />}
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
