# VINEFORD Module 36 — API / Integration Gateway Report

## 1. Existing API architecture found

The backend is a single NestJS REST application with unversioned controller paths such as `/cases`, `/workflow`, `/documents`, `/funding`, and `/enterprise`. No backend `/api/vf/*` namespace, proxy controller, correlation middleware, or shared outbound HTTP abstraction existed. The global `SupabaseIdentityGuard` and `RbacGuard` already formed a protected-by-default boundary; only the root endpoint and client login are explicitly public. Client portal tokens are revalidated against their one organization/client/case relationship on every protected request.

The repository contains direct outbound calls to Supabase Auth, Algorand Testnet, and an optional treasury deposit-address provider. The generic integrations module is a super-admin-only scaffold. No ArkCase synchronization was activated or changed. CORS is not enabled by the NestJS bootstrap; existing security headers and the global validation pipe remain unchanged.

## 2. Files changed

- `src/app.module.ts`
- `src/core/security/safe-http-exception.filter.ts`
- `src/core/security/security-foundation.spec.ts`
- `src/identity/supabase-identity.guard.ts`
- `src/identity/supabase-identity.service.ts`
- `src/funding/algorand.service.ts`
- `src/treasury/deposit-address-provider.ts`

## 3. New files created

- `src/core/gateway/api-gateway.middleware.ts`
- `src/core/gateway/gateway-request.ts`
- `src/core/gateway/upstream-request.ts`
- `src/core/gateway/api-gateway.spec.ts`
- `MODULE_36_API_GATEWAY_REPORT.md`

## 4. Routes classified

| Route group | Classification | Gateway treatment |
|---|---|---|
| `/` and `/api/vf/` | Public by design | Existing public health-like root is retained through both paths. |
| `POST /client-auth/login` and `/api/vf/client-auth/login` | Public by design | Existing generic login failure behavior is retained. |
| Protected application controllers | Authenticated and role/resource scoped | Existing global identity/RBAC boundary applies identically to legacy and compatibility paths. |
| `/auth`, `/integrations` | Super admin only | Existing Phase 38A role restriction is retained. |
| `/audit` | Admin or super admin | Existing Phase 38A role restriction is retained. |
| Case client endpoints | Client case-bound where permitted | The verified client JWT's live `caseId` and `organizationId` remain authoritative. |

No route was deleted, renamed, or made less restrictive. `/api/vf/*` is an alias of the same controllers, guards, pipes, and filters—not a second authorization surface.

## 5. Identity propagation changes

The gateway discards inbound `x-role` and `x-user-id`. The global identity guard continues to treat legacy `x-actor-id` as a mismatch assertion and `x-organization-id` as membership-selection metadata, never as proof of identity. After bearer-token verification, both compatibility headers are overwritten with the verified actor and organization. Authoritative actor, role, organization, and optional client case remain on `request.vfIdentity`.

`trustedIdentityHeaders()` provides a future internal-hop contract built exclusively from `VerifiedIdentity`; it does not accept browser headers or forward a caller's bearer token implicitly.

## 6. Compatibility decisions

Existing unversioned routes and response payloads are preserved. A request beginning with `/api/vf` is internally mapped to the same unversioned route before controller dispatch. This avoids controller duplication and does not require a frontend migration. Responses expose `X-Vineford-API-Version: 1` for the compatibility namespace and `legacy` for direct unversioned paths.

## 7. Error normalization

The existing catch-all filter now always supplies `statusCode`, `error`, `message`, and `requestId`, while retaining `path` and `timestamp` for compatibility. Unknown server failures and all 5xx gateway/upstream failures use fixed safe messages. Stack traces, thrown internal error text, SQL, provider response bodies, secrets, JWT contents, and filesystem paths are not returned.

## 8. Request ID design

The middleware accepts only a bounded 1–128 character request ID matching a conservative alphanumeric/period/underscore/colon/hyphen grammar. Otherwise it generates a UUID server-side. The ID is attached to `request.vfRequestId`, normalized into the request header for internal diagnostics, returned as `X-Request-Id`, and included in normalized errors. It contains no actor, case, organization, token, or other sensitive identifier.

## 9. API versioning design

- Current legacy namespace: existing unversioned controller paths.
- Stable compatibility namespace: `/api/vf/*`, reported as API version 1.
- Migration strategy: frontend callers may move route-by-route to `/api/vf/*` without changing controller contracts. A future breaking API should use an explicitly approved version namespace rather than rewriting the current alias.

## 10. Tests performed

- Focused gateway/security/identity/Algorand/provider suites: 26 tests passed.
- Full unit suite: 78 suites and 295 tests passed.
- Coverage includes compatibility rewriting, legacy route preservation, safe/generated request IDs, spoofed role/user-header removal, trusted verified-identity headers, client/organization isolation regressions, normalized 4xx/5xx errors, hidden internal error details, and unavailable/timeout upstream behavior.
- No destructive or live-case integration test was run.

## 11. TypeScript result

`npx tsc --noEmit`: **PASS**.

## 12. Build result

`npm run build`: **PASS**.

## 13. Deferred items

- No service-to-service endpoint is activated; mTLS/service credentials and token exchange require an approved deployment design.
- ArkCase synchronization, mappings, retries, and credentials remain deferred and unchanged.
- Durable retry/queue processing belongs to Module 40.
- A future breaking/version-2 contract requires explicit endpoint-by-endpoint design.
- The super-admin integrations scaffold remains protected but intentionally non-functional.
- Rate limiting, step-up authentication, access review, and broader session lifecycle remain Security follow-up work; they were not weakened here.

## 14. Migration required

**NO.** Module 36 introduced no schema dependency and no migration was created or applied.

## 15. Restart required later

**YES.** A backend restart will eventually be required to deploy the compiled changes. No process was restarted during this phase, and PM2 process 0 was not touched.

## 16. Protected case confirmation

Case `VF-2026-8282` was not queried or modified. No database schema or data was read, written, reset, or migrated. Its credentials, workflow/history, financial records, documents, evidence, messages, timeline, and relationships remain untouched.

## 17. Recommended next backend module

**Module 5 — Permissions / RBAC.** With the protected-by-default security boundary and compatibility gateway established, consistent persisted/resource-level permission enforcement is the next dependency for users, cases, storage, intake, search, and administration.

No package was installed, no environment/configuration was changed, and no backend, frontend, PM2, NGINX, Supabase, or ArkCase runtime action was performed.
