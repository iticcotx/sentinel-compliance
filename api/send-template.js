// Sends a single templated provider email (preview goes to the signed-in staff member's
// own inbox). Sent via the Gmail SMTP relay; recipient = the logged-in wcgtx account.
const nodemailer = require("nodemailer");
const { getSession } = require("../lib/session");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, message: "POST only" }); return; }

  const s = getSession(req);
  if (!s) { res.status(401).json({ ok: false, message: "sign-in required" }); return; }

  let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
  let b = {}; try { b = JSON.parse(raw || "{}"); } catch (e) {}
  const subject = String(b.subject || "WCGTX Credentialing").slice(0, 250);
  const html = b.html || "";
  const text = b.text || "";

  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  // Send to the provider's email when given (Email provider); otherwise the signed-in user.
  const to = (b.to && /^\S+@\S+\.\S+$/.test(String(b.to).trim())) ? String(b.to).trim() : s.email;
  if (!user || !pass) { res.status(200).json({ ok: false, message: "Set GMAIL_USER and GMAIL_APP_PASSWORD in Vercel env vars." }); return; }
  if (!html && !text) { res.status(200).json({ ok: false, message: "empty email body" }); return; }

  const wrapped = '<div style="max-width:680px;margin:auto;border:1px solid #e6ebf1;border-radius:12px;padding:22px 24px">' + html + '</div>';

  try {
    const t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await t.sendMail({ from: user, to, subject, html: wrapped, text });
    res.status(200).json({ ok: true, to });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
