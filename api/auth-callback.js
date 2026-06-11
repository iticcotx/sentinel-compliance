// Microsoft redirects here after sign-in with ?code=...
// We trade the code for tokens and SHOW the refresh token so it can be pasted
// into the Vercel env var MS_REFRESH_TOKEN. (Shown once; it is sensitive.)
const { exchangeCode } = require("../lib/graph");

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sentinel sign-in</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:40px auto;padding:0 18px;color:#0f172a;line-height:1.5">
<h2 style="color:#0f766e">${title}</h2>${body}</body></html>`;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const url = new URL(req.url, "http://localhost");
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (err) {
    const adminWall = /admin|consent|AADSTS65001|AADSTS90094/i.test(err);
    res.status(200).send(page("Sign-in didn’t complete",
      `<p>${esc(err)}</p>` +
      (adminWall ? `<p><b>This looks like your organization requires an admin to approve.</b> Send this whole message to Imad — we may need a Microsoft 365 admin after all.</p>` : `<p>Please try the sign-in link again, or send this message to Imad.</p>`)));
    return;
  }
  if (!code) { res.status(200).send(page("Missing sign-in code", "<p>No authorization code came back. Please open the sign-in link again.</p>")); return; }

  try {
    const j = await exchangeCode(code);
    const rt = j.refresh_token;
    if (!rt) { res.status(200).send(page("Almost — but no token", "<p>Sign-in worked but no refresh token came back. Tell Imad (the app may need the <code>offline_access</code> permission).</p>")); return; }
    res.status(200).send(page("✅ Signed in — one thing left",
      `<p>It worked. <b>Copy the entire box below</b> and send it to Imad. After he saves it, document uploads will start landing in OneDrive. You can then close this page.</p>
<textarea readonly onclick="this.select()" style="width:100%;height:140px;font-family:monospace;font-size:12px;padding:10px;border:1px solid #cbd5e1;border-radius:8px">${esc(rt)}</textarea>
<p style="color:#64748b;font-size:13px;margin-top:14px">Treat this like a password — it lets the app save files to your OneDrive. Only send it to Imad.</p>`));
  } catch (e) {
    res.status(200).send(page("Sign-in problem", `<p>${esc(String(e.message || e))}</p><p>Send this to Imad.</p>`));
  }
};
