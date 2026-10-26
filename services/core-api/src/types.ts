export interface User { id: string; displayName: string; email: string | null }
export interface Identity { id: string; displayName?: string; email?: string }
export type Role = 'organiser' | 'member';
export type Status = 'accepted' | 'pending' | 'removed';
export interface Trip {
  id: string; name: string; startDate: string; endDate: string; description: string; createdAt: string; role: Role;
  region: Region; travellerCount: number; budgetPaise: number | null; styles: TripStyle[]; acceptedMemberCount: number; activityCount: number;
}
export interface Member { userId: string; displayName: string; role: Role; status: Status }
export interface Invitation { id: string; expiresAt: string; revoked: boolean; requiresApproval: boolean; createdAt: string }
export type Region = 'north' | 'south' | 'central' | 'all';
export type TripStyle = 'beaches' | 'nightlife' | 'food' | 'culture' | 'adventure' | 'relaxation';
export interface CreateTrip {
  name: string; startDate: string; endDate: string; description?: string;
  region?: Region; travellerCount?: number; budgetPaise?: number | null; styles?: TripStyle[];
}
export type ActivityCategory = 'beach' | 'food' | 'cafe' | 'nightlife' | 'culture' | 'adventure' | 'shopping' | 'transport' | 'other';
export interface ActivityInput {
  title: string; description: string; location: string; category: ActivityCategory; day: string | null;
  startTime: string | null; endTime: string | null; estimatedCostPaise: number; notes: string; meetingPoint: string;
  placeId: string | null; latitude: number | null; longitude: number | null;
}
export interface Activity extends ActivityInput { id: string; tripId: string; sortOrder: number; version: number; createdBy: string }
export interface SavedPlaceInput {
  placeId: string; title: string; category: ActivityCategory; region: Exclude<Region, 'all'>;
  latitude: number; longitude: number; sourceUrl: string;
}
export interface SavedPlace extends SavedPlaceInput { savedBy: string; createdAt: string }
export type ExpenseCategory = 'accommodation' | 'transport' | 'food' | 'activities' | 'shopping' | 'other';
export type ExpenseSplit = { mode: 'none' } | { mode: 'equal'; participantIds: string[] } | { mode: 'custom'; shares: { participantId: string; amountPaise: number }[] };
export interface ExpenseInput { title: string; amountPaise: number; category: ExpenseCategory; date: string; paidByUserId?: string; paidByParticipantId?: string; split?: ExpenseSplit; acknowledgeSettlementChange?: boolean }
export interface ExpenseShare { participantId: string; displayName: string; amountPaise: number }
export interface Expense {
  id: string; tripId: string; title: string; amountPaise: number; category: ExpenseCategory; date: string;
  paidByUserId: string | null; paidByParticipantId: string; paidByDisplayName: string; createdBy: string; createdAt: string; version: number;
  splitMode: 'none' | 'equal' | 'custom'; shares: ExpenseShare[];
}
export interface ExpenseParticipant { id: string; userId: string | null; displayName: string; kind: 'member' | 'guest'; active: boolean }
export interface RepaymentInput { fromParticipantId: string; toParticipantId: string; amountPaise: number; date: string; note?: string }
export interface Repayment extends RepaymentInput { id: string; createdBy: string; createdAt: string }
export interface PersonBalance { participantId: string; displayName: string; paidPaise: number; sharePaise: number; sentPaise: number; receivedPaise: number; balancePaise: number }
export interface Ledger { participants: ExpenseParticipant[]; balances: PersonBalance[]; settlements: { fromParticipantId: string; toParticipantId: string; amountPaise: number }[]; repayments: Repayment[]; unallocatedTotalPaise: number }
export interface Budget {
  budgetPaise: number | null; plannedTotalPaise: number; actualTotalPaise: number; remainingPaise: number | null;
  forecastRemainingPaise: number | null;
  estimatedPerPersonPaise: number; actualPerPersonPaise: number;
  categoryTotals: { category: ExpenseCategory; plannedPaise: number; actualPaise: number; limitPaise: number | null }[]; expenses: Expense[];
}
