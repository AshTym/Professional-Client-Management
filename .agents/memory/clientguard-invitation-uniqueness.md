---
name: ClientGuard invitation uniqueness
description: Why invitation create and renewal share a firm-and-email lock.
---

Expired invitations stay stored so firm admins can renew their original record. A database unique index on pending invitations cannot safely distinguish expired from live rows using a moving current-time condition, so creation and renewal must serialize by workspace and normalized email, then check for another unaccepted, unrevoked, unexpired record before writing.

**Why:** A fresh invitation may be created while an expired record remains renewable; without serialization, a concurrent create and renewal can both become active.

**How to apply:** Any future route that activates or renews an invitation must use the same workspace/email lock key and active-invitation definition.
