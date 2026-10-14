---
name: ClientGuard invitation uniqueness
description: Why invitation create and renewal share a firm-and-email lock.
---

Expired invitations stay stored so firm admins can renew their original record. A database unique index on pending invitations cannot safely distinguish expired from live rows using a moving current-time condition, so creation and renewal must serialize by workspace and normalized email, then check for another unaccepted, unrevoked, unexpired record before writing. Invitation sends also use this firm/email scope across old records so withdrawing or replacing an invitation cannot bypass its cooldown. A resend holds the advisory lock through the provider call to serialize sends, but must not hold the invitation row lock during that call so acceptance and withdrawal can still finish.

**Why:** A fresh invitation may be created while an expired record remains renewable; without serialization, a concurrent create and renewal can both become active. The scoped cooldown prevents duplicate provider traffic even across concurrent resend requests and invitation-record replacement, while keeping slow email delivery from blocking acceptance or withdrawal.

**How to apply:** Any future route that activates or renews an invitation must use the same workspace/email lock key and active-invitation definition. Preserve the resend lock boundary and calculate cooldown from the latest successful send for that firm and normalized email.
