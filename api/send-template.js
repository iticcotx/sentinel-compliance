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

  const wrapped = '<div style="max-width:680px;margin:auto;border:1px solid #e6ebf1;border-radius:12px;padding:22px 24px">' + html + '</div>';

  try {
    const t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await t.sendMail({ from: user, to, subject, html: wrapped, text });
    res.status(200).json({ ok: true, to });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
