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

export async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...options.headers } });
  if (response.status === 401 && path.startsWith("/api/core/") && retry) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (refreshed.ok) return api<T>(path, options, false);
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path.startsWith("/api/core/") && typeof window !== "undefined") window.dispatchEvent(new Event("goa-session-expired"));
    throw new ApiError(response.status, data?.error?.code ?? "SERVICE_UNAVAILABLE", data?.error?.message ?? "Something went wrong. Please try again.");
  }
  return data as T;
}

export function dateRange(start: string, end: string): string {
  const format = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T00:00:00+05:30`));
  return `${format(start)} — ${format(end)}`;
}
