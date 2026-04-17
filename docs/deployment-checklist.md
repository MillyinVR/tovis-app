# TOVIS Deployment Checklist

## Auth / trusted IP / rate-limit safety

- Verify `AUTH_TRUSTED_IP_HEADER` is set.
- Run `curl -s https://your-domain.com/api/health` and confirm rate limiting is active.
- Verify the configured trusted IP header name matches the production ingress header actually reaching TOVIS.
- Repeat a request against a rate-limited auth path from the same client and confirm repeated requests eventually receive `429` instead of bypassing throttling.

## Signup load test results

Record the prelaunch staging signup load-test result here before launch approval.

- Environment tested:
- Date:
- Commit:
- Tool used:
- Route tested: `POST /api/auth/register`
- Payload shape tested: repo-confirmed `CLIENT` signup contract
- Peak target reached:
- p50:
- p95:
- p99:
- Overall error rate:
- `429` rate:
- Were expected `429`s excluded from real-failure calculations?:
- Runtime dashboard screenshot / link:
- Notes / follow-up:

## Sweep result

AuthVersion enforcement sweep completed against bf6dc98. Repo-confirmed authenticated app surfaces do not perform raw JWT verification or raw tovis_token reads outside auth lifecycle endpoints. DB-backed current-user validation remains centralized in lib/currentUser.ts and flows through requireUser()/requireClient()/requirePro(). Structural regression test now passes and is scoped to catch real session-bypass risks without flagging unauthenticated token-based flows like password reset confirm.