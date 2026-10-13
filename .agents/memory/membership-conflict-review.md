---
name: Membership conflict review
description: Product rule for resolving duplicate firm memberships without disclosing information across firms.
---

For cross-firm duplicate membership conflicts, require an independent decision by an owner or admin of each affected firm. Each reviewer sees only that firm's membership and aggregate duplicate counts. Removing access removes only the local membership, preserves the firm's client and matter records, and records the decision in that firm's audit history.

**Why:** the user selected each affected firm's admin to approve the correction.

**How to apply:** use this boundary for membership repair, access review, and any future UI or API work that spans firms.

Assignment identity backfills use the shared database handle, so do not call them from a transaction after that transaction has locked client or matter rows. Run the backfill before the locking transaction, or make the helper accept and use the transaction handle.

**Why:** a separate connection can block on rows held by the transaction that is waiting for the backfill to finish.

**How to apply:** preserve this ordering in membership-removal and other flows that backfill legacy assignment labels before changing assignments.
