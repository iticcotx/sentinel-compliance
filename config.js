/* ============================================================================
   SENTINEL — Access configuration
   ----------------------------------------------------------------------------
   Configured with the WCGTX master login. Only SHA-256 *hashes* are stored
   here (never the plain text). To change any code, lock the app and click
   "Reset access codes" on the login screen, or edit the hashes below.

   Current credentials:
     • Main login ID : iaijaz
     • Password      : 5052
     • Tab codes     : 5052  (Provider / Facility / Other — change anytime)

   SECURITY NOTE: a client-side gate in a static file is a DETERRENT, not true
   security — anyone who opens this file can read the hashes and brute-force a
   weak code offline. See the "Security" section of USAGE_GUIDE.md for the
   properly-secured (M365 / Azure) option.
   ========================================================================== */
window.SENTINEL_CONFIG = {
  configured: true,
  loginIdHash: "1196357079196cdc51029f53127262bb30a1e347b44d9189238c1ccbd8df4d8c", // iaijaz
  loginPwHash: "a4e95083ad6163ab0961e8e0d2caeceb402a089352e21a0c32233ef4c0423aeb", // 5052
  tabHashes: {
    provider: "a4e95083ad6163ab0961e8e0d2caeceb402a089352e21a0c32233ef4c0423aeb", // 5052
    facility: "a4e95083ad6163ab0961e8e0d2caeceb402a089352e21a0c32233ef4c0423aeb", // 5052
    other:    "a4e95083ad6163ab0961e8e0d2caeceb402a089352e21a0c32233ef4c0423aeb"  // 5052
  },
  // Extra staff/viewer logins (managed via the "Staff logins" link, or add here).
  // Each: { label, idHash, pwHash, tabs:["provider","facility","other"], readonly:false }
  users: []
};
