# Tovis optional-pool smoke report — 2026-09-09

Implemented on `codex/free-hf-workers`, stacked on base tooling `7f331fb7`
(PR #1140). No application code changed; no merge or deployment.

## Exact routing configuration

- Free: **nex-agi/nex-n2.5-mini:free**, enabled only for `symbol-search` and
  `test-coverage`. Both passed twice with complete citations and reliable JSON.
  Its guidance result passed once and failed once: guidance remains disabled.
- Variable `openrouter/free`: unqualified, not selected.
- GLM: `z-ai/glm-5.3`, existing Hermes route retained. Strict direct-wrapper
  fallback uses the same account/model and runs only with an explicit job budget,
  up to $0.02. No paid benchmark was run.
- HF: selector/configuration present but **disabled**; live HF inference adapter
  remains blocked on auth, subscription/credit verification and a billing guard.
- Astra owns architecture, ambiguity, schema/migrations, security/privacy,
  concurrency, independent final review and go/no-go. Claude handles difficult
  engineering/audits. A free result never authorizes a change or release.

## Identical benchmark results

A = all four tracked TS/TSX `ConsultMentorDTO` references (including declaration,
import, return annotation and DTO field); B = both profile-calibration test cases;
C = evidence-before-guessing house-rule heading. Local searches and exact source
checks computed expected answers; no premium judge was used. Times include live
catalog/pricing preflight, not just model generation.

| Model | A | B | C |
|---|---|---|---|
| nex-agi/nex-n2.5-mini:free | 2/2 pass (28.349/2.564 s) | 2/2 pass (2.286/2.829 s) | 1/2 pass (3.22/1.965 s) |
| cohere/north-mini-code:free | 1/1 pass (21.798 s) | 0/1 pass (10.614 s) | 0/1 pass (17.712 s) |
| google/gemma-4-26b-a4b-it:free | 0/1 pass (0.434 s) | 0/1 pass (0.432 s) | 0/1 pass (0.381 s) |
| openrouter/free | 0/1 pass (7.502 s) | 0/1 pass (4.852 s) | 0/1 pass (0.551 s) |
| nex-agi/nex-n2.5-pro:free | 0/1 pass (45.005 s) | 0/1 pass (45.011 s) | 1/1 pass (39.879 s) |
| dots-studio/dots-3-note-preview:free | 1/2 pass (7.045/16.99 s) | 1/2 pass (6.224/10.783 s) | 0/2 pass (12.048/3.994 s) |

Failures:
- NEX Mini: initial C failed the exact source citation/quote check.
- Cohere North Mini Code: B malformed result schema; C unfinished/truncated.
- Gemma 26B: HTTP 429 for A/B/C. Availability failure, quality unscored.
- Free router: A/B failed citation/quote checks; C HTTP 429.
- NEX Pro: A/B exceeded the 45-second deadline; C passed source/heading checks.
- Dots: first A/B passed; repeat A unfinished/truncated, B malformed JSON;
  C failed citation/quote checks both times. Not suitable for routing.

An exact-quote rejection can be a formatting mismatch, not necessarily an invented
fact. Rejected raw outputs were withheld; do not label every rejection a proven
hallucination. All successful accepted A/B outputs had 100% expected evidence and
zero extra citations. C is a narrow constraint extraction, not a general guidance
comprehension qualification. During setup, a too-small *catalog* response limit
blocked preflight; it was fixed before the scored suite and was not a model failure.
The C scorer was corrected locally to accept the actual Markdown heading rather
than demand trailing prose; stored answers were rescored without more inference.

## Deterministic evidence

- `lib/consult/mentor.ts:1` — ConsultMentorDTO import.
- `lib/consult/mentor.ts:7` — buildConsultMentor return annotation.
- `lib/dto/consult.ts:1750` — type declaration.
- `lib/dto/consult.ts:1758` — optional mentor field.
- `lib/consult/profileCalibration.test.ts:14` and `:23` — the two test declarations.
- `CLAUDE.md:15` — “Don't guess — read the source of truth, or ask.”

Source baseline was main `452c185d` plus the tooling commits; these excerpts are
unchanged by the tooling branch. Whole-repo search here means tracked TS/TSX only;
models never had filesystem access and did not execute application tests.

## Access and billing audit

Existing Hermes configuration: provider `openrouter`, model `z-ai/glm-5.3`, empty
custom base URL. Credential exists in the existing Hermes .env; it was never printed.
The account models endpoint listed all six tested routes plus three untested free
variants: `inclusionai/ling-3.0-flash-sante:free`,
`inclusionai/ling-3.0-flash-fin:free`, and `google/gemma-4-31b-it:free`.
Those three remain unqualified. Catalog presence alone does not establish callability.

The key metadata reports `is_free_tier=false`, `limit=null`,
`limit_remaining=null`: the key itself has no configured spend cap. Its deprecated
rate-limit field was not treated as usable quota evidence. This task changed no
account limits, plans or keys. Free requests require catalog zero pricing plus
zero prompt/completion/request/image provider price caps. No paid fallback or
premium benchmark was invoked. Successful free response cost fields were $0;
no account-wide attribution is claimed while another task uses the account.

No `hf`/`huggingface-cli` binary on PATH; no huggingface_hub in system or Hermes
Python; no HF token in the inspected standard environment/cache locations or
Hermes .env. HF account/subscription tier, balance and provider permission are
unverified. Documented PRO credits are conditional, not proof of this account's
available credit. No HF inference was attempted and no software/plan was installed
for HF. Existing Claude usage is controlled by the base subscription-auth wrapper;
its task reports refreshed auth and a passed smoke, not an unlimited billing promise.
Astra remains on the current Codex account; this extension uses no OpenAI API key.

## Enforcement and limits

- Read-only, no worker tools or code execution; explicit tracked text only.
- Reject credentials, hidden/sensitive/untracked paths, symlinks and stale sources.
- Free default: 32 KB input, 1,800 output tokens, 45 seconds; one attempt.
- GLM fallback: 96 KB input, 2,400 output tokens, 90 seconds, one attempt,
  explicit budget and $0.02 configuration cap. Default paid budget is zero.
- Provider redirects/proxy environment ignored; fixed origins; raw errors withheld.
- Results need exact citations, confidence >=0.85, complete structured output and
  a trusted local expected-evidence/claim contract. Unmatched contracts escalate.
- Failed free → GLM; no budget → structured held escalation. Failed GLM →
  Claude/Astra; no automatic premium invocation. High-risk work → Astra immediately.
- Rate caps/token estimates bound a job, not the whole account. A local deadline
  does not prove the server canceled a request. Provider retention remains relevant.

## Changed files

- `CLAUDE.md` — complete cost-aware ladder and verification policy.
- `tools/orchestration/README.md` — entry point to optional-pool guidance.
- `tools/orchestration/POOLS.md` — operation, escalation, billing, HF boundary.
- `tools/orchestration/pools.json` — model selection/qualification and ceilings.
- `tools/orchestration/pool_worker.py` — bounded free route and guarded escalation.
- `tools/orchestration/delegate-free`, `delegate-hf` — command selectors.
- `tools/orchestration/benchmark_pools.py` — reproducible source-backed A/B/C suite.
- `tools/orchestration/test_pool_worker.py` — deterministic boundary/regression tests.
- `tools/orchestration/POOL_SMOKE_REPORT.md` — this durable handoff.

AGENTS.md remains the intentional Next.js sink and delegates to CLAUDE.md. No
ignored internal docs were published and no unrelated app files were edited.

## Validation

26 local Python boundary tests passed after integration of the latest base tooling;
free/HF command dry-runs and shell syntax passed. Repository typecheck, lint and all
static guards passed. The final direct dispatcher check passed: pinned NEX Mini returned both exact
test titles and citations, passed the local acceptance contract, and reported
$0 cost in 2.348 seconds. Push-hook/CI outcome is recorded in the final delivery
report. HF live inference is explicitly unverified
and disabled. GLM's new strict JSON fallback is covered with mocked transport and
budget checks; this task did not spend paid tokens to rebenchmark it.

Provider references: [OpenRouter free routes](https://openrouter.ai/docs/guides/routing/model-variants/free),
[provider price caps](https://openrouter.ai/docs/guides/routing/provider-selection),
[HF billing](https://huggingface.co/docs/inference-providers/pricing),
[Codex/ChatGPT usage](https://learn.chatgpt.com/docs/pricing).
