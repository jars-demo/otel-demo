# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini CLI) and developers
working in this repository. Humans: start with [README.md](README.md).

## What this is

The OpenTelemetry Incident Lab: a hands-on workshop where learners run a small distributed shop,
inject faults, and use traces, metrics and logs to find the root cause. Four FastAPI services
(Python 3.13) instrumented with OpenTelemetry, an OpenTelemetry Collector, Tempo, Prometheus, Loki
and Grafana, a lab-console that drives faults and incidents, a Next.js site with live views, six
incidents, and sixteen workshop chapters. Learners read the code as a reference, so prefer clear
over clever. It is educational: never present it as production-ready or as the official
OpenTelemetry Demo.

## Map

```text
services/common/telemetry.py   SDK setup: Resource, providers, OTLP exporters, Views, instrumentors
services/common/logs.py        JSON stdout logs with trace_id/span_id
services/common/faults.py      FaultState + /internal/faults router (excluded from tracing)
services/common/db.py          psycopg pool + db.client.connection.* metrics; resize() swaps pools
services/common/{app,errors,http}.py   app factory (/health, /ready), error mapping, service client
services/gateway/main.py       public /api routes, X-Trace-Id, API latency/error faults
services/orders/               checkout workflow (checkout.py), SQL (repository.py), pool fault
services/inventory/            Redis catalog, atomic Lua reservation (store.py), inventory faults
services/payment/main.py       approval rule, provider timeout fault, payments table
services/lab/                  lab-console (NOT instrumented): faults.py (catalog, Toxiproxy),
                               incidents.py (baseline/inject/mitigate/verify), load.py (capped
                               Poisson load), telemetry.py (Tempo/Prometheus/Loki queries),
                               traces.py (self time, critical path, bottleneck)
services/Dockerfile            one multi-stage image for all Python services
infra/otel/collector.yaml      the Collector config (collector-sampling.yaml + sampling.compose.yaml for ch 12)
infra/{tempo,prometheus,loki,grafana,postgres,toxiproxy}/   backend configs, schema, proxies
incidents/<id>/incident.yaml   incident definitions: read by the lab-console AND the site
workshop/NN-*.md               chapters 00 to 15 (source of truth; the site renders them)
frontend/                      Next.js 16 static export. src/lib/site.ts (flavour, URLs, nav),
                               src/lib/chapters.ts (keep in step with workshop/), src/lib/api.ts
                               (lab client, usePoll), components/ (live views), content/*.md
                               (Concepts, Security, Production pages), nginx.conf, Dockerfile
scripts/                       setup, start, stop, reset, load-test, verify (POSIX sh)
tests/                         unit tests (in-memory exporters); tests/integration/ (live stack)
examples/first_span.py         chapter 02 exercise
docs/                          CONTRIBUTING.md, CHANGELOG.md
```

## Commands

```bash
uv sync                                    # Python 3.13 + dependencies
uv run pytest                              # unit tests (integration deselected)
uv run pytest -m integration               # needs the lab running
uv run ruff check . && uv run ruff format --check .
./scripts/start.sh                         # docker compose build + up --wait
./scripts/verify.sh                        # end-to-end: health, checkout, trace, logs, metrics
docker compose run --rm --no-deps otel-collector validate --config=/etc/otelcol-contrib/config.yaml
cd frontend && npm ci && npm run dev       # site on :3400 against the running lab
cd frontend && npm run lint && npm run typecheck && npm run format:check && npm run build && npm run build:static
```

For `npm run dev`, set `NEXT_PUBLIC_API_URL=http://localhost:8400` and
`NEXT_PUBLIC_LAB_URL=http://localhost:8410` (both services allow `localhost:3400` via CORS).

## Rules

1. **Verify before documenting.** Run every command against the lab and paste the real output.
   Never invent Collector configuration, PromQL, LogQL, TraceQL or SDK APIs; check the pinned
   version's documentation.
