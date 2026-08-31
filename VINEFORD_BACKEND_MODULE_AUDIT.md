# VINEFORD Intelligence Platform — Backend Module Audit

## Scope and classification

This document audits the existing NestJS backend at `/opt/vineford/backend` against the approved 40-module VINEFORD backend roadmap. Migration `0022-payment-proof-document.sql` is treated as a repository checkpoint, not as module 22.

Status meanings:

- **COMPLETE** — all material responsibilities in the approved roadmap are implemented.
- **PARTIAL** — meaningful, functional implementation exists, but material responsibilities remain.
- **PLACEHOLDER** — a NestJS surface exists, but it is empty or returns scaffold responses rather than implementing the module.
- **MISSING** — no dedicated implementation exists.

An API contract below means a backend controller route exists. The separate frontend was not inspected or modified.

## Module audit

| # | Module | Status | Repository evidence | Missing functionality |
|---:|---|---|---|---|
| 1 | Authentication & Identity | PARTIAL | `src/identity/*`, `src/client-auth/*`, `src/auth/*`; migrations 0015 and 0017. Supabase verification, active identity/membership checks, case-bound client JWTs, bcrypt PINs and lockout are functional. | Functional staff-login API, refresh, logout/revocation, secure-cookie sessions, MFA, step-up authentication, device/session inventory and complete recovery lifecycle. The generic `/auth` controller remains an unguarded scaffold. |
| 2 | Users | PARTIAL | `src/users/*`, `src/common/actor.service.ts`, dashboard role route, enterprise membership APIs, `app_users` and `investigators`. | Database-backed `UsersService` CRUD, activation/deactivation, profiles, activity history, safe provisioning and unified investigator administration. Current service responses are scaffold strings. |
| 3 | Organizations | PARTIAL | `src/organizations/*`, `src/enterprise/*`, migration 0017; organization CRUD, memberships and settings exist. | Teams, complete membership lifecycle, administrator delegation, suspension/removal and explicitly authorized organization-transfer rules. |
| 4 | Roles | PARTIAL | `src/roles/*`, PostgreSQL `user_role`, protected immutable role lookup. | Approved hierarchy and assignment history; Owner, Organization Admin, Case Manager and Reviewer are not persisted application roles. |
| 5 | Permissions / RBAC | PARTIAL | `src/permissions/*`, `ActorService`, `SupabaseIdentityGuard`, funding feature guard and local case/org checks. | Reusable permission enforcement across all controllers, persisted role-permission mapping, resource grants, hierarchy and permission-change history. Shared `rbac`, `organization` and `client` guards under `src/core/security` are empty. |
| 6 | Clients | PARTIAL | `src/client-auth/*`, withdrawals/messages, document requests, cases, case-progress and migration 0015. | General client CRUD/search, status lifecycle, communication preferences, multiple-case account management and a unified client-visibility policy. |
| 7 | Cases | PARTIAL | `src/cases/*`, `src/case-progress/*`, dashboard, enterprise assignments and migrations 0010–0020. | Safe archive/closure lifecycle, robust reference generation, category/priority validation, assignment orchestration, standardized summaries and deletion safeguards. Current case removal physically deletes records. |
| 8 | Case Intake | MISSING | No intake module, controller, service, migration or intake tables. | Drafts, autosave/resume, attachments, organization/category selection, assessment, accept/reject and conversion into a case. |
| 9 | Case Workflow / Phase Engine | PARTIAL | `src/workflow/*`, `src/case-transfers/*`, payments and migrations 0010–0013, 0016 and 0020. | Unified transition authorization, investigator-next-action model, legal-hold enforcement across all mutations and workflow-definition abstraction. |
| 10 | Workflow Automation | PLACEHOLDER | `src/events/events.module.ts` and `src/notifications/notifications.module.ts` are empty; existing actions are hard-coded in services. | Definitions, templates, triggers, conditions, actions, execution history, versions, draft/published states and import/export. |
| 11 | Tasks | PLACEHOLDER | `src/tasks/*` registers `/tasks`, but `TasksService` returns scaffold strings. | Persistence, case/client/investigator assignment, priorities, due dates, dependencies, SLA integration, history and state transitions. |
| 12 | Document Requests | PARTIAL | `src/document-requests/*`, transfer requirements and migrations 0009–0012 and 0016. Request, submission, review, notification and audit flows exist. | Fully normalized statuses, append-only request history, versioned submissions and broader notification preferences. |
| 13 | Documents | PARTIAL | `src/documents/*`, document-request workflow and migrations 0011, 0016 and 0022. Scoped metadata CRUD, visibility and verification fields exist. | Private storage abstraction, streamed uploads, signed downloads, versions, access history, malware hooks and complete legal-hold deletion prevention. |
| 14 | Evidence Vault | PARTIAL | `src/evidence/*`, migration 0021 and enterprise evidence links. Scoped evidence metadata CRUD and review fields exist. | SHA-256/integrity workflow, evidence identifiers, collection metadata, category governance and secure storage. |
| 15 | Chain of Custody | MISSING | Only an `evidence.custody_status` field exists; no custody service or event table. | Append-only custody events, access history, evidence transfers, custodians, verification, reasons, timestamps and legal-hold awareness. |
| 16 | Secure Messaging | PARTIAL | `src/withdrawals/case-messages.*`, migration 0014 and `messages`; case-bound send/list works. | Threads, recipients, read/unread state, attachments, delivery notification and complete message audit. Generic `/communications` remains an unguarded scaffold. |
| 17 | Notifications | PARTIAL | `src/notification-center/*`, `case_notifications`, funding notifications and workflow/SLA emitters. | Preferences, delivery providers/channels, delivery history, durable retries and precise staff-user targeting. |
| 18 | Case Timeline / Activity | PARTIAL | `src/timeline/*` and workflow SQL event helpers provide chronological and visibility-filtered events. | Append-only enforcement, comprehensive task/message/evidence/payment event coverage and legal-hold policy. Update/delete endpoints currently make events mutable. |
| 19 | Audit & Compliance | PARTIAL | `src/audit-logs/*`, SQL audit helpers and widespread workflow/admin/funding calls. | Database immutability, complete authentication/access events, permission history, consistent before/after values, IP/device metadata and retention controls. `/audit` is a separate unguarded scaffold. |
| 20 | Legal Hold | PARTIAL | Workflow legal-hold endpoint and fields from migration 0016; audit and client notification exist. | Hold owner, start/end and history; document/evidence holds; universal mutation and deletion prevention. |
| 21 | SLA / Deadlines | PARTIAL | `src/workflow/sla.service.ts`, phase-deadline fields and migration 0016. Hourly overdue checks, audit and notifications exist. | Configurable SLA rules, task/client-action deadlines, escalation chains, business calendars and complete reporting. |
| 22 | Case Handoff / Transfer | PARTIAL | Enterprise assignments/transfers, case-transfer workflow, Phase 6 grants and migrations 0010, 0013 and 0017. | Rejection/cancellation endpoints, team handoff, organization-transfer approval protocol and complete history APIs. |
| 23 | Payments & Invoices | PARTIAL | `src/payments/*`; migrations 0009, 0012 and 0020–0022; payment gate, case-payment status and proof linkage work. | Functional invoice CRUD, receipts, general payment ledger, outstanding balances, overdue automation and complete payment timeline. `/invoices` and `/ledger` are scaffolds. |
| 24 | Funding / Financial Case | PARTIAL | `src/funding/*`, treasury, enterprise financial APIs and migrations 0017–0019. Programs, applications, milestones, reviews, votes, disputes and controlled releases exist. | Production custody/provider integration, broader financial assessment, reconciliation and mature client-facing masking. Real execution remains deliberately disabled without a custody provider. |
| 25 | Withdrawal / Client Action | PARTIAL | `src/withdrawals/*`, workflow client actions and migrations 0011 and 0014. Request/review/response lifecycle exists. | Generalized attachment relationships, fuller notification integration and configurable approval policies. |
| 26 | Crypto / Blockchain Intelligence | PARTIAL | Enterprise assets/wallets/transactions/traces, `AlgorandService` and migrations 0017–0019. | BTC, ETH, USDT, XRP, BNB and SOL integrations; graph analysis, enrichment, findings and multi-chain ingestion. Only supported Algorand paths are independently verified. |
| 27 | Entities | MISSING | No general investigation-entity module or entity tables. | Persons, accounts, email addresses, phones, domains, IP addresses, metadata and case-entity relationships. |
| 28 | Relationships / Correlation | PARTIAL | Enterprise `case_intelligence_traces` supports manual source-target links within a case. | General entity graph, confidence, similar-entity discovery, cross-case correlation and related-case detection. |
| 29 | Investigation Intelligence | PARTIAL | Enterprise assets/traces/recoveries and `case-progress`; `investigations` and `notes` are scaffolds. | Functional findings, sources, indicators, notes, confidence model, intelligence summaries and investigative-task linkage. |
| 30 | Reports | PLACEHOLDER | `src/reports/*` registers `/reports`, but the service returns scaffold strings. | All report types, generation, metadata, visibility, history and PDF/DOCX/CSV exports. |
| 31 | Analytics / Reporting Dashboard | PARTIAL | `src/dashboard/*` and migration 0016 use real database data for summary, phase, time and payment-aging views. | Priority, outstanding-action/request, SLA, workload and broader operational reporting plus export. `/analytics` remains a scaffold. |
| 32 | File Storage | MISSING | Documents and evidence contain file URL/metadata fields only; no storage module exists. | Private provider abstraction, secure uploads, signed downloads, authorization, deletion rules, legal-hold enforcement and malware hooks. |
| 33 | Search | PLACEHOLDER | `src/search/*` is scaffold-only; dashboard has a limited guarded search method. | Permission-aware case/client/document/evidence/entity search, reference lookup and filters. |
| 34 | Administration | PARTIAL | Dashboard, enterprise, organizations, roles, permissions, audit and funding-feature APIs. | Unified administrative policy and API surface, functional user administration, workflow administration and complete security controls. |
| 35 | System Settings | PARTIAL | Enterprise organization settings, funding feature policy and payment-gate settings. | Platform-wide typed settings for workflows, notifications, security, case numbering, storage and integrations. |
| 36 | API / Integration Gateway | PARTIAL | NestJS REST controllers and verified bearer-token handling provide frontend-facing APIs. | `/api/vf/*` namespace, versioning, global validation, normalized errors, correlation middleware, session-propagation standard and integration abstraction. |
| 37 | ArkCase Integration | PLACEHOLDER | Generic `src/integrations/*` scaffold exists; no ArkCase host, mapping or synchronization implementation was found. | Case/document/status/workflow synchronization, external IDs, retries, failure handling, mapping history and sync audit. |
| 38 | Security | PARTIAL | Verified identity, case-bound clients, PIN hashing/lockout, feature guards, scoped services and security tests. | Protected-by-default global guard, completed shared guards, global validation, general rate limiting, security headers, cookies/CSRF model, step-up auth, access review and consistent legal-hold enforcement. Multiple scaffolds are publicly reachable. |
| 39 | Health / Monitoring | PLACEHOLDER | Root controller returns `Hello World!`. | Database, storage and integration health; liveness/readiness; dependency checks; diagnostics and error monitoring. |
| 40 | Background Jobs / Scheduler | PARTIAL | `ScheduleModule.forRoot()` and hourly `SlaService` are functional. | Durable queues, retries, distributed locking, notification delivery jobs, report jobs, integration retries, cleanup and scheduled audits. |

