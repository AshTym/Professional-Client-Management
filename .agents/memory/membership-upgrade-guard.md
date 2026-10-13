---
name: Membership upgrade guard
description: Keep membership uniqueness enforced between a duplicate preflight and the unique-index schema change.
---

When upgrading a membership table that does not yet have its unique index, take a write-blocking table lock before checking for duplicates and installing a temporary database trigger. The trigger must serialize writes per Clerk identity and reject duplicates until the unique index is committed. Keep the guard after failed upgrades; remove it only after confirming the index exists, and clean up a leftover guard on a later successful retry.

**Why:** a point-in-time preflight cannot prevent concurrent application writes from reintroducing conflicts while the schema push is running.

**How to apply:** use this pattern for schema rollout commands that introduce or rebuild the global Clerk-user membership unique index. Direct Drizzle CLI invocations bypass the coordinated guard.
