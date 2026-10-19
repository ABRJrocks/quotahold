export type Policy = {
  capacity: number;
  periodSeconds: number;
  maxInflight: number;
  unit: string;
};
export type State =
  "reserved" | "started" | "uncertain" | "settled" | "cancelled" | "expired";
export interface Reservation {
  id: string;
  scope: string;
  key: string;
  fingerprint: string;
  estimate: number;
  windowStart: number;
  createdAt: number;
  expiresAt: number;
  ttlSeconds: number;
  state: State;
  actual: number | null;
  receipt: string | null;
  note: string | null;
  updatedAt: number;
}
export interface Usage {
  spent: number;
  held: number;
  inflight: number;
  uncertain: number;
  available: number;
  overage: number;
  slots: number;
  scope: string;
  unit: string;
  windowStart: number;
  windowEnd: number;
  now: number;
}
export type ReservationInput = {
  key: string;
  fingerprint: string;
  estimate: number;
  ttlSeconds?: number;
};
export type Admission =
  | { kind: "reserved" | "replay"; reservation: Reservation; usage: Usage }
  | { kind: "denied"; reason: "units" | "concurrency"; usage: Usage };
export interface LedgerEvent {
  seq: number;
  at: number;
  reservationId: string | null;
  kind: string;
  units: number | null;
  reason: string | null;
}
export class QuotaError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export class Ledger {
  constructor(path: string, options?: { clock?: () => number });
  static create(path: string, options?: { clock?: () => number }): Ledger;
  close(): void;
  configure(scope: string, policy: Policy): Policy;
  reserve(scope: string, input: ReservationInput): Admission;
  start(scope: string, id: string): Reservation;
  uncertain(scope: string, id: string): Reservation;
  cancel(scope: string, id: string): Reservation;
  settle(
    scope: string,
    id: string,
    usage: { actual: number; receipt: string; note?: string },
  ): Reservation;
  status(scope: string): Usage;
  list(scope: string, page?: { after?: string; limit?: number }): Reservation[];
  events(
    scope: string,
    page?: { after?: number; limit?: number },
  ): LedgerEvent[];
}
export function availability(
  policy: Policy,
  totals: { spent: number; held: number; inflight: number },
): {
  spent: number;
  held: number;
  inflight: number;
  available: number;
  overage: number;
  slots: number;
};
export function decide(
  policy: Policy,
  totals: { spent: number; held: number; inflight: number },
  estimate: number,
): {
  allowed: boolean;
  reason: "units" | "concurrency" | null;
  usage: ReturnType<typeof availability>;
};
export function runCall<T>(
  ledger: Ledger,
  scope: string,
  input: ReservationInput,
  call: (hold: {
    id: string;
    key: string;
    estimate: number;
  }) => Promise<{ value: T; actual: number; receipt: string }>,
): Promise<{ value: T; reservation: Reservation }>;
