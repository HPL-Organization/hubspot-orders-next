/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/runtime", "N/ui/serverWidget", "N/redirect", "N/log"], (
  record,
  runtime,
  serverWidget,
  redirect,
  log
) => {
  // KEEP: fulfillment MR (existing)
  const DEPLOY_FULFILLMENT_ID = 3882;

  // NEW: invoice creator MR deployment (/scripting/scriptrecord.nl?id=4015, customdeploy1)
  const DEPLOY_INVOICE_ID = 4015;

  function pill(label, ok) {
    return `
      <span style="
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding:4px 10px;
        border-radius:999px;
        font-weight:600;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        font-size:12px;
        color:${ok ? "#0f5132" : "#842029"};
        background:${ok ? "#d1e7dd" : "#f8d7da"};
        border:1px solid ${ok ? "#badbcc" : "#f5c2c7"};
        margin-right:8px;
        margin-bottom:6px;
        white-space:nowrap;
      ">
        <span style="width:8px;height:8px;border-radius:99px;background:${
          ok ? "#198754" : "#dc3545"
        };display:inline-block;"></span>
        ${label}
      </span>
    `;
  }

  function btnHtml({ action, label, tone, disabled }) {
    const bg =
      tone === "danger"
        ? "#dc3545"
        : tone === "success"
        ? "#198754"
        : "#0d6efd";
    const bgHover =
      tone === "danger"
        ? "#bb2d3b"
        : tone === "success"
        ? "#157347"
        : "#0b5ed7";

    const disabledAttr = disabled ? "disabled" : "";
    const opacity = disabled ? "0.55" : "1";
    const cursor = disabled ? "not-allowed" : "pointer";

    return `
      <button type="button"
        ${disabledAttr}
        onclick="OpsControls.doAction('${action}')"
        style="
          appearance:none;
          border:0;
          border-radius:10px;
          padding:10px 14px;
          font-weight:700;
          font-size:13px;
          font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
          color:#fff;
          background:${bg};
          box-shadow:0 6px 18px rgba(0,0,0,0.12);
          opacity:${opacity};
          cursor:${cursor};
          transition:transform .06s ease, filter .12s ease, background .12s ease;
          user-select:none;
          white-space:nowrap;
        "
        onmouseover="this.dataset.dis==='1' ? null : (this.style.background='${bgHover}')"
        onmouseout="this.dataset.dis==='1' ? null : (this.style.background='${bg}')"
        onmousedown="this.dataset.dis==='1' ? null : (this.style.transform='scale(0.98)')"
        onmouseup="this.dataset.dis==='1' ? null : (this.style.transform='scale(1)')"
        data-dis="${disabled ? "1" : "0"}"
      >
        ${label}
      </button>
    `;
  }

  function cardHtml({ title, subtitle, leftHtml, rightHtml, footerHtml }) {
    return `
      <div class="ops-card">
        <div class="ops-card-h">
          <div style="min-width:0;">
            <div class="ops-title">${title}</div>
            <div class="ops-subtitle">${subtitle || ""}</div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;">
            ${rightHtml || ""}
          </div>
        </div>
        <div class="ops-body">
          ${leftHtml || ""}
        </div>
        ${footerHtml ? `<div class="ops-footer">${footerHtml}</div>` : ""}
      </div>
    `;
  }

  // ---------- Generic script deployment helpers ----------
  function loadDeployment(deploymentId) {
    return record.load({
      type: "scriptdeployment",
      id: deploymentId,
      isDynamic: false,
    });
  }

  function setDeploymentState(deploymentId, wantOn) {
    const dep = loadDeployment(deploymentId);
    dep.setValue({ fieldId: "isdeployed", value: !!wantOn });
    dep.setText({
      fieldId: "status",
      text: wantOn ? "Scheduled" : "Not Scheduled",
    });
    dep.save({ enableSourcing: false, ignoreMandatoryFields: true });
  }

  function readDeploymentInfo(deploymentId) {
    let isDeployed = null,
      statusText = "",
      scriptId = "",
      title = "",
      err = "";

    try {
      const dep = loadDeployment(deploymentId);
      isDeployed = dep.getValue({ fieldId: "isdeployed" }) === true;
      statusText =
        dep.getText({ fieldId: "status" }) ||
        String(dep.getValue({ fieldId: "status" }) || "");
      scriptId = dep.getValue({ fieldId: "scriptid" }) || "";
      title = dep.getValue({ fieldId: "title" }) || "Script Deployment";
    } catch (e) {
      err = String(e.message || e);
      statusText = `ERROR: ${err}`;
    }

    return { isDeployed, statusText, scriptId, title, err };
  }

  function renderDeploymentCard({
    cardTitle,
    cardSubtitle,
    deploymentId,
    actionOn,
    actionOff,
  }) {
    const info = readDeploymentInfo(deploymentId);

    const unknown = info.isDeployed === null || !!info.err;
    const nextAction = unknown ? "" : info.isDeployed ? actionOff : actionOn;

    const btn = btnHtml({
      action: nextAction || "NOOP",
      label: unknown ? "Unavailable" : info.isDeployed ? "Turn OFF" : "Turn ON",
      tone: unknown ? "primary" : info.isDeployed ? "danger" : "success",
      disabled: unknown,
    });

    const left = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        ${
          info.isDeployed === null
            ? pill("DEPLOYED: UNKNOWN", false)
            : pill(
                info.isDeployed ? "DEPLOYED = ON" : "DEPLOYED = OFF",
                !!info.isDeployed
              )
        }
        ${pill(`STATUS: ${info.statusText || "Unknown"}`, !info.err)}
      </div>

      <div style="font-size:12px;color:#556;line-height:1.35;">
        <div><b>${info.title || "Script Deployment"}</b> ${
      info.scriptId
        ? `— <code style="font-size:12px;background:#f6f8fa;border:1px solid #e5e7eb;padding:1px 6px;border-radius:8px;">${info.scriptId}</code>`
        : ""
    }</div>
        <div style="margin-top:4px;">Deployment ID: <b>${deploymentId}</b></div>
        ${
          info.err
            ? `<div style="margin-top:8px;color:#842029;background:#f8d7da;border:1px solid #f5c2c7;padding:8px;border-radius:10px;">
                 <b>Load error:</b> ${info.err}
               </div>`
            : ""
        }
      </div>
    `;

    return cardHtml({
      title: cardTitle,
      subtitle: cardSubtitle,
      leftHtml: left,
      rightHtml: btn,
      footerHtml:
        "This updates <b>isdeployed</b> and sets <b>status</b> to Scheduled / Not Scheduled.",
    });
  }

  function renderForm(context) {
    const form = serverWidget.createForm({ title: "Operations Controls" });

    // Hidden action field (buttons set this + submit)
    const action = form.addField({
      id: "custpage_action",
      type: serverWidget.FieldType.TEXT,
      label: "Action",
    });
    action.updateDisplayType({
      displayType: serverWidget.FieldDisplayType.HIDDEN,
    });

    const info = form.addField({
      id: "custpage_info",
      type: serverWidget.FieldType.INLINEHTML,
      label: " ",
    });

    const fulfillmentCard = renderDeploymentCard({
      cardTitle: "Fulfillment Map/Reduce",
      cardSubtitle: "Turn the fulfillment MR on/off (deploy + scheduled).",
      deploymentId: DEPLOY_FULFILLMENT_ID,
      actionOn: "FULFILL_ON",
      actionOff: "FULFILL_OFF",
    });

    const invoiceCard = renderDeploymentCard({
      cardTitle: "Invoice Creator Map/Reduce",
      cardSubtitle: "Turn the invoice creator MR on/off (deploy + scheduled).",
      deploymentId: DEPLOY_INVOICE_ID,
      actionOn: "INVOICE_ON",
      actionOff: "INVOICE_OFF",
    });

    info.defaultValue = `
      <style>
        .ops-wrap{
          font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
          padding: 6px 2px 2px 2px;
        }
        .ops-header{
          display:flex;
          justify-content:space-between;
          align-items:flex-end;
          gap:12px;
          margin: 4px 0 12px 0;
        }
        .ops-h-title{
          font-size:16px;
          font-weight:800;
          color:#111827;
          margin:0;
        }
        .ops-h-sub{
          margin-top:4px;
          font-size:12px;
          color:#6b7280;
        }
        .ops-grid{
          display:flex;
          flex-wrap:wrap;
          gap:12px;
        }
        .ops-card{
          flex: 1 1 420px;
          border:1px solid #e5e7eb;
          border-radius:16px;
          background:#ffffff;
          padding:14px;
          box-shadow:0 10px 22px rgba(0,0,0,0.06);
        }
        .ops-card-h{
          display:flex;
          justify-content:space-between;
          gap:12px;
          margin-bottom:10px;
        }
        .ops-title{
          font-size:14px;
          font-weight:900;
          color:#111827;
          margin-bottom:2px;
        }
        .ops-subtitle{
          font-size:12px;
          color:#6b7280;
        }
        .ops-body{
          border-top:1px dashed #e5e7eb;
          padding-top:10px;
        }
        .ops-footer{
          margin-top:12px;
          font-size:12px;
          color:#6b7280;
          border-top:1px solid #eef2f7;
          padding-top:10px;
        }
      </style>

      <div class="ops-wrap">
        <div class="ops-header">
          <div>
            <div class="ops-h-title">Operations Controls</div>
            <div class="ops-h-sub">Each card has a single toggle button. Changes apply immediately.</div>
          </div>
        </div>

        <div class="ops-grid">
          ${fulfillmentCard}
          ${invoiceCard}
        </div>
      </div>

      <script>
        window.OpsControls = window.OpsControls || {};
        window.OpsControls.doAction = function(action) {
          try {
            if (!action || action === 'NOOP') return;

            var msg = "Apply action: " + action + "?";
            if (action === 'FULFILL_ON') msg = "Turn ON the Fulfillment MR (deploy + scheduled)?";
            if (action === 'FULFILL_OFF') msg = "Turn OFF the Fulfillment MR (undeploy + not scheduled)?";
            if (action === 'INVOICE_ON') msg = "Turn ON the Invoice Creator MR (deploy + scheduled)?";
            if (action === 'INVOICE_OFF') msg = "Turn OFF the Invoice Creator MR (undeploy + not scheduled)?";

            if (!confirm(msg)) return;

            var el = document.getElementById('custpage_action');
            if (el) el.value = action;

            var forms = document.getElementsByTagName('form');
            if (forms && forms.length) forms[0].submit();
          } catch (e) {
            alert("Could not submit action: " + (e && e.message ? e.message : e));
          }
        };
      </script>
    `;

    context.response.writePage(form);
  }

  function onRequest(context) {
    try {
      if (context.request.method === "POST") {
        const action = context.request.parameters.custpage_action || "";

        if (action === "FULFILL_ON")
          setDeploymentState(DEPLOY_FULFILLMENT_ID, true);
        else if (action === "FULFILL_OFF")
          setDeploymentState(DEPLOY_FULFILLMENT_ID, false);
        else if (action === "INVOICE_ON")
          setDeploymentState(DEPLOY_INVOICE_ID, true);
        else if (action === "INVOICE_OFF")
          setDeploymentState(DEPLOY_INVOICE_ID, false);

        return redirect.toSuitelet({
          scriptId: runtime.getCurrentScript().id,
          deploymentId: runtime.getCurrentScript().deploymentId,
          parameters: {},
        });
      }

      return renderForm(context);
    } catch (e) {
      log.error("Operations Controls Error", e);
      const form = serverWidget.createForm({
        title: "Operations Controls - Error",
      });
      const f = form.addField({
        id: "custpage_err",
        type: serverWidget.FieldType.INLINEHTML,
        label: " ",
      });
      f.defaultValue = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#842029;background:#f8d7da;border:1px solid #f5c2c7;padding:12px;border-radius:12px;">
        <b>Error:</b> ${String(e.message || e)}
      </div>`;
      context.response.writePage(form);
    }
  }

  return { onRequest };
});
