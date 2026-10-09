# Contributing

Thanks for helping improve the OpenTelemetry Incident Lab. The project is a teaching tool, so
correctness and clarity matter more than features.

## Before you start

- Read [AGENTS.md](../AGENTS.md): the rules there apply to every change, human or AI.
- For anything larger than a fix, open an issue first and describe the learning goal.

## Set up

```bash
git clone https://github.com/jars-demo/otel-demo.git
cd otel-demo
uv sync
./scripts/start.sh
./scripts/verify.sh
```

## Make a change

1. Branch from `main`.
2. Keep the change focused. Add or update tests for any behaviour change.
3. If a command, path, port, output or incident number changes, update the chapters, the incident
   YAML and the README in the same change, and re-run what you documented.
4. Run the checks:

   ```bash
   uv run ruff check . && uv run ruff format --check .
   uv run pytest
   uv run pytest -m integration          # with the lab running
   cd frontend && npm run lint && npm run typecheck && npm run format:check && npm run build
   ```

5. Commit with Conventional Commits (`feat(lab): Add ...`), with a body that says why.
6. Open a pull request describing the problem, the change and how you verified it.

## Adding an incident

Create `incidents/<nnn>-<slug>/incident.yaml` following an existing one. It needs a symptom that
does not reveal the cause, a trigger (faults and bounded load), investigation steps with hints, one
correct answer among the options, evidence, remediation, verification and a lesson. Run it end to
end at least twice and confirm the symptom reproduces and verification passes after the fix.
`tests/test_platform.py` checks the structure.

## Reporting a security issue

Do not open a public issue for a vulnerability. Contact the maintainer through
[jishanahmed.in](https://jishanahmed.in). Remember the lab's local defaults (anonymous Grafana,
plain OTLP, demo credentials) are intentional and documented.

## Code of conduct

Be kind, assume good intent, and keep discussions about the work.
