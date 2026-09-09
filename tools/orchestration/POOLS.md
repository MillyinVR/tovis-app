# Optional cost-aware worker pools

Astra is chief of staff and the correctness-first final verifier. These commands
produce findings, never accepted changes. Read `pools.json` for current model
selection and the qualified task classes; changing models requires repeating the
smoke suite before enabling a class. Do not infer capability from catalog presence.

| Tier | Responsibility | Usage source |
|---|---|---|
| Astra | Architecture, ambiguous reasoning, schema/migrations, security/privacy, concurrency, final review and go/no-go | Existing Codex/ChatGPT account; this extension makes no OpenAI API calls |
| Claude Code | Complex engineering, difficult independent audits, valuable second opinion | Base wrapper requires existing Pro/Max subscription auth; no API-key fallback; account extra-usage settings still apply |
| Hermes + GLM 5.3 | Normal bounded delegated engineering, fallback when free evidence fails | Existing OpenRouter paid credits; never assumed free |
| OpenRouter free | First choice for **qualified**, safe read-only extraction tasks | Explicit `:free` model; live catalog zero-price preflight and server price caps; no paid model fallback inside this request |
| Hugging Face | Optional future classification, summaries, structured extraction, embeddings/search helpers; repo work only after model-specific smoke qualification | Disabled: no local auth or verified included-credit-only billing boundary |

Correctness outranks savings. Use local deterministic searches/checks directly when
they already establish the answer. The smoke tests measure extraction, citation
fidelity and formatting from a bounded source packet, not autonomous repo browsing
or general engineering skill. They are not permission to edit. Scaffolding remains
text proposals only, and is not enabled for a free model without its own benchmark.

## Invocation and acceptance

`delegate-free` and `delegate-hf` use the base dispatcher's explicit tracked-file
selection, applicable guidance, numbered source, credential screening and source
hashes. They use Python's standard library; no additional SDK or global install.
`--task-class` is selected by Astra, not inferred by a cheap model. Unknown or
high-risk classes return directly to Astra without inference. A safe label must
never be used to disguise a security/architecture/migration decision.

```sh
tools/orchestration/delegate-free --repo "$PWD" \
  --path lib/consult/profileCalibration.test.ts \
  --task-class test-coverage \
  --task 'List the test case titles exactly; cite each full it(...) declaration line.' \
  --contract /absolute/local/acceptance.json
```

A trusted local acceptance contract has the form below. It is **not** sent to the
model. Astra or a deterministic collector prepares it from actual source. For a
whole-repo symbol inventory, search all tracked source locally first; selected
files alone cannot establish whole-repo completeness.

```json
{"evidence":[["relative/file.ts",12]],"claims":["Exact expected claim"]}
```

The result must have `status`, `confidence`, `findings` and `missing`; every finding
has a claim and exact `{path,line,quote}` evidence. Quotes must match the supplied
source line byte-for-byte. Missing evidence, malformed JSON, low confidence (<0.85),
truncation, unsupported status, unexpected/missing claims or citations, and provider
errors trigger GLM escalation. The contract makes contradictions and incomplete
answers testable for mechanical extraction; it does not prove arbitrary reasoning.
Missing/invalid local contracts return to Astra before any inference. Never accept a model's self-reported
confidence alone. Every successful result remains `needs_astra_verification`.

An escalation without paid authorization returns structured `status=escalate`,
`next_worker=glm` and exit code 2. With `--paid-budget-usd 0.01` (example only),
automatically attempt at most one GLM request within that declared per-job ceiling.
The budget flag explicitly authorizes consuming existing paid OpenRouter credits.
The strict fallback uses a bounded direct OpenRouter wrapper pinned to the same
GLM 5.3 as Hermes, because the base Hermes adapter has no enforceable price filter.
It sends the original screened packet, never the rejected worker's prose. A failed
GLM result routes to `claude/astra`; it does not spend Claude/Astra usage itself.
This preserves the base `delegate-hermes` command for normal delegated engineering.
Its existing 2,400-token/180-second runtime limits still apply independently.

`--dry-run` prints hashes, model and scope size, with no provider call. Omit `--task`
to read it from stdin. `--config` selects a reviewed JSON configuration. There is
no editing flag and no tools, shell, SDK agent loop, provider plugins or automatic
model list fallback. `openrouter/free` additionally requires
`--variability-tolerant`, and must itself be qualified; catalog availability is
insufficient. Keep it disabled when it fails the acceptance suite.

