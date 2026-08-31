export type UpstreamFailureKind = 'timeout' | 'unavailable';

export class UpstreamRequestError extends Error {
  constructor(readonly kind: UpstreamFailureKind) {
    super(
      kind === 'timeout'
        ? 'upstream request timed out'
        : 'upstream service unavailable',
    );
    this.name = 'UpstreamRequestError';
  }
}

/**
 * Bounded fetch primitive for server-controlled upstream URLs. It intentionally
 * does not interpret or expose an upstream response body.
 */
export async function requestUpstream(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalAbort = () => controller.abort();
  init.signal?.addEventListener('abort', externalAbort, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new UpstreamRequestError('timeout');
    }
    throw new UpstreamRequestError('unavailable');
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', externalAbort);
  }
}
