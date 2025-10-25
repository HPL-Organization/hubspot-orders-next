/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/ui/serverWidget", "N/search", "N/runtime"], function (
  ui,
  search,
  runtime
) {
  function n(x) {
    var v = Number(x);
    return isNaN(v) ? 0 : v;
  }
  function fmt(x) {
    var v = n(x);
    var s = String(v);
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }

  function runGlobal() {
    var cols = [
      "internalid",
      "itemid",
      search.createColumn({ name: "memberitem" }),
      search.createColumn({ name: "memberquantity" }),
      search.createColumn({ name: "quantityavailable", join: "memberitem" }),
      search.createColumn({ name: "itemid", join: "memberitem" }),
    ];
    var s = search.create({
      type: "item",
      filters: [["type", "anyof", "Kit"]],
      columns: cols,
    });
    var paged = s.runPaged({ pageSize: 1000 });

    var groups = new Map();
    paged.pageRanges.forEach(function (rg) {
      var pg = paged.fetch({ index: rg.index });
      pg.data.forEach(function (r) {
        var kitId = r.getValue("internalid");
        var kitName = r.getValue("itemid") || kitId;

        var memberInternalId = r.getValue({ name: "memberitem" });
        var memberSku = r.getValue({ name: "itemid", join: "memberitem" });
        var memberQty = n(r.getValue({ name: "memberquantity" }));
        if (!memberInternalId || memberQty <= 0) return;

        var avail = n(
          r.getValue({ name: "quantityavailable", join: "memberitem" })
        );
        var buildable = memberQty > 0 ? Math.floor(avail / memberQty) : 0;

        var key = kitId;
        if (!groups.has(key))
          groups.set(key, {
            kitId: kitId,
            kitName: kitName,
            rows: [],
            maxBuildable: 0,
          });
        groups.get(key).rows.push({
          memberSku: memberSku || memberInternalId,
          memberQty: memberQty,
          avail: avail,
          buildableFromThis: buildable,
        });
      });
    });

    groups.forEach(function (g) {
      var minv = null;
      g.rows.forEach(function (r) {
        minv =
          minv === null
            ? r.buildableFromThis
            : Math.min(minv, r.buildableFromThis);
      });
      g.maxBuildable = minv === null ? 0 : minv;
    });

    var out = Array.from(groups.values());
    out.sort(function (a, b) {
      return a.kitName.localeCompare(b.kitName);
    });
    return out;
  }

  function renderHTML(ctx, groups) {
    var html = [];
    html.push('<html><head><meta charset="utf-8">');
    html.push("<style>");
    html.push(
      "body{font-family:Inter,Arial,Helvetica,sans-serif;margin:20px;background:#fafafb;color:#1f1f1f}"
    );
    html.push(".report{max-width:1200px;margin:0 auto}");
    html.push(
      ".bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}"
    );
    html.push(".title{font-size:18px;font-weight:700}");
    html.push(
      ".actions button{margin-left:8px;border:1px solid #d9d9df;background:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;font-size:12px;color:#222}"
    );
    html.push(
      ".card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,0.05);margin-bottom:16px;overflow:hidden}"
    );
    html.push(
      ".grphead{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #eee;background:#f7f7f9}"
    );
    html.push(".grpmeta{display:flex;gap:12px;align-items:center}");
    html.push(
      ".pill{display:inline-block;background:#ecfdf5;color:#065f46;border:1px solid #d1fae5;padding:6px 14px;border-radius:999px;font-size:14px;font-weight:700}"
    );
    html.push(
      ".grpbtn{border:none;background:transparent;font-weight:600;cursor:pointer;font-size:12px;color:#374151}"
    );
    html.push("table{width:100%;border-collapse:separate;border-spacing:0}");
    html.push(
      "th{position:sticky;top:0;background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:12px 14px;text-align:left;font-weight:700;font-size:12px}"
    );
    html.push(
      "td{padding:14px 14px;border-bottom:1px solid #f3f4f6;font-size:13px;line-height:1.5}"
    );
    html.push("tbody tr:nth-child(even){background:#fbfbfd}");
    html.push(".num{text-align:right;font-variant-numeric:tabular-nums}");
    html.push("</style>");
    html.push("<script>");
    html.push(
      'function tg(id){var b=document.getElementById("b"+id);var t=document.getElementById("t"+id);if(!t||!b)return;var v=t.style.display==="none";t.style.display=v?"table-row-group":"none";b.innerText=v?"▾ Hide":"▸ Show";}'
    );
    html.push("function pr(){window.print();}");
    html.push("</script>");
    html.push('</head><body><div class="report">');

    html.push(
      '<div class="bar"><div class="title">Kit Component Availability — Global</div><div class="actions"><button onclick="pr()">Print</button></div></div>'
    );

    if (!groups.length) {
      html.push(
        '<div class="card"><div class="grphead"><div>No data found</div></div></div></div></body></html>'
      );
      ctx.response.write(html.join(""));
      return;
    }

    var idx = 0;
    groups.forEach(function (g) {
      idx++;
      var gid = String(idx);
      html.push('<div class="card">');
      html.push('<div class="grphead">');
      html.push("<div>" + g.kitName + "</div>");
      html.push(
        '<div class="grpmeta"><span class="pill">Max Kits Buildable: ' +
          fmt(g.maxBuildable) +
          '</span><button class="grpbtn" id="b' +
          gid +
          '" onclick="tg(\'' +
          gid +
          "')\">▸ Show</button></div>"
      );
      html.push("</div>");
      html.push("<table>");
      html.push(
        '<thead><tr><th style="width:56%">Member SKU</th><th class="num" style="width:16%">Per Kit Qty</th><th class="num" style="width:28%">Availability</th></tr></thead>'
      );
      html.push('<tbody id="t' + gid + '" style="display:none">');
      g.rows.forEach(function (r) {
        html.push("<tr>");
        html.push("<td>" + String(r.memberSku || "") + "</td>");
        html.push('<td class="num">' + fmt(r.memberQty) + "</td>");
        html.push('<td class="num">' + fmt(r.avail) + "</td>");
        html.push("</tr>");
      });
      html.push("</tbody></table></div>");
    });

    html.push("</div></body></html>");
    ctx.response.write(html.join(""));
  }

  function onRequest(ctx) {
    var groups = runGlobal();
    renderHTML(ctx, groups);
  }

  return { onRequest: onRequest };
});
