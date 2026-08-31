import { Request } from 'express';
import { VerifiedIdentity } from '../../identity/supabase-identity.service';

export interface GatewayRequest extends Request {
  vfIdentity?: VerifiedIdentity;
  vfRequestId?: string;
  vfApiNamespace?: 'compatibility' | 'legacy';
}

/**
 * Builds identity metadata for a trusted, internal hop. Caller supplied
 * identity headers are deliberately not accepted by this function.
 */
export function trustedIdentityHeaders(
  identity: VerifiedIdentity,
  requestId: string,
): Record<string, string> {
  return {
    'x-request-id': requestId,
    'x-vineford-actor-id': identity.actorId,
    'x-vineford-organization-id': identity.organizationId,
    'x-vineford-role': identity.role,
    ...(identity.caseId ? { 'x-vineford-case-id': identity.caseId } : {}),
  };
}
