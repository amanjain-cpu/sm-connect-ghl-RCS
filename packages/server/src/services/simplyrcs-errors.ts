import { ExternalServiceError } from '../utils/errors.js';

/**
 * A rejection SimplyRCS reports definitively (validation, auth, idempotency conflict). Anything
 * else (network, 5xx, uncertain acceptance) must not be retried on another channel automatically.
 */
export class SimplyRcsRejectedError extends ExternalServiceError {
  readonly providerCode: string | undefined;
  constructor(readonly httpStatus: number, message: string, providerCode?: string) {
    super('SimplyRCS', message);
    this.providerCode = providerCode;
  }
}
