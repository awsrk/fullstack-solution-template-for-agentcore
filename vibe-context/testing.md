---
inclusion: fileMatch
fileMatchPattern: "tests/**"
---

# Testing Guide

## Running Tests

From the repo root:

```bash
make all        # lint + tests (what CI runs)
make test       # pytest only
make lint       # ruff + eslint
```

Tests must pass before pushing — the CI/CD pipeline runs `make all`.

## Python Tests

Tests live in `tests/` with this structure:

```
tests/
├── unit/           # Fast, no AWS dependencies
├── integration/    # Require deployed AWS resources
├── conftest.py     # Shared pytest fixtures
└── pytest.ini      # Pytest configuration
```

### Writing Unit Tests

- Place new unit tests in `tests/unit/test_<module_name>.py`
- Mock all AWS service calls (boto3, SSM, Secrets Manager) — unit tests must not require AWS credentials
- Use `pytest` fixtures in `tests/conftest.py` for shared setup
- Follow the naming convention: `test_<function_name>_<scenario>()`

### Writing Integration Tests

- Place in `tests/integration/`
- These require a deployed FAST stack and valid AWS credentials
- Document any required environment variables at the top of the test file

## Frontend Tests

Frontend tests live in `frontend/src/test/`. Run via:

```bash
cd frontend && npm run lint
```

Vitest is configured in `frontend/package.json`. For a single run (non-watch):

```bash
cd frontend && npx vitest --run
```

## Linting and Formatting

Python linting uses `ruff`. Run locally to auto-fix before committing:

```bash
make ruff-lint   # lint and auto-fix
make format      # format with ruff
```

CI uses `make lint-cicd` which checks without modifying files — it will fail if code isn't formatted.

Frontend linting uses ESLint:

```bash
cd frontend && npm run lint
```
