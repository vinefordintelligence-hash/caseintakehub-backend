# Backend Remaining Blockers

These blockers do not prevent unrelated source development.

| Modules | Blocker | Required decision/input |
|---|---|---|
| 1, 2, 38 | Supabase invitations, session revocation, MFA and step-up authentication require an approved identity-provider workflow and administrative credentials. | Supabase administration design and credentials |
| 4 | Owner, organization-admin, case-manager and reviewer are not values in the existing PostgreSQL `user_role` model. | Approved role migration and hierarchy |
| 24, 25 | Real financial execution requires an authorized custody/payment provider; simulated records must not be represented as transfers. | Provider contract and credentials |
| 32 | Private signed storage requires a selected storage provider, bucket policy, retention policy and malware-scanning approach. | Storage/provider decision |
| 37 | ArkCase synchronization requires API documentation, credentials, field mappings and sync direction. | ArkCase integration specification |
| 38, 40 | Distributed throttling, queues and locks require an approved shared store/queue provider. | Redis/queue infrastructure decision |
| 8, 11, 15, 27, 28, 29 | Source APIs are implemented against the additive operational core, but their tables do not exist until migration 0024 is reviewed and applied. | Explicit migration approval and deployment window |
| 10 | Durable workflow definitions, versions and execution history require an approved automation model and persistence migration. | Workflow-authoring/execution policy |
| 30 | PDF/DOCX output requires an approved rendering approach; current source safely supports JSON and CSV. | Export/rendering decision (and possibly a package) |
| 39 | External error monitoring is not configured. Health/readiness/dependency endpoints are implemented. | Monitoring provider and credentials |

Case `VF-2026-8282` must not be queried or mutated during source completion.
