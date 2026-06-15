// Start Microsoft staff sign-in. Tenant-specific endpoint => only wcgtx.com users.
module.exports = async (req, res) => {
  const tenant = process.env.MS_TENANT_ID, cid = process.env.MS_CLIENT_ID;
  if (!tenant || !cid) { res.status(500).send("Auth not configured."); return; }
  const redirect = "https://sentinel-compliance-kappa.vercel.app/api/auth-callback";
  const p = new URLSearchParams({
    client_id: cid, response_type: "code", redirect_uri: redirect,
    response_mode: "query", scope: "openid profile email User.Read", prompt: "select_account"
  });
  res.writeHead(302, { Location: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/authorize?" + p.toString() });
  res.end();
};
