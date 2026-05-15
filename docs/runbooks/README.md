# TOVIS Runbooks

This directory contains operational runbooks for diagnosing and responding to production incidents in TOVIS.

Runbooks are meant to be practical, boring, and fast to use during an incident. If a runbook requires heroics, psychic debugging, or “just check the logs” as the main step, it is not done yet. Cute, but no.

## Health endpoints

TOVIS exposes two health endpoints:

```text
GET /api/health/live
GET /api/health/ready