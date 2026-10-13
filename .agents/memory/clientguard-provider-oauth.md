---
name: ClientGuard provider OAuth
description: Security rationale for firm-owned Google, Microsoft, Xero, and QuickBooks connections.
---

Each firm connects its own provider account through OAuth. Keep tokens encrypted at rest, bind every token and sync to its firm, and require review before sending client email or creating accounting records.

**Why:** The user chose per-firm provider connections, so a shared platform connector would not represent each firm's consent or isolate its data.

**How to apply:** Keep OAuth state one-use and time-limited, request only the scopes needed for selected calendar/email/accounting actions, and never expose access or refresh tokens to the client UI.
