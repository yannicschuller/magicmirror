# Security policy

Please **do not** open a public issue for security problems. Report them privately via
[GitHub security advisories](https://github.com/yannicschuller/magicmirror/security/advisories/new) instead.
We aim to respond within a week.

## Design notes

- The mirror page (`/`) is public and read-only. Calendar, camera and waste URLs are stripped from the configuration it receives.
- The admin panel and its API require a signed-in user (local account or OIDC).
  - Passwords are hashed with scrypt.
  - Sessions are HMAC-signed cookies (`HttpOnly`, `SameSite=Lax`).
  - State-changing requests are checked against the request origin.
  - Failed logins are throttled.
- Cameras are proxied through the server. go2rtc is not exposed and credentials never reach the browser.
- The `kiosk` container runs **privileged** (it drives the display); the browser itself runs as an unprivileged user with its own sandbox and the `updater` container has access to the **Docker socket**. Only enable them on a device dedicated to the mirror.
- Expose the admin panel to the internet only behind HTTPS (reverse proxy with `TRUST_PROXY=true`).
