export class HouseholdDispatchError extends Error {
  readonly code: string;
  readonly deliveryOutcome: "not_sent" | "unknown";
  readonly retryable: boolean;

  constructor(code: string, deliveryOutcome: "not_sent" | "unknown", retryable = false) {
    super(code);
    this.name = "HouseholdDispatchError";
    this.code = code;
    this.deliveryOutcome = deliveryOutcome;
    this.retryable = retryable;
  }
}
