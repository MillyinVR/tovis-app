# Contact Lookup Hash Threat Model

This document records the launch decision for contact lookup hashing in TOVIS.

It exists because contact lookup hashes are currently used for client/pro matching and deduplication, and the current implementation uses plain SHA-256 rather than HMAC-SHA256.

## Current status

```text
Status: Risk accepted for private beta / early controlled launch
Decision date: 2026-05-23
Owner: Tori Morales
Current implementation: SHA-256 contact lookup hash
Target future implementation: HMAC-SHA256 before raw contact-field contraction