2. **No fake telemetry.** Anything labelled live must come from Tempo, Prometheus or Loki. An
   educational simulation must be labelled as one. No random numbers in dashboards.
3. **Semantic conventions first.** Use standard attributes (`http.*`, `db.*`, `user.id`, ...).
   Custom attributes use the `app.` namespace. The services opt into the stable HTTP and database
   conventions with `OTEL_SEMCONV_STABILITY_OPT_IN=http,database`.
4. **Bounded cardinality.** Ids go on spans and logs, never on metric attributes.
5. **Business outcomes are not errors.** Out of stock and declined payments keep span status OK:
   raise after the span ends. Real failures raise inside the span so it records the exception.
6. **Faults stay safe.** Bounded values, local to the Docker network, reversible by reset, no
   command execution, no external traffic. The load generator never exceeds 20 req/s or 15 min.
7. **Incidents are a contract.** Changing a fault, a timeout, a latency or the checkout flow can
   break an incident's numbers. Re-run the affected incidents and update `incidents/*.yaml`, the
   chapters and the tests together.
8. **Docs follow code.** A changed command, path, port or output means updated `workshop/*.md` and
   README; a new chapter also needs `frontend/src/lib/chapters.ts`.
9. **Pins move together.** Python dependencies in `pyproject.toml` then `uv lock`; exact versions
   in `frontend/package.json`; image tags in Compose and Dockerfiles; versions listed in README and
   `frontend/src/lib/site.ts`. GitHub Actions are pinned to commit SHAs.
10. **Hardening stays on.** Non-root images, read-only root filesystems, `cap_drop: [ALL]`,
    `no-new-privileges`, memory limits, host ports on `127.0.0.1`.
11. **Never commit** `.env`, `node_modules/`, `.next/`, `out/`, `.venv/`, credentials or real
    secrets. The `shop`/`shop` database credential is a documented local lab value.
12. **Writing style.** Plain, precise English. No em dashes or en dashes anywhere (use commas,
    colons, parentheses or periods). Every documented command has **What it does / Why /
    Expected**. Every chapter has Goal, What you'll learn, Architecture, Prerequisites, Steps,
    Code, Verification, Why it matters, Common mistakes, Challenge.
13. **Root files.** The repository root holds only two Markdown files: `README.md` and
    `AGENTS.md`. Other documents live in `docs/`, `workshop/` or `frontend/content/`.

## Brand

White-first and calm. Primary `#2563EB` (hover `#1D4ED8`), Ink `#0F172A`, secondary text
`#64748B`, borders `#E2E8F0`, background `#FFFFFF`, subtle `#F8FAFC`. Status colours mean state
only: success `#16A34A`, warning `#D97706`, error `#DC2626`, always with a shape or label as well.
Inter (H1 700, H2 650, H3 600, body 400, labels 500), JetBrains Mono for code and numbers. Tokens
live in `frontend/src/app/globals.css`; use token classes, never raw hex in components. Charts use
the validated series tokens `--series-1..4` with legends, direct labels and a table view. No
gradients beyond the subtle hero wash, no glassmorphism, no decorative animation, no AI imagery.

## Style

Python: ruff (line length 100), type hints on public functions, small modules split by
responsibility. TypeScript strict, function components, ESLint (`eslint-config-next`) and Prettier.
Commits: Conventional Commits, `type(scope): Imperative summary`, with a body that says why.

## Skills

This repository follows the [JARS Skills](https://github.com/jars-demo/jars-skills) playbooks
([skills.jishanahmed.in](https://skills.jishanahmed.in)): `env-setup` for first setup,
`write-tests` for new behaviour, `debug-session` for failures (reproduce, hypothesise, inspect,
isolate, minimal fix, re-verify), `refactor` for splitting large files, `dependency-update` for
bumps (one dependency per change), `code-review` before merging, `commit-style` for commits,
`pr-description` for pull requests, and `changelog` / `release` for `docs/CHANGELOG.md` and tags.
Never push, tag or publish unless asked.
