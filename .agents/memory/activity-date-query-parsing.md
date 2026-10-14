---
name: Activity date query parsing
description: Boundary handling for date-only query strings used by activity list and CSV filters.
---

Convert date-only HTTP query strings to valid UTC `Date` objects before applying the generated query schemas. Validate the calendar date strictly, and compare reversed ranges explicitly. Once parsed, use the resulting `Date` directly for database bounds; make an exclusive end bound by cloning it and advancing one UTC day.

**Why:** The generated OpenAPI/Zod query schemas represent `format: date` as `Date` values but do not coerce Express query strings. Rebuilding a timestamp from an already-parsed `Date` produces invalid database parameters, and invalid calendar dates can otherwise normalize silently.

**How to apply:** For activity list and CSV endpoints, parse at the HTTP boundary, reject malformed or impossible dates with a clear 400 response, then keep all comparisons in UTC.