## Exact totals

| Status | Total |
|---|---:|
| COMPLETE | **0** |
| PARTIAL | **30** |
| PLACEHOLDER | **6** |
| MISSING | **4** |
| **Total** | **40** |

## Dependency-aware implementation order

1. **Security and API boundary** — protected-by-default routing, verified identity propagation, completed RBAC/organization/case guards, global validation, safe errors and placeholder-route containment.
2. **Users, roles, permissions and organization administration** — database-backed accounts, activation, audited role assignment, membership lifecycle and teams.
3. **Case safety foundation** — replace destructive deletion with archive/closure, enforce legal hold, standardize case authorization and reference generation.
4. **Health and operational readiness** — real liveness/readiness and dependency checks before larger expansion.
5. **Secure file storage** — private uploads, signed downloads, authorization and legal-hold-aware deletion rules.
6. **Case intake** — drafts, attachments, review and safe conversion into clients/cases; depends on identity, organizations, case safety and storage.
7. **Chain of custody** — immutable evidence history; depends on evidence, identity, storage, audit and legal hold.
8. **Tasks and SLA completion** — persisted tasks, deadlines, dependencies and assignment.
9. **Workflow automation** — definitions, triggers and executions; depends on tasks, notifications, workflow and audit.
10. **Entities and relationships** — normalized entities first, then correlations and cross-case links.
11. **Investigation intelligence** — findings, indicators, sources and summaries on top of entities/relationships.
12. **Permission-aware search** — after authorization and searchable resource models stabilize.
13. **Reports and analytics completion** — after cases, evidence, intelligence and financial contracts stabilize.
14. **Durable background processing** — queues, retries and locks for notifications, reports and integrations.
15. **ArkCase integration** — last among core dependencies; requires stable contracts, mapping schema, jobs and external credentials.

