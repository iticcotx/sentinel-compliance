// Sends a single templated provider email via Gmail (same creds as the digest).
// TEST MODE: recipient is forced to TEMPLATE_TEST_TO (default imadaijaz2000@gmail.com),
// so nothing reaches real providers until we flip that env var on purpose.
const nodemailer = require("nodemailer");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, message: "POST only" }); return; }

  let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
  let b = {}; try { b = JSON.parse(raw || "{}"); } catch (e) {}
  const subject = String(b.subject || "WCGTX Credentialing").slice(0, 250);
  const html = b.html || "";
  const text = b.text || "";

  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.TEMPLATE_TEST_TO || "imadaijaz2000@gmail.com";   // TEST: always to Imad
  if (!user || !pass) { res.status(200).json({ ok: false, message: "Set GMAIL_USER and GMAIL_APP_PASSWORD in Vercel env vars." }); return; }
  if (!html && !text) { res.status(200).json({ ok: false, message: "empty email body" }); return; }

  const wrapped = '<div style="max-width:680px;margin:auto">' +
    '<div style="background:linear-gradient(135deg,#14b8a6,#0f766e);color:#fff;padding:14px 20px;border-radius:12px 12px 0 0;font:600 13px Segoe UI,Arial,sans-serif;letter-spacing:1.5px">SENTINEL · WCGTX CREDENTIALING &nbsp;—&nbsp; TEST</div>' +
    '<div style="border:1px solid #e6ebf1;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px">' + html +
    '<p style="color:#94a3b8;font-size:11px;margin-top:20px">🧪 Test send — in production this would go to the provider. Sent by Sentinel.</p></div></div>';

  try {
    const t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await t.sendMail({ from: user, to, subject: "[TEST] " + subject, html: wrapped, text });
    res.status(200).json({ ok: true, to });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
