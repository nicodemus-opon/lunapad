# Lunapad Cloud hardening ledger

This ledger tracks correctness invariants for the open-source hosted SaaS mode. Treat
items here as launch blockers when `DEPLOYMENT_MODE=cloud`.

## Tenant invariants

- Privileged jobs must carry explicit `org_id`, `project_id`, `user_id`, request ID,
  timeout, quota key, and payload.
- Cloud-mode privileged execution must reject the self-host default tenant IDs except in
  bootstrap, migration, and documented compatibility paths.
- API/MCP calls use the API key's stored org/project. Request input cannot override it.
- Public shares and sites resolve by global token/slug first, then every backing lookup
  uses the resolved tenant.

## Execution invariants

- `CLOUD_EXECUTION_ADAPTER=queue` must fail closed unless worker processing is explicitly
  enabled with `CLOUD_QUEUE_WORKER_ENABLED=true` or `CLOUD_WORKER_ENABLED=true`.
- Workers claim jobs through the worker lifecycle endpoints using `CLOUD_WORKER_TOKEN`.
- Running jobs must be heartbeated or reaped as timed out.
- Queued agent/API results are not cached as completed idempotency results.

## Public surface invariants

- Public live share runs are rate-limited by tenant, share token, project, and IP.
- `requireAuth` share/site routes check membership in the resolved org.
- Share live-query runs and require-auth denials write tenant-scoped audit events.
- Demo mode blocks jobs, external connections, dbt, API/MCP, automation, and workspace
  writes even when a direct API request is made.

## UX invariants

- Project create, rename, archive, and switch actions stay in the app chrome.
- Project switching must not require a manual browser refresh.
- The active project cannot be archived unless another active project can take over.

## Test commands

```bash
pnpm check
pnpm vitest run src/lib/server src/routes/api src/lib/services/share-snapshot.test.ts
```
