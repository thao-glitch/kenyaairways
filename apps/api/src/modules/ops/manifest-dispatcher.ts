import type { ManifestPassengerDto } from '@kenyaairways/shared';
import { createLogger, type Logger } from '../../common/logger';

/** Exactly what leaves the building — no PII beyond the manifest itself. */
export interface ManifestPayload {
  flightId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departureUtc: string;
  gate: string | null;
  operator: string;
  generatedAt: string;
  passengers: ManifestPassengerDto[];
}

export interface DispatchResult {
  ok: boolean;
  /** HTTP status of the endpoint, or `null` when nothing was sent (noop). */
  responseCode: number | null;
  message: string;
}

/**
 * KCAA extension point — the transport behind `POST /ops/manifests/:id/dispatch`.
 * Swapping in a real government endpoint means adding an implementation and
 * pointing `KCAA_MANIFEST_URL` at it; booking/check-in code never changes.
 */
export interface ManifestDispatcher {
  readonly kind: string;
  readonly endpoint: string | null;
  dispatch(payload: ManifestPayload): Promise<DispatchResult>;
}

export const MANIFEST_DISPATCHER = 'MANIFEST_DISPATCHER';

/** Default (dev/CI): nothing leaves the process — dispatch is recorded as SKIPPED. */
export class NoopManifestDispatcher implements ManifestDispatcher {
  readonly kind = 'noop';
  readonly endpoint = null;
  private readonly log: Logger = createLogger('manifest');

  async dispatch(payload: ManifestPayload): Promise<DispatchResult> {
    this.log.info('manifest dispatch skipped — no endpoint configured', {
      flightId: payload.flightId,
      flightNumber: payload.flightNumber,
      passengers: payload.passengers.length,
    });
    return {
      ok: true,
      responseCode: null,
      message: 'no endpoint configured — manifest retained locally',
    };
  }
}

/** POSTs the manifest as JSON to `KCAA_MANIFEST_URL` (Bearer auth, 10s cap). */
export class HttpManifestDispatcher implements ManifestDispatcher {
  readonly kind = 'http';
  private readonly log: Logger = createLogger('manifest');

  constructor(
    private readonly url: string,
    private readonly token?: string,
  ) {}

  get endpoint(): string {
    return this.url;
  }

  async dispatch(payload: ManifestPayload): Promise<DispatchResult> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.warn('manifest endpoint rejected the dispatch', {
        endpoint: this.url,
        status: res.status,
      });
      return {
        ok: false,
        responseCode: res.status,
        message: `endpoint responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }
    return { ok: true, responseCode: res.status, message: 'accepted' };
  }
}
