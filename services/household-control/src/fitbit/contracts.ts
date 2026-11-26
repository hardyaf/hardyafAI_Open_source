export type FitbitPhase = "idle" | "starting" | "running" | "stopping" | "needs_help" | "unavailable";
export type FitbitSnapshot = {
  available: true; proximityHint: string; phase: FitbitPhase; sessionId: string | null;
  startedAt: string | null; endsAt: string | null;
  lastSyncTime: null; syncVerified: false; dataConnection: "not_connected";
};
export type FitbitConfiguration = {
  controller: string; locationLabel?: string; profiles: Record<string, { guestId: "guest1" | "guest2" }>;
};
export interface FitbitController {
  execute(action: "status" | "start" | "stop", guestId: "guest1" | "guest2", assertCurrent: () => void): Promise<unknown>;
}
export function fitbitError(code: string, statusCode = 503) {
  return Object.assign(new Error(code), { statusCode });
}
export function projectSnapshot(value: unknown, locationLabel = "the home server"): FitbitSnapshot {
  const raw = value as Record<string, unknown>;
  if (!raw || raw.version !== 1 || raw.ok !== true ||
      !["idle","starting","running","stopping","needs_help","unavailable"].includes(String(raw.phase)))
    throw fitbitError("fitbit_status_unavailable");
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  return { available: true, proximityHint: "Keep your Fitbit near " + locationLabel + " during your sync session.", phase: raw.phase as FitbitPhase,
    sessionId: typeof raw.sessionId === "string" && /^[a-f0-9]{32}$/.test(raw.sessionId) ? raw.sessionId : null,
    startedAt: date(raw.startedAt), endsAt: date(raw.endsAt),
    lastSyncTime: null, syncVerified: false, dataConnection: "not_connected" };
}
