// Clear the session cookie and sign out of Microsoft too.
const { clearHeader } = require("../lib/session");
module.exports = (req, res) => {
  res.setHeader("Set-Cookie", clearHeader());
  const tenant = process.env.MS_TENANT_ID;
  const back = encodeURIComponent("https://sentinel-compliance-kappa.vercel.app/");
  res.writeHead(302, { Location: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/logout?post_logout_redirect_uri=" + back });
  res.end();
};