## Limits and privacy

Free jobs: 32,000 input bytes, 1,800 output tokens, 45 seconds including catalog
preflight. Paid GLM fallback: at most 96,000 input bytes, 2,400 output tokens and
90 seconds, with an additional $0.02 maximum per paid job (or the lower explicit
budget). Two attempts maximum per invocation; zero retries. Free requests check
all published pricing fields and set prompt/completion/request/image price caps to
zero. Paid requests reject non-token fees, preflight live token pricing, and set
server rate caps. The local conservative cost estimate uses serialized input bytes
plus a 4,096-token framing reserve and the output cap. This is a per-request guard,
not an account-wide spending limit; the existing OpenRouter key remains unlimited.
A local timeout stops waiting, but is not proof the provider canceled inference.

Transport refuses redirects and proxy environment variables, limits response bytes,
and sends credentials only to fixed provider origins. No raw provider diagnostics,
credentials or prompts are logged by the dispatcher. Output contains screened
findings, hashes and allowlisted usage metadata. Common token formats, HF tokens,
unquoted secret assignments and the active credential are screened. No scanner can
recognize every private value; Astra must review the explicitly selected source.
Workers have no filesystem access, and a changed source hash invalidates the result.

Requests specify OpenRouter `data_collection=deny`. This is a provider routing
filter, not a promise of zero retention throughout OpenRouter or its providers.
Never send client records or secrets. The user specifically approved the saved
Tovis benchmark excerpts; that approval does not authorize broader private-data
exports. Account/provider policies can prevent a free route from being usable.

## Hugging Face activation boundary

`delegate-hf` is a disabled selector and escalation path, not a working HF inference
adapter. Setting `enabled=true` cannot silently bypass the billing boundary. No HF
CLI/auth files were found in standard locations, and neither system Python nor the
Hermes environment has `huggingface_hub`. HF subscription tier, remaining credits,
provider permissions and any custom provider billing are unverified locally.

Official HF docs list $2/month general compute credits for PRO. This is conditional
on the actual subscription and remaining balance, and is not unlimited inference.
Included credits may also be consumed by other HF compute; custom provider keys
have different billing. Before implementing/enabling HF transport, verify the
account/token permissions, provider and remaining credit boundary without changing
plans, then smoke-test the exact hosted model. Keep it disabled when included-only
usage cannot be enforced. This extension makes no HF inference calls and installs
or changes no paid plans. Embeddings and classification are future task classes,
not falsely advertised as tested capabilities.

## Reproducible smoke suite

```sh
python3 tools/orchestration/benchmark_pools.py --prepare-only \
  --output /absolute/local/benchmark-prompts.json
python3 tools/orchestration/benchmark_pools.py \
  --models APPROVED_MODEL_ID --output /absolute/local/benchmark-results.json
python3 -m unittest discover -s tools/orchestration -p 'test_*.py'
```

Review the prepared source excerpts before authorizing external transfer. The
benchmark never invokes a paid model or premium judge. A: exact tracked TS/TSX
`ConsultMentorDTO` occurrences; B: both profile-calibration test declarations;
C: the evidence-before-guessing house-rule heading. Expected locations are computed
locally and withheld from the models. Identical prompts are hashed. Reports score
completeness, citation validity, JSON reliability, semantic extraction and latency.
A failing model is unqualified for that class; rate limits are availability failures,
not a quality judgment. Requalify after changing model, prompt shape or provider.

Current local audit and results: `POOL_SMOKE_REPORT.md`. Preserve a separate tooling
branch/PR; do not merge. `AGENTS.md` intentionally delegates to `CLAUDE.md` and must
remain the Next.js generated-guidance sink described in that file.

Sources checked 2026-09-09:
- [OpenRouter free variants](https://openrouter.ai/docs/guides/routing/model-variants/free)
- [Free router](https://openrouter.ai/docs/guides/routing/routers/free-router)
- [Provider routing and maximum prices](https://openrouter.ai/docs/guides/routing/provider-selection)
- [HF pricing and billing](https://huggingface.co/docs/inference-providers/pricing)
- [Codex/ChatGPT usage](https://learn.chatgpt.com/docs/pricing)
