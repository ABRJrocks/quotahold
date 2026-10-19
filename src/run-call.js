import { QuotaError, requireValue } from './policy.js';

/** One cooperative worker call. A replay never calls the provider again. */
export async function runCall(ledger, scope, input, call) {
  requireValue(typeof call === 'function', 'INPUT', 'Call must be a function');
  const admission = ledger.reserve(scope, input);
  if (admission.kind === 'denied') throw new QuotaError(`DENIED_${admission.reason.toUpperCase()}`, `Admission denied by ${admission.reason} policy`);
  if (admission.kind === 'replay') throw new QuotaError('REPLAY', 'Request key already exists; recover the recorded call instead of repeating it');
  const hold = ledger.start(scope, admission.reservation.id);
  try {
    const result = await call({ id: hold.id, key: hold.key, estimate: hold.estimate });
    const settled = ledger.settle(scope, hold.id, { actual: result.actual, receipt: result.receipt });
    return { value: result.value, reservation: settled };
  } catch (error) {
    try { ledger.uncertain(scope, hold.id); }
    catch (recoveryError) {
      throw new AggregateError([error, recoveryError], 'Call outcome is unknown and could not be marked uncertain; its started reservation remains held');
    }
    throw error;
  }
}
