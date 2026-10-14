---
name: Ownership notice recovery
description: Reliability rule for ownership emails when database status writes fail.
---

Persist a retryable pending ownership-notice record atomically with the ownership change before contacting Clerk. On retries, commit a pending record before delivery, then isolate the final status write so its failure leaves the pending record recoverable. Show pending delivery as unconfirmed, not failed.

**Why:** email delivery cannot be rolled back, and the database may fail after Clerk has already accepted a message.

**How to apply:** preserve an auditable, retryable state before every external send; reuse the stable Clerk idempotency key when retrying an outcome that could not be recorded.
