---
name: Orval path and query naming
description: A code generation naming collision encountered when one operation has both path and query parameters.
---

This workspace's Orval output can export a Zod `OperationParams` schema for path values and a TypeScript `OperationParams` type for query values when an endpoint combines path and query parameters. Typechecking then fails with duplicate exports.

**Why:** The generator derives both names from the same operation ID, even though they represent different parameter groups.

**How to apply:** When adding an operation with both parameter groups, inspect generated exports after codegen. If they collide, use a route design with a query-based resource identifier or a documented generator-level naming workaround.
