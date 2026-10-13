---
name: ClientGuard storage failure tests
description: Reliable test setup for failures in storage-backed file streams.
---

When testing a stream failure, make the Readable emit a real stream error (for example by calling `destroy(error)`). Yielding an `Error` from `Readable.from([error])` can send it as a data chunk and falsely exercise the successful-transfer path.

**Why:** A test that only observes a failed HTTP body can still miss that the server marked the transfer successful.

**How to apply:** For upload and download storage-failure tests, assert the persisted audit outcome as well as the HTTP response behavior.
