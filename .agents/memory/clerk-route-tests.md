---
name: Clerk route tests
description: Testing authenticated Express routes that call Clerk's getAuth helper directly.
---

When a test app bypasses Clerk middleware but exercises routes that call `getAuth`, the mock `req.auth` function must use the `Symbol.for("@clerk/express.auth")` brand and return a Clerk-compatible authenticated session object. `tokenType: "session_token"` and the top-level `userId` field are required for accepted signed-in test requests.

**Why:** Clerk rejects unbranded auth handlers and treats unknown token types as signed out, so ordinary identity-shaped test data can silently produce 401s instead of reaching route authorization.

**How to apply:** Use a test-only middleware that attaches the branded handler to requests; keep unauthenticated cases returning a null user ID. Do not bypass route-level authentication checks in the tests.
