// Digest email. GET = scheduled daily digest (Vercel Cron) for all scopes.
// POST {scopes:[...]} = on-demand "Email me" from the dashboard for chosen tabs.
// Both send to MAIL_TO (default GMAIL_USER). Merged with the old /api/send.
const nodemailer = require("nodemailer");
const data = require("../data.json");

function color(s) { return s === "EXPIRED" ? "#dc2626" : s === "CRITICAL" ? "#ea580c" : s === "DUE SOON" ? "#ca8a04" : "#0d9488"; }

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  let scopes = ["provider", "facility", "other"];
  let onDemand = false;
  if (req.method === "POST") {
    onDemand = true;
    let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    try { const b = JSON.parse(raw || "{}"); if (Array.isArray(b.scopes) && b.scopes.length) scopes = b.scopes; } catch (e) {}
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = [];
  for (const it of (data.items || [])) {
    if (it.active === false) continue;
    if (!scopes.includes(it.scope)) continue;
    if (!it.expires) continue;
    const e = new Date(it.expires); if (isNaN(e)) continue;
    const days = Math.floor((e - today) / 86400000);
    if (days > 90) continue;
    rows.push({ cat: it.category, entity: it.entity, exp: e, days, status: days < 0 ? "EXPIRED" : days <= 30 ? "CRITICAL" : "DUE SOON" });
  }
  rows.sort((a, b) => a.days - b.days);
  const nE = rows.filter(r => r.status === "EXPIRED").length;
  const nC = rows.filter(r => r.status === "CRITICAL").length;
  const nD = rows.filter(r => r.status === "DUE SOON").length;
  const stamp = today.toDateString();

  const trs = rows.map(r => {
    const c = color(r.status), when = r.days < 0 ? Math.abs(r.days) + "d ago" : "in " + r.days + "d";
    return `<tr><td style='padding:7px 10px;border-bottom:1px solid #eee'><b>${r.cat}</b><br><span style='color:#777;font-size:12px'>${r.entity}</span></td>
      <td style='padding:7px 10px;border-bottom:1px solid #eee'>${r.exp.toDateString()}</td>
      <td style='padding:7px 10px;border-bottom:1px solid #eee;color:${c};font-weight:700'>${when}</td>
      <td style='padding:7px 10px;border-bottom:1px solid #eee'><span style='background:${c};color:#fff;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700'>${r.status}</span></td></tr>`;
  }).join("");

  const html = `<div style='font-family:Segoe UI,Arial,sans-serif;max-width:760px;margin:auto;color:#0f172a'>
    <div style='background:linear-gradient(135deg,#14b8a6,#0f766e);color:#fff;padding:22px 26px;border-radius:14px 14px 0 0'>
      <div style='font-size:13px;letter-spacing:2px;opacity:.85'>SENTINEL · COMPLIANCE DIGEST</div>
      <div style='font-size:22px;font-weight:800;margin-top:4px'>${stamp}</div></div>
    <div style='border:1px solid #e6ebf1;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px'>
      <p style='font-size:15px'><b style='color:#dc2626'>${nE} expired</b> &middot; <b style='color:#ea580c'>${nC} critical</b> &middot; <b style='color:#ca8a04'>${nD} due soon</b></p>
      ${rows.length ? `<table style='border-collapse:collapse;width:100%;font-size:14px'><thead><tr style='text-align:left;color:#475569;font-size:12px;text-transform:uppercase'><th style='padding:7px 10px'>Item</th><th style='padding:7px 10px'>Expires</th><th style='padding:7px 10px'>Countdown</th><th style='padding:7px 10px'>Status</th></tr></thead><tbody>${trs}</tbody></table>` : "<p style='color:#059669;font-weight:700'>All clear — nothing expiring within 90 days.</p>"}
      <p style='color:#94a3b8;font-size:12px;margin-top:22px'>${onDemand ? "Sent from Sentinel." : "Automatic daily digest from Sentinel."}</p></div></div>`;

  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.MAIL_TO || user;
  if (!user || !pass) { res.status(200).json({ ok: false, message: "Set GMAIL_USER and GMAIL_APP_PASSWORD in Vercel env vars." }); return; }
  try {
    const t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await t.sendMail({ from: user, to, subject: `Sentinel digest — ${nE} expired, ${nC} critical, ${nD} due`, html });
    res.status(200).json({ ok: true, to, counts: { expired: nE, critical: nC, due: nD } });
  } catch (e) { res.status(200).json({ ok: false, message: String(e.message || e) }); }
};
