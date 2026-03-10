# Security Audit — Aurral

## Context

Aurral is a self-hosted music discovery app intended to be internet-facing on the **frontend only** (port 3000). The backend (port 3001) should not be directly accessible. This audit prioritises issues exploitable via the frontend, though backend-only issues are noted separately.

**Confirmed secure (no action needed):** SQL injection (all parameterised queries), XSS (React auto-escapes all output, no unsafe HTML rendering used), command injection (no `child_process`), password hashing (bcrypt salt=10), MBID format validation.

---

## Part 1 — Issues

Legend: **F** = exploitable via frontend | **B** = backend-only (lower priority)

| # | Severity | Finding | Location | Scope |
|---|----------|---------|----------|-------|
| 1 | **CRITICAL** | Plaintext password stored in `localStorage` | `AuthContext.jsx:119`, `api.js:57,484` | F |
| 2 | **CRITICAL** | Credentials embedded as base64 in stream URL query string | `api.js:196-201` | F |
| 3 | **CRITICAL** | WebSocket accepts connections with no authentication | `websocketService.js:18-24` | F |
| 4 | **CRITICAL** | Settings router requires auth but not admin — any user can read/write all API keys. Compounded by #23: `buildPermissions` hardcodes `accessSettings: true` for all non-admin users, so permission checks pass regardless of stored permissions. | `settings.js:8`, `auth.js:69` | F |
| 5 | **CRITICAL** | `GET /api/requests` has no auth — full download queue and history visible to anyone | `requests.js:44` | F |
| 6 | **CRITICAL** | All discovery preference endpoints have no auth — unauthenticated write to global in-memory state | `discovery.js:434,438,459,467,490,510,535` | F |
| 7 | **HIGH** | `DELETE /api/requests/album/:id` and `DELETE /api/requests/:mbid` missing auth | `requests.js:354,387` | F |
| 8 | **HIGH** | SSRF — integration test endpoints make HTTP requests to user-supplied URLs with no validation | `settings.js:138-184,241-316`, `onboarding.js:19-48,53-68` | F |
| 9 | **HIGH** | CORS allows all origins (`cors()` with no config) | `server.js:58` | F |
| 10 | **HIGH** | CSP disabled and `X-Frame-Options` disabled in helmet config | `server.js:60-63` | F |
| 11 | **HIGH** | Stream auth bypass matches any path containing `/stream/`, not only the intended stream routes | `auth.js:201-202` | F |
| 12 | **HIGH** | Proxy auth defaults to allowing all requests when `AUTH_PROXY_TRUSTED_IPS` is not configured | `auth.js:49` | F |
| 13 | **HIGH** | Encryption key stored in the same SQLite table as the encrypted settings it protects | `db-helpers.js:189-197` | B |
| 14 | **MEDIUM** | Lidarr HTTP client has TLS certificate validation disabled (`rejectUnauthorized: false`). The insecure agent is gated by an `insecure` config flag (`lidarrClient.js:99,254`) — the risk is that it can be enabled silently, not that it is on by default. | `lidarrClient.js:39-40,254` | F (MITM) |
| 15 | **HIGH** | `PUT /api/library/albums/:id` has no auth — unauthenticated album monitoring state modification | `library/handlers/albums.js:119` | F |
| 16 | **HIGH** | `POST /api/library/artists/:mbid/refresh` has no auth — unauthenticated Lidarr refresh trigger | `library/handlers/artists.js:339` | F |
| 17 | **MEDIUM** | No rate limiting on login — global limit is 5,000 req / 15 min | `server.js:69-72` | F |
| 18 | **MEDIUM** | No password strength validation at onboarding or user creation | `onboarding.js`, `users.js` | F |
| 19 | **MEDIUM** | Error responses leak `error.message` and internal details | `settings.js:96,180,236,314`, `health.js:92`, `discovery.js:453`, and others | F |
| 20 | **MEDIUM** | MusicBrainz `User-Agent` built from unsanitised settings value — HTTP header injection if email contains `\r\n` | `apiClients.js:90-92,357-359,392-394` | F (via settings write) |
| 21 | **LOW** | No audit logging for auth events, settings changes, or user management | — | — |
| 22 | **LOW** | `GET /api/health/ws` exposes WebSocket operational stats (client count, channel subscriptions) without auth | `health.js:98` | F |
| 23 | **HIGH** | `buildPermissions` hardcodes `accessSettings: true` for every non-admin user regardless of stored permissions — breaks the permission system for that field | `auth.js:69` | F |
| 24 | **MEDIUM** | `GET /api/health` (intentionally public) leaks operational metadata to unauthenticated callers: `appVersion`, `lidarrConfigured`, `lastfmConfigured`, `musicbrainzConfigured`, `library.artistCount`, `discovery.*` counts, `websocket.clients/channels` | `health.js:33-88` | F |
| 25 | **LOW** | Race condition in settings SSRF test endpoints: shared `lidarrClient.config` is mutated inside `try/finally` blocks containing `await` calls, allowing concurrent requests to observe each other's test URLs | `settings.js:159-174,211-227,272-308` | B |

