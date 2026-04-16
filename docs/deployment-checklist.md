# TOVIS Deployment Checklist

## Auth / trusted IP / rate-limit safety

- Verify `AUTH_TRUSTED_IP_HEADER` is set.
- Run `curl -s https://your-domain.com/api/health` and confirm rate limiting is active.
- Verify the configured trusted IP header name matches the production ingress header actually reaching TOVIS.
- Repeat a request against a rate-limited auth path from the same client and confirm repeated requests eventually receive `429` instead of bypassing throttling.