## First five recommended modules

1. **Module 38 — Security**
2. **Module 36 — API / Integration Gateway**
3. **Module 5 — Permissions / RBAC**
4. **Module 2 — Users**
5. **Module 7 — Cases**

## Recommended next backend module

**Module 38 — Security** is the recommended next implementation.

It is the dependency root for the remaining roadmap. New case intake, storage, tasks, automation, intelligence, reporting and integrations should not be added while authorization is controller-specific, common guards are empty, global validation is absent and scaffold endpoints remain publicly reachable.

### Requirements for the initial Security implementation

| Requirement | Needed? | Notes |
|---|---|---|
| Database migration | **No** | Initial protected-by-default routing, guards, validation and error handling can be implemented without schema changes. |
| Database writes | **No** | Implementation and verification do not require modifying application data. Read-only integration checks may be used. |
| Package installation | **Not necessarily** | Core NestJS guards, pipes and filters can use installed dependencies. Security headers or throttling may later justify separately approved packages. |
| Backend restart | **Yes, for deployment only** | Source verification can occur without restart. Deploying the built changes requires restarting `vineford-backend.service`, not PM2 process 0. |
| External credentials | **No** | The initial phase uses existing verified-identity configuration and does not require new Supabase, ArkCase or provider credentials. |

No migration, database write, package installation or restart is authorized by this document.

## Known blockers

1. The approved role hierarchy includes roles not present in the live `user_role` enum; a role-model decision is required before implementing the full hierarchy.
2. The intended compatibility strategy for introducing `/api/vf/*` without breaking existing routes must be approved.
3. Public scaffold routes require a decision: protect and retain temporarily, deprecate, or remove in a separately authorized compatibility phase.
4. Secure file storage requires a selected provider, retention policy and signed-access design.
5. ArkCase integration requires API documentation, authentication credentials, field mappings, retry expectations and an approved synchronization direction.
6. Production financial execution requires a legitimate authorized custody/payment provider; no transaction may be fabricated.
7. Some live tables have RLS disabled, while some RLS-enabled tables have no policies. Any database-level isolation redesign requires a separately reviewed migration and deployment plan.

## Protected regression case confirmation

**Case `VF-2026-8282` was not modified during this audit or while creating this documentation.** No case data, credentials, workflow state, financial records, documents, evidence relationships, messages, timeline history or audit history were changed.

## Documentation-only confirmation

This file is the only artifact created for this task. No application code, migration, database schema/data, environment variable, package, PM2 process, backend/frontend runtime, NGINX configuration, Supabase configuration or ArkCase configuration was modified.