---

## Part 2 — Implementation Plan

### Phase 1 — Session Token Auth (Fixes #1, #2, #3, #11)

Replaces plaintext credential storage with opaque server-issued tokens. This is the foundational change.

**1A. `backend/config/db-sqlite.js`** — Add `sessions` table:
`(id, user_id, token TEXT UNIQUE, created_at, expires_at, ip_address, user_agent)`
Token = `crypto.randomBytes(32).toString('hex')`. Default TTL: 24h (env `SESSION_EXPIRY_HOURS`).

**1B. NEW `backend/config/session-helpers.js`** — `createSession`, `getSessionByToken` (JOIN users, check expiry), `deleteSession`, `deleteSessionsByUserId`, `cleanExpiredSessions`.

**1C. NEW `backend/routes/auth.js`** — Three endpoints:
- `POST /api/auth/login` — bcrypt verify → create session → return `{ token, expiresAt, user }`
- `POST /api/auth/logout` — delete session by token
- `GET /api/auth/me` — validate token → return user

Register in `server.js`. Add `/api/auth/login` to auth middleware public paths.

**1D. `backend/middleware/auth.js`** — Three changes:
- Add Bearer token resolution in `resolveRequestUser()`: check `Authorization: Bearer <token>` first, then fall back to Basic auth (backward compat for API/scripts)
- Narrow stream bypass (line 201-202): the current bypass covers two routes — `/api/library/stream/:id` (via `includes("/stream/")`) and `/api/artists/:mbid/stream` (via `endsWith("/stream")`). Replace both conditions with two explicit regexes: `/^\/library\/stream\/[^/]+$/.test(req.path) || /^\/artists\/[a-f0-9-]{36}\/stream$/.test(req.path)`. (Alternatively, remove the global bypass entirely once stream handlers call `verifyTokenAuth` themselves.)
- Update `getCredentialsFromRequest()` (line 245-258): replace the `?token=` base64-decode branch with a session token lookup via `getSessionByToken()`. Required for both stream handlers (`library/handlers/stream.js:8` and `artists/handlers/stream.js:33`) which call `verifyTokenAuth()` → `getCredentialsFromRequest()` for query-string token auth.

**1E. `frontend/src/contexts/AuthContext.jsx`** — `login()` calls `POST /api/auth/login`, stores `auth_token`. Never stores password. `checkAuthStatus()` validates token via `GET /api/auth/me`. `logout()` calls `POST /api/auth/logout`, clears `auth_token`. Remove all `auth_password` storage.

