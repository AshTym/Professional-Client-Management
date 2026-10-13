---
name: ClientGuard provider OAuth
description: Security rationale for firm-owned Google, Microsoft, Xero, and QuickBooks connections.
---

Each firm connects its own provider account through OAuth. Keep tokens encrypted at rest, bind every token and sync to its firm, and require review before sending client email or creating accounting records.

**Why:** The user chose per-firm provider connections, so a shared platform connector would not represent each firm's consent or isolate its data.

**How to apply:** Keep OAuth state one-use and time-limited, request only the scopes needed for selected calendar/email/accounting actions, and never expose access or refresh tokens to the client UI.

For provider writes, persist a firm-scoped idempotency key before creating the remote record. Use each provider's native idempotency or a stable remote marker; for email, save a draft and retain its provider ID before sending. If the response is ambiguous, mark the sync uncertain and reconcile that same request before any retry. Never blindly create a second record.

**Why:** A provider can accept a write even when ClientGuard loses the response, so a fresh retry can create duplicate events, invoices, or emails.

**How to apply:** Treat provider-specific retries differently where their guarantees vary; if the provider cannot prove whether a request succeeded, preserve the uncertain state and block new creates.
