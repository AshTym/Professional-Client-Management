---
name: ClientGuard AI workflow safeguards
description: Review and source-verification rules for ClientGuard's AI-assisted billing, document, and client-update workflows.
---

For ClientGuard, scheduled AI billing and matter-based client updates produce drafts for professional review; they must not be automatically sent. Document-derived calendar and task suggestions must include a source page and a verbatim quote verified against the extracted document text, and must be explicitly confirmed before becoming planner items. Document analysis is user-triggered.

**Why:** The user selected these three workflows and asked that document suggestions be confirmed against their source. Review and traceability protect client trust and reduce harm from AI errors.

**How to apply:** Preserve these safeguards in future AI workflow changes. Keep billing totals deterministic in application code, require human approval for generated communications and planner actions, and do not send or sync items externally unless the user explicitly requests it.