**1F. `frontend/src/utils/api.js`** — Request interceptor sends `Authorization: Bearer <token>`. `getStreamUrl()` appends `?token=<session_token>` (opaque token, not credentials). Remove `localStorage.setItem("auth_password", ...)` from `changeMyPassword` (line 484). Add `loginApi`, `logoutApi`, `getMe` helpers.

**1G. `backend/services/websocketService.js`** — In `handleConnection()`, parse `?token=` from upgrade request URL, validate via `getSessionByToken`. If auth is required and the token is invalid or absent, close the connection with code `4401`.

**1H. `frontend/src/hooks/useWebSocket.js`** — Append `?token=<auth_token>` to WS URL.

**1I. `server.js`** — Add `setInterval(cleanExpiredSessions, 60 * 60 * 1000)` for session cleanup.

**Backward compatibility:** Keep Basic auth support in the middleware for API consumers/scripts. Frontend users with stale `auth_password` in `localStorage` get redirected to login via the existing 401 → logout flow.

---

### Phase 2 — Route Permission Enforcement (Fixes #4, #5, #6, #7, #15, #16, #22, #23, #24)

**2A. `backend/routes/settings.js` line 8** — Change `router.use(requireAuth)` to `router.use(requireAuth, requireAdmin)`. The entire settings router is admin-only.

**2B. `backend/middleware/auth.js` line 69** — Fix `buildPermissions`: change `accessSettings: true` to `accessSettings: false`. The hardcoded `true` overrides any spread from `permissions || {}`, forcing settings access for every non-admin user regardless of stored permissions.

**2C. `backend/routes/requests.js`:**
- Line 44: add `requireAuth` to the `GET /` handler
- Line 354: add `requireAuth, requirePermission('deleteAlbum')`
- Line 387: add `requireAuth, requirePermission('deleteArtist')`

**2D. `backend/routes/discovery.js`** — Add auth to all unprotected routes:
- Lines 26, 41, 47 (`POST /refresh`, `/clear`, `/clear-discovery`): add `requireAdmin`
- Line 72 (`GET /` — main recommendations): add `requireAuth` (defence-in-depth; global middleware already protects when auth is configured, but route-level guards are consistent with the rest of Phase 2)
- Line 434 (`GET /preferences`): add `requireAuth`
- Lines 438, 459, 467, 490, 510, 535 (all preference mutation routes): add `requireAuth`

**2E. `backend/routes/library/handlers/albums.js` line 119** — Add `requireAuth, requirePermission('changeMonitoring')` to `PUT /albums/:id`. The surrounding `POST` and `DELETE` handlers are already protected; `PUT` was missed.

**2F. `backend/routes/library/handlers/artists.js` line 339** — Add `requireAuth` to `POST /artists/:mbid/refresh`. No specific permission is needed, but triggering Lidarr refresh operations must require login.

**2G. `backend/routes/health.js`** — Two changes:
- Line 98 (`GET /ws`): add `requireAuth`.
- Lines 50-87 (`GET /` public response): scope the response to the minimum contract the frontend requires when unauthenticated: `{ status, onboardingRequired, authRequired, authUser, timestamp }`. Move `appVersion`, `lidarrConfigured`, `lastfmConfigured`, `musicbrainzConfigured`, `library`, `discovery`, and `websocket` fields into the authenticated block (`if (currentUser) { ... }`). `GET /api/health` must remain publicly accessible — only its payload is trimmed.

---

### Phase 3 — Server Hardening (Fixes #8, #9, #10, #12, #14, #17)

**3A. NEW `backend/middleware/urlValidator.js`** — `validateExternalUrl(url)`:
- Reject non-`http(s)` schemes
- Always block `169.254.169.254` (cloud metadata endpoint)
- Block private/loopback ranges unless `ALLOW_LOCAL_URLS=true` (default `true` — self-hosted apps legitimately target LAN services)
- Apply to: `settings.js` (Lidarr profiles/test, Gotify test), `onboarding.js` (Lidarr test, Navidrome test)

