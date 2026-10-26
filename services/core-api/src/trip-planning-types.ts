export type TravelMode = 'flight' | 'train' | 'bus';

export interface TravelSegment {
  id: string;
  tripId: string;
  mode: TravelMode;
  title: string;
  departurePlace: string;
  arrivalPlace: string;
  departureAt: string;
  arrivalAt: string | null;
  departureTerminal: string;
  arrivalTerminal: string;
  bookingReference: string;
  notes: string;
  travellerIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TravelSegmentInput {
  mode: TravelMode;
  title: string;
  departurePlace: string;
  arrivalPlace: string;
  departureAt: string;
  arrivalAt: string | null;
  departureTerminal: string;
  arrivalTerminal: string;
  bookingReference: string;
  notes: string;
  travellerIds: string[];
}

export interface Stay {
  id: string;
  tripId: string;
  propertyName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  checkIn: string;
  checkOut: string;
  phone: string;
  contactName: string;
  notes: string;
  guestIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StayInput {
  propertyName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  checkIn: string;
  checkOut: string;
  phone: string;
  contactName: string;
  notes: string;
  guestIds: string[];
}

export type BookingTargetType = 'activity' | 'stay' | 'travel';

export interface Booking {
  id: string;
  tripId: string;
  targetType: BookingTargetType;
  targetId: string;
  providerName: string;
  reference: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookingInput {
  targetType: BookingTargetType;
  targetId: string;
  providerName: string;
  reference: string;
  notes: string;
}

export type ContactRole = 'organiser' | 'hotel' | 'driver' | 'rental' | 'activity_provider';

export interface Contact {
  id: string;
  tripId: string;
  role: ContactRole;
  name: string;
  phone: string;
  note: string;
  stayId: string | null;
  activityId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  role: ContactRole;
  name: string;
  phone: string;
  note: string;
  stayId: string | null;
  activityId: string | null;
}

export interface PlaceVoteSummary {
  count: number;
  voters: { userId: string; displayName: string }[];
}

export interface PlaceVoteInput {
  interested: boolean;
}

export interface ActivityComment {
  id: string;
  tripId: string;
  activityId: string;
  authorId: string;
  authorDisplayName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityCommentInput {
  body: string;
}

export type ActivityStatusValue = 'planned' | 'confirmed' | 'cancelled';

export interface ActivityStatus {
  activityId: string;
  tripId: string;
  status: ActivityStatusValue;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface ActivityStatusInput {
  status: ActivityStatusValue;
}

export interface ActivityAttendees {
  participantIds: string[];
}

export type ChecklistVisibility = 'personal' | 'shared';

export interface ChecklistItem {
  id: string;
  tripId: string;
  visibility: ChecklistVisibility;
  title: string;
  assigneeUserId: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItemInput {
  visibility: ChecklistVisibility;
  title: string;
  assigneeUserId: string | null;
}

export interface ChecklistPatch {
  title?: string;
  assigneeUserId?: string | null;
  completedAt?: string | null;
}

export interface CategoryLimit {
  category: 'accommodation' | 'transport' | 'food' | 'activities' | 'shopping' | 'other';
  limitPaise: number;
}

export interface CategoryLimitsInput {
  limits: CategoryLimit[];
}

export interface TripOverview {
  today: OverviewActivity[];
  upcomingTravel: TravelSegment[];
  stays: Stay[];
  contacts: Contact[];
}

export interface OverviewActivity {
  id: string;
  tripId: string;
  title: string;
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string;
  status: ActivityStatusValue;
}
