# Authenticated browser terminal design

## Multi-user trust boundary

The gateway is both the authentication point and trusted session manager. It alone can read session-to-container mappings. Browser input selects neither the session target nor the Docker image. Docker's Unix socket is accessible only to this component on the internal deployment host; user terminal containers receive no socket, no published port, no privileged mode, no added capabilities, and resource limits. `ttyd` only listens on the private `terminal-internal` network.

The local `MemorySessionStore` provides atomic launch consumption within one Node process. Restart loses state and protected access fails closed. Redis with authenticated TLS and atomic operations is required for persistence, high availability, or multiple gateway replicas.

## Flow

```text
orchestrator -- signed, expiring URL --> learner browser
learner browser -- GET /?terminal_token=... --> gateway
gateway -- verify HMAC + expiry; audit --> browser (HttpOnly cookie + clean redirect)
browser -- HTTP assets / WebSocket upgrade + cookie --> gateway --> internal ttyd
```

## Decisions

The orchestrator creates a short-lived HMAC-signed bearer token containing
`sid` (lab session), `exp`, and random `jti`. It sends the token only in the
launch URL. The gateway consumes the URL token, validates it, then uses the
same signed value in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie for the
asset requests and WebSocket upgrade that `ttyd` needs. This removes the token
from the visible address bar while preserving a one-click launch.

`ttyd` has no published host port. Only the gateway is externally reachable;
it validates every proxied HTTP request and every Upgrade request before
creating the upstream connection. Therefore discovering a former random port
does not confer shell access.

## Operational controls

- Use TLS in production; `Secure` cookies intentionally require it.
- Set the token TTL no longer than the lab session lifetime. The gateway
  independently enforces expiry, including for the WebSocket handshake.
- Add a session-status/revocation check by `sid` or `jti` where the
  orchestrator can terminate sessions early.
- Ship the JSON-lines audit log to central logging and alert on repeated
  rejected attempts. It includes reason, time, remote IP, request path and
  token/session identifiers only as SHA-256 hashes.
- Rotate the signing secret by accepting a key id (`kid`) and active/previous
  verification keys during a bounded transition.

## Acceptance checks

1. Launch a signed URL: terminal loads without a browser auth dialog.
2. Open `/` in a fresh browser profile: receive `401 terminal authentication required`.
3. Alter one token character or wait for expiry: receive `401` and an audit
   event with `invalid-token` or `expired-token`.
4. Attempt a WebSocket connection without the authenticated cookie: the
   gateway rejects the Upgrade before connecting to `ttyd`.