**3B. `server.js` line 58** — Replace `cors()` with `cors({ origin: process.env.CORS_ORIGIN || false })`. Default = same-origin only.

**3C. `server.js` lines 59-64** — Enable helmet with CSP and frameguard:
- `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (Tailwind requires inline styles)
- `img-src 'self' data: https://*.deezer.com https://coverartarchive.org https://*.last.fm https://lastfm.freetls.fastly.net`
- `connect-src 'self' ws: wss:`
- `media-src 'self'` (required for the `<audio>` stream player)
- `frame-src 'none'`
- `frameguard: { action: 'deny' }`

**3D. `server.js`** — Add strict auth rate limiter: 10 attempts / 15 min / IP, applied only to `POST /api/auth/login` and `POST /api/users/me/password`.

**3E. `backend/middleware/auth.js` line 49** — `isTrustedProxy`: return `false` when `AUTH_PROXY_TRUSTED_IPS` is empty. Current default-allow behaviour is a complete auth bypass for proxy-auth deployments.

**3F. `backend/services/lidarrClient.js` line 40** — The `rejectUnauthorized: false` agent is already gated by an `insecure` config flag (line 99 reads it; line 254 selects the insecure agent only when `this.config.insecure === true`). No guard needs to be added. The only change: emit a prominent warning during `updateConfig()` when `insecure` is enabled:
```
[SECURITY WARNING] Lidarr SSL certificate verification is DISABLED. Connections are vulnerable to MITM attacks.
```
Do not remove the option — users with self-signed certs on LAN Lidarr instances need it — but make the risk visible.

