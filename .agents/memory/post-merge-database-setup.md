---
name: Post-merge database setup
description: Timing and safety constraints for dependency installation and Drizzle schema pushes after task merges.
---

Keep the post-merge setup on the normal install, membership preflight, and non-forced Drizzle push path. On this workspace, a schema push can take around 100 seconds while workflows are also restarting; configure a three-minute timeout rather than treating a short timeout as a migration failure.

**Why:** a 20-second limit and then a two-minute limit interrupted valid setup runs. The regular push later completed successfully, while `push-force` would skip review of potentially destructive schema changes.

**How to apply:** keep sufficient timeout headroom for dependency and workflow startup. If a push stalls, diagnose it and retry the regular push; do not use a forced push just to make post-merge setup pass.
