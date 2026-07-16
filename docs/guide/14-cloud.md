# Lunapad Cloud

Lunapad Cloud is the hosted SaaS distribution of the same Apache-2.0 codebase. The
commercial product is managed hosting, operations, uptime, isolation, and support;
the cloud control plane code stays open in this repository.

## Deployment modes

Set `DEPLOYMENT_MODE` on the app service:

| Value         | Behavior                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self_hosted` | Default. Creates a default organization and project so existing single-team deployments keep working.                                                                                                                  |
| `cloud`       | Enables multi-organization assumptions: users must belong to an organization, API keys are org/project scoped, and hosted infrastructure must provide billing, email, workers, object storage, and production secrets. |

Self-hosted installs do not need email, object storage, billing credentials, or a
worker fleet. Those integrations are only required when operating a public hosted
service.

## Tenant model

Cloud mode uses three top-level records:

- **Organization**: billing, plan, members, API keys, audit log, and data connections.
- **Project**: workspace/notebooks, published reports, sites, comments, schedules, and job history.
- **Membership**: a user's org role (`admin`, `editor`, or `viewer`).

For v1, roles are organization-wide. Per-project ACLs are intentionally out of
scope so the hosted product can stay close to the existing team-workspace model.

## Open-source boundary

The cloud code should remain source-available under the repository license. Avoid
private feature forks. Prefer environment-gated behavior:

- self-hosted defaults should work with Docker Compose and no paid cloud providers;
- hosted production features should fail closed when required credentials are absent;
- billing, email, workers, and storage adapters should be replaceable by operators.

## Hosted execution and limits

Long-running or privileged work should move behind the tenant-aware cloud job
registry before being exposed to public multi-tenant traffic. Jobs carry:

- `org_id`
- `project_id`
- `user_id`
- job kind
- timeout budget
- quota key
- request ID
- payload, logs, result pointer, and error state

The app provides an adapter boundary:

- `inline`: self-host/dev path, records the same job lifecycle and runs in-process.
- `queue`: cloud path, records the job and lets external workers claim execution.

Executors check entitlements before accepting work and write job status back to
`cloud_jobs`. Browser DuckDB-WASM execution remains the lightweight path for
local/free use.

## Current migration status

The codebase now has the SaaS foundation:

- default organization/project bootstrap for self-hosted mode;
- tenant locals on each authenticated request;
- project-scoped workspace state;
- org-scoped connection metadata, connection secrets, API keys, and audit events;
- org/project APIs for current org, project CRUD, active project switching, usage, and jobs;
- organization-scoped invitations and team membership;
- project-scoped presence, comments, per-user settings, shares, sites, schedules,
  embeddings, and AI sessions;
- membership-gated private public shares/sites;
- tenant-aware REST/MCP agent context;
- app-shell project switcher plus Usage and Jobs settings panels;
- tenant-aware cloud job lifecycle with inline and queue adapters;
- central entitlement violation shape for product limits;
- provider-neutral billing sidecar tables for `none`, `manual`, and future
  `lemonsqueezy`;
- expanded health and admin diagnostics endpoints.

Remaining hosted operations work is infrastructure-specific: deploy queue workers,
object storage, backups, email delivery, and any Lemon Squeezy webhook/customer
portal adapter needed by the hosted service. Product logic should continue to
read entitlements, not payment-provider state.

## Next

See [Self-hosting](11-self-hosting.md) for the single-team deployment path.