**3G. (Fixes #25) `backend/routes/settings.js`** — Apply `validateExternalUrl()` (from 3A) to the test endpoints before mutating `lidarrClient.config`, not after. This ensures invalid URLs are rejected without touching shared state. The mutation-in-try/finally pattern remains, but the race condition's security surface is reduced because malicious URLs are rejected upfront.

---

### Phase 4 — Input Validation & Error Sanitisation (Fixes #18, #19, #20)

**4A. NEW `backend/middleware/validation.js`** — `requirePasswordStrength`: reject passwords shorter than 8 characters. Apply in `onboarding.js` (`POST /complete`) and `users.js` (`POST /` create, `POST /me/password` change, and `PATCH /:id` — the admin update path at line 81 also accepts a `password` field without length validation).

**4B. `server.js`** — Add global error handler as final middleware. Remove `error.message` / `error.stack` from all `res.status(500).json(...)` calls in route files (`settings.js:96,180,236,314`, `health.js:92`, `discovery.js:453`, and others). Log full errors server-side only.

**4C. `backend/services/apiClients.js` lines 90-92, 357-359, 392-394** — Strip control characters from the MusicBrainz contact value before constructing the User-Agent header:
```js
const contact = (getMusicBrainzContact() || '').trim().replace(/[\r\n\x00-\x1f\x7f]/g, '');
```

---

### Phase 5 — Encryption Key Separation (Fixes #13) — Backend-only, lower priority

**5A. `backend/config/db-helpers.js`** — Read encryption key from `ENCRYPTION_KEY` env var (64-char hex = 32 bytes). If the env var is absent, fall back to the existing DB-stored key for backward compatibility. Document in `.env.example` that setting `ENCRYPTION_KEY` properly separates the key from the data it protects.

---

### Phase 6 — Audit Logging (Optional / #21)

Add `audit_log` table: `(id, user_id, action, detail, ip, timestamp)`. Log login success/failure, logout, settings changes, user CRUD, and password changes. Expose `GET /api/settings/audit-log` (admin-only).

---

## Files Modified

| File | Phase | Change |
|------|-------|--------|
| `backend/config/db-sqlite.js` | 1A | Add `sessions` table |
| **NEW** `backend/config/session-helpers.js` | 1B | Session CRUD |
| **NEW** `backend/routes/auth.js` | 1C | Login / logout / me |
| `server.js` | 1C, 1I, 3B, 3C, 3D, 4B | Auth router, cleanup, CORS, helmet, rate limiter, error handler |
| `backend/middleware/auth.js` | 1D, 2B, 3E | Bearer token support, narrow stream bypass, update `getCredentialsFromRequest` for session tokens, fix `buildPermissions` `accessSettings` bug, proxy default-deny |
| `frontend/src/contexts/AuthContext.jsx` | 1E | Token-based auth, remove password storage |
| `frontend/src/utils/api.js` | 1F | Bearer token, stream URL fix, remove password storage |
| `backend/services/websocketService.js` | 1G | Auth on WS connection |
| `frontend/src/hooks/useWebSocket.js` | 1H | Pass token in WS URL |
| `backend/routes/settings.js` | 2A, 3A, 4B | `requireAdmin`, SSRF validation, sanitise errors |
| `backend/routes/requests.js` | 2C | `requireAuth` on GET, `requirePermission` on DELETEs |
| `backend/routes/discovery.js` | 2D, 4B | `requireAuth` on `GET /` and all preference routes, `requireAdmin` on admin routes, sanitise errors |
| `backend/routes/library/handlers/albums.js` | 2E | `requireAuth + requirePermission("changeMonitoring")` on `PUT /albums/:id` |
| `backend/routes/library/handlers/artists.js` | 2F | `requireAuth` on `POST /artists/:mbid/refresh` |
| `backend/routes/health.js` | 2G | `requireAuth` on `/ws` sub-route; trim operational metadata from unauthenticated `GET /` response |
| **NEW** `backend/middleware/urlValidator.js` | 3A | SSRF URL validation |
| `backend/routes/onboarding.js` | 3A, 4A | SSRF validation, password strength |
| `backend/services/lidarrClient.js` | 3F | SSL warning log |
| **NEW** `backend/middleware/validation.js` | 4A | Password strength check |
| `backend/routes/users.js` | 4A | Password strength on create/change/admin-update |
| `backend/services/apiClients.js` | 4C | Sanitise User-Agent contact value |
| `backend/config/db-helpers.js` | 5A | Env-var encryption key with DB fallback |

---

## Verification

1. **Phase 1**: `localStorage` has `auth_token` but no `auth_password`. Unauthenticated WS upgrade gets close code `4401`. Stream URLs use opaque session token (not base64 credentials). Both `/api/library/stream/:id` and `/api/artists/:mbid/stream` authenticate correctly via `?token=`. Token survives page refresh; expired/invalid token redirects to login.
2. **Phase 2**: `GET /api/requests` returns 401 without auth. Non-admin user gets 403 on `POST /api/settings`, `POST /api/discover/refresh`, `DELETE /api/requests/*`. `PUT /api/library/albums/:id` and `POST /api/library/artists/:mbid/refresh` return 401 without auth. `GET /api/health/ws` returns 401 without auth. `GET /api/health` returns 200 with only `{ status, onboardingRequired, authRequired, authUser, timestamp }` when unauthenticated. Non-admin user's `permissions.accessSettings` is `false`; Settings nav item is hidden.
3. **Phase 3**: `curl -I` shows `Content-Security-Policy` (including `media-src 'self'`) and `X-Frame-Options: DENY`. CORS rejects cross-origin requests. Login is rate-limited after 10 attempts. SSRF blocked for cloud metadata IP. Proxy auth rejects without `AUTH_PROXY_TRUSTED_IPS`. Log shows warning when `insecure: true` is set in Lidarr config.
4. **Phase 4**: Short password rejected at onboarding, user creation, and admin password update (`PATCH /:id`). Error responses contain only `"Internal server error"`. User-Agent is safe with injected newlines in the email setting.
5. **Phase 5**: App starts and decrypts settings using env-var key; existing installs migrate transparently without it set.
