/** Shared SDK and playground arithmetic. Units are integers, never currency floats. */
export class QuotaError extends Error {
  constructor(code, message) { super(message); this.name = 'QuotaError'; this.code = code; }
}
export function requireValue(condition, code, message) {
  if (!condition) throw new QuotaError(code, message);
}
export function integer(value, name, min = 0, max = 1_000_000_000) {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= max, 'INPUT', `${name} must be an integer from ${min} to ${max}`);
  return value;
}
export function identifier(value, name = 'Identifier') {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value), 'INPUT', `${name} must be 1 to 128 identifier characters`);
  return value;
}
export function validatePolicy(policy) {
  requireValue(policy !== null && typeof policy === 'object' && !Array.isArray(policy), 'INPUT', 'Policy must be an object');
  requireValue(Object.keys(policy).every(key => ['capacity','periodSeconds','maxInflight','unit'].includes(key)), 'INPUT', 'Unknown policy field');
  integer(policy.capacity, 'Capacity', 1); integer(policy.periodSeconds, 'Period seconds', 60, 2_678_400);
  integer(policy.maxInflight, 'Concurrent calls', 1, 1000); identifier(policy.unit, 'Unit');
  return { capacity: policy.capacity, periodSeconds: policy.periodSeconds, maxInflight: policy.maxInflight, unit: policy.unit };
}
export function windowStart(now, periodSeconds) { return Math.floor(now / periodSeconds) * periodSeconds; }
export function availability(policy, totals) {
  validatePolicy(policy);
  integer(totals.spent, 'Spent units', 0, Number.MAX_SAFE_INTEGER);
  integer(totals.held, 'Held units', 0, Number.MAX_SAFE_INTEGER);
  integer(totals.inflight, 'In-flight calls', 0, Number.MAX_SAFE_INTEGER);
  requireValue(Number.isSafeInteger(totals.spent + totals.held), 'INPUT', 'Accounted units exceed safe arithmetic');
  return { ...totals, available: Math.max(0, policy.capacity - totals.spent - totals.held),
    overage: Math.max(0, totals.spent + totals.held - policy.capacity),
    slots: Math.max(0, policy.maxInflight - totals.inflight) };
}
export function decide(policy, totals, estimate) {
  integer(estimate, 'Estimated units', 1);
  const usage = availability(policy, totals);
  return { allowed: usage.slots > 0 && estimate <= usage.available,
    reason: usage.slots === 0 ? 'concurrency' : estimate > usage.available ? 'units' : null, usage };
}
