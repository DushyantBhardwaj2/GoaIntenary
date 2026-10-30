export type User = { id: string; displayName: string; email: string | null };
export type Region = "north" | "south" | "central" | "all";
export type Trip = { id: string; name: string; startDate: string; endDate: string; description: string; createdAt: string; role: "organiser" | "member"; region: Region; travellerCount: number; budgetPaise: number | null; styles: string[]; acceptedMemberCount: number; activityCount: number };
export type Member = { userId: string; displayName: string; role: "organiser" | "member"; status: "accepted" | "pending" | "removed" };
export type Invitation = { id: string; expiresAt: string; revoked: boolean; requiresApproval: boolean; createdAt: string };
export type TripDetail = { trip: Trip; members: Member[]; invitations: Invitation[] };
export type AuthStatus = { configured: boolean; localAvailable: boolean; hasSession: boolean };
export type Category = "beach" | "food" | "cafe" | "nightlife" | "culture" | "adventure" | "shopping" | "transport" | "other";
export type Activity = { id: string; tripId: string; title: string; description: string; location: string; category: Category; day: string | null; startTime: string | null; endTime: string | null; estimatedCostPaise: number; notes: string; meetingPoint: string; placeId: string | null; latitude: number | null; longitude: number | null; sortOrder: number; version: number; createdBy: string };
export type Place = { id: string; title: string; description: string; category: Category; region: Exclude<Region, "all">; area: string; latitude: number; longitude: number; sourceUrl: string; checkedAt: string };
export type SearchPlace = Place & { origin?: 'reviewed' | 'openstreetmap' };
export type PlaceResults = { places: SearchPlace[]; total: number; catalogue: { kind: string; checkedAt: string; notice: string }; providerAvailable?: boolean; providerNotice?: string; attribution?: string; attributionUrl?: string };
export type SavedPlace = { placeId: string; title: string; category: Category; region: Exclude<Region, "all">; latitude: number; longitude: number; sourceUrl: string; savedBy: string; createdAt: string };
export type ExpenseCategory = "accommodation" | "transport" | "food" | "activities" | "shopping" | "other";
export type ExpenseShare = { participantId: string; displayName: string; amountPaise: number };
export type Expense = { id: string; tripId: string; title: string; amountPaise: number; category: ExpenseCategory; date: string; paidByUserId: string | null; paidByParticipantId: string; paidByDisplayName: string; createdBy: string; createdAt: string; version: number; splitMode: 'none'|'equal'|'custom'; shares: ExpenseShare[] };
export type ExpenseParticipant = { id: string; userId: string | null; displayName: string; kind: 'guest'|'member'; active: boolean };
export type Repayment = { id:string; fromParticipantId:string; toParticipantId:string; amountPaise:number; date:string; note:string; createdBy:string; createdAt:string };
export type Ledger = { participants:ExpenseParticipant[]; balances:{participantId:string;displayName:string;paidPaise:number;sharePaise:number;sentPaise:number;receivedPaise:number;balancePaise:number}[]; settlements:{fromParticipantId:string;toParticipantId:string;amountPaise:number}[]; repayments:Repayment[]; unallocatedTotalPaise:number };
export type Budget = { budgetPaise: number | null; plannedTotalPaise: number; actualTotalPaise: number; remainingPaise: number | null; forecastRemainingPaise: number | null; estimatedPerPersonPaise: number; actualPerPersonPaise: number; categoryTotals: { category: string; plannedPaise: number; actualPaise: number; limitPaise: number | null }[]; expenses: Expense[] };
export const activityCategories: Category[] = ["beach", "food", "cafe", "nightlife", "culture", "adventure", "shopping", "transport", "other"];
export const expenseCategories: ExpenseCategory[] = ["accommodation", "transport", "food", "activities", "shopping", "other"];
export const core = "/api/core/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Only concurrent browser reads are shared. Settled private responses are never
// cached here, and server requests never share module-level account state.
const pendingReads = new Map<string, Promise<unknown>>();
let sessionGeneration = 0;
let readsGeneration = 0;
let refreshing: Promise<Response> | null = null;
let refreshController: AbortController | null = null;

export function clearApiRequests() {
  sessionGeneration += 1;
  readsGeneration += 1;
  pendingReads.clear();
  refreshController?.abort();
  refreshController = null;
  refreshing = null;
}

function dataChanged(path: string) {
  if (typeof window === "undefined") return;
  readsGeneration += 1;
  pendingReads.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("goa-data-changed", { detail: { path } }));
}

async function request<T>(path: string, options: RequestInit, generation: number, readGeneration: number | null, retry = true, retryInvalidated = true): Promise<T> {
  const isCore = path.startsWith("/api/core/");
  const stale = () => isCore && typeof window !== "undefined" && (generation !== sessionGeneration || (readGeneration !== null && readGeneration !== readsGeneration));
  const recover = (): Promise<T> => {
    if (generation === sessionGeneration && readGeneration !== null && retryInvalidated) {
      // A concurrent write invalidated this snapshot. Only a read may retry,
      // once; successful writes are never repeated automatically.
      return request<T>(path, options, generation, readsGeneration, retry, false);
    }
    throw new ApiError(409, "STALE_REQUEST", "The account or trip changed. Please retry.");
  };
  const response = await fetch(path, { ...options, credentials: "same-origin", cache: path.startsWith("/api/discovery/") ? options.cache ?? "default" : "no-store", headers: { "Content-Type": "application/json", ...options.headers } });
  if (stale()) return recover();
  if (response.status === 401 && isCore && retry && typeof window !== "undefined") {
    if (!refreshing) {
      const controller = new AbortController();
      refreshController = controller;
      const current = fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
      refreshing = current;
      void current.finally(() => { if (refreshing === current) { refreshing = null; refreshController = null; } }).catch(() => undefined);
    }
    const refreshed = await refreshing;
    if (stale()) return recover();
    if (refreshed.ok) return request<T>(path, options, generation, readGeneration, false, retryInvalidated);
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (stale()) return recover();
  if (!response.ok) {
    if (isCore && [401, 403].includes(response.status) && typeof window !== "undefined") clearApiRequests();
    if (isCore && [401, 403].includes(response.status) && typeof window !== "undefined") window.dispatchEvent(new Event("goa-access-denied"));
    if (response.status === 401 && isCore && typeof window !== "undefined") window.dispatchEvent(new Event("goa-session-expired"));
    throw new ApiError(response.status, data?.error?.code ?? "SERVICE_UNAVAILABLE", data?.error?.message ?? "Something went wrong. Please try again.");
  }
  return data as T;
}

export function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    dataChanged(path);
    return request<T>(path, options, sessionGeneration, null).finally(() => dataChanged(path));
  }
  // Callers with custom headers or cancellation own their request lifecycle.
  const shared = typeof window !== "undefined" && method === "GET" && !options.signal && !options.headers && !options.cache;
  if (!shared) return request<T>(path, options, sessionGeneration, readsGeneration);
  const key = `${sessionGeneration}:${readsGeneration}:${path}`;
  const existing = pendingReads.get(key);
  if (existing) return existing as Promise<T>;
  const current = request<T>(path, options, sessionGeneration, readsGeneration);
  if (pendingReads.size >= 100) return current;
  pendingReads.set(key, current);
  void current.finally(() => { if (pendingReads.get(key) === current) pendingReads.delete(key); }).catch(() => undefined);
  return current;
}

export function dateRange(start: string, end: string): string {
  const format = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T00:00:00+05:30`));
  return `${format(start)} — ${format(end)}`;
}
