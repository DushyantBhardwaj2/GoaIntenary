-- Trip planning records. Existing trips gain no votes, stays, checklist items, or activity status rows.
-- An activity with no goa_core_activity_status row stays planned.

ALTER TABLE goa_core_activities ADD CONSTRAINT goa_core_activities_trip_id UNIQUE (trip_id, id);

CREATE TABLE goa_core_travel_segments (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  mode text NOT NULL CHECK (mode IN ('flight','train','bus')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  departure_place text NOT NULL CHECK (length(btrim(departure_place)) BETWEEN 1 AND 200),
  arrival_place text NOT NULL CHECK (length(btrim(arrival_place)) BETWEEN 1 AND 200),
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz,
  departure_terminal text NOT NULL DEFAULT '' CHECK (length(departure_terminal) <= 120),
  arrival_terminal text NOT NULL DEFAULT '' CHECK (length(arrival_terminal) <= 120),
  booking_reference text NOT NULL DEFAULT '' CHECK (length(booking_reference) <= 80),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT goa_core_travel_segments_trip_id UNIQUE (trip_id, id),
  FOREIGN KEY (trip_id, created_by) REFERENCES goa_core_memberships(trip_id, user_id),
  CHECK (arrival_at IS NULL OR arrival_at >= departure_at)
);
CREATE INDEX goa_core_travel_segments_trip ON goa_core_travel_segments(trip_id) WHERE deleted_at IS NULL;

CREATE TABLE goa_core_travel_travellers (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  segment_id uuid NOT NULL REFERENCES goa_core_travel_segments(id),
  participant_id uuid NOT NULL,
  PRIMARY KEY (segment_id, participant_id),
  FOREIGN KEY (trip_id, segment_id) REFERENCES goa_core_travel_segments(trip_id, id),
  FOREIGN KEY (trip_id, participant_id) REFERENCES goa_core_expense_participants(trip_id, id)
);

CREATE TABLE goa_core_stays (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  property_name text NOT NULL CHECK (length(btrim(property_name)) BETWEEN 1 AND 160),
  address text NOT NULL DEFAULT '' CHECK (length(address) <= 300),
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  check_in timestamptz NOT NULL,
  check_out timestamptz NOT NULL,
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  contact_name text NOT NULL DEFAULT '' CHECK (length(contact_name) <= 160),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT goa_core_stays_trip_id UNIQUE (trip_id, id),
  FOREIGN KEY (trip_id, created_by) REFERENCES goa_core_memberships(trip_id, user_id),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (check_out > check_in)
);
CREATE INDEX goa_core_stays_trip ON goa_core_stays(trip_id) WHERE deleted_at IS NULL;

CREATE TABLE goa_core_stay_guests (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  stay_id uuid NOT NULL REFERENCES goa_core_stays(id),
  participant_id uuid NOT NULL,
  PRIMARY KEY (stay_id, participant_id),
  FOREIGN KEY (trip_id, stay_id) REFERENCES goa_core_stays(trip_id, id),
  FOREIGN KEY (trip_id, participant_id) REFERENCES goa_core_expense_participants(trip_id, id)
);

-- target_id is polymorphic: no single-table foreign key and no file column.
CREATE TABLE goa_core_bookings (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  target_type text NOT NULL CHECK (target_type IN ('activity','stay','travel')),
  target_id uuid NOT NULL,
  provider_name text NOT NULL DEFAULT '' CHECK (length(provider_name) <= 160),
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 80),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (trip_id, created_by) REFERENCES goa_core_memberships(trip_id, user_id)
);
CREATE UNIQUE INDEX goa_core_bookings_live_target ON goa_core_bookings(trip_id,target_type,target_id) WHERE deleted_at IS NULL;

-- role is a contact card, not goa_core_memberships.role.
CREATE TABLE goa_core_contacts (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  role text NOT NULL CHECK (role IN ('organiser','hotel','driver','rental','activity_provider')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  stay_id uuid REFERENCES goa_core_stays(id),
  activity_id uuid REFERENCES goa_core_activities(id),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (trip_id, created_by) REFERENCES goa_core_memberships(trip_id, user_id),
  FOREIGN KEY (trip_id, stay_id) REFERENCES goa_core_stays(trip_id, id),
  FOREIGN KEY (trip_id, activity_id) REFERENCES goa_core_activities(trip_id, id)
);
CREATE INDEX goa_core_contacts_trip ON goa_core_contacts(trip_id) WHERE deleted_at IS NULL;

CREATE TABLE goa_core_place_votes (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  place_id text NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, place_id, user_id),
  FOREIGN KEY (trip_id, place_id) REFERENCES goa_core_saved_places(trip_id, place_id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, user_id) REFERENCES goa_core_memberships(trip_id, user_id)
);

CREATE TABLE goa_core_activity_comments (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  activity_id uuid NOT NULL REFERENCES goa_core_activities(id),
  author_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000 AND char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (trip_id, author_id) REFERENCES goa_core_memberships(trip_id, user_id),
  FOREIGN KEY (trip_id, activity_id) REFERENCES goa_core_activities(trip_id, id)
);
CREATE INDEX goa_core_activity_comments_activity ON goa_core_activity_comments(activity_id) WHERE deleted_at IS NULL;

CREATE TABLE goa_core_activity_status (
  activity_id uuid PRIMARY KEY REFERENCES goa_core_activities(id),
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','confirmed','cancelled')),
  updated_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, activity_id) REFERENCES goa_core_activities(trip_id, id),
  FOREIGN KEY (trip_id, updated_by) REFERENCES goa_core_memberships(trip_id, user_id)
);

CREATE TABLE goa_core_activity_attendees (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  activity_id uuid NOT NULL REFERENCES goa_core_activities(id),
  participant_id uuid NOT NULL,
  PRIMARY KEY (activity_id, participant_id),
  FOREIGN KEY (trip_id, activity_id) REFERENCES goa_core_activities(trip_id, id),
  FOREIGN KEY (trip_id, participant_id) REFERENCES goa_core_expense_participants(trip_id, id)
);

CREATE TABLE goa_core_budget_category_limits (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  category text NOT NULL CHECK (category IN ('accommodation','transport','food','activities','shopping','other')),
  limit_paise bigint NOT NULL CHECK (limit_paise BETWEEN 0 AND 1000000000),
  updated_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, category),
  FOREIGN KEY (trip_id, updated_by) REFERENCES goa_core_memberships(trip_id, user_id)
);

CREATE TABLE goa_core_checklist_items (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  visibility text NOT NULL CHECK (visibility IN ('personal','shared')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  assignee_user_id uuid,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (trip_id, created_by) REFERENCES goa_core_memberships(trip_id, user_id),
  FOREIGN KEY (trip_id, assignee_user_id) REFERENCES goa_core_memberships(trip_id, user_id),
  CHECK ((visibility = 'personal' AND assignee_user_id IS NULL) OR visibility = 'shared')
);
CREATE INDEX goa_core_checklist_items_trip ON goa_core_checklist_items(trip_id) WHERE deleted_at IS NULL;

-- 003 dropped the named scope check and added an unnamed one. On this database that check is goa_core_write_idempotency_scope_check.
ALTER TABLE goa_core_write_idempotency DROP CONSTRAINT goa_core_write_idempotency_scope_check;
ALTER TABLE goa_core_write_idempotency ADD CHECK (scope IN ('activity','expense','guest','repayment','travel','stay','booking','contact','checklist'));
ALTER TABLE goa_core_audit DROP CONSTRAINT goa_core_audit_action_check;
ALTER TABLE goa_core_audit ADD CONSTRAINT goa_core_audit_action_check CHECK (action IN (
  'trip.created','trip.updated','trip.deleted','invitation.created','invitation.revoked',
  'membership.requested','membership.accepted','membership.approved','membership.removed',
  'activity.created','activity.updated','activity.deleted','activity.reordered',
  'place.saved','place.unsaved','expense.created','expense.updated','expense.deleted',
  'guest.created','guest.archived','repayment.created','repayment.deleted',
  'travel.created','travel.updated','travel.deleted','stay.created','stay.updated','stay.deleted',
  'booking.created','booking.updated','booking.deleted','contact.created','contact.updated','contact.deleted',
  'vote.cast','vote.withdrawn','comment.created','comment.updated','comment.deleted',
  'activity_status.updated','activity_attendees.updated','budget_limit.updated',
  'checklist.created','checklist.updated','checklist.completed','checklist.deleted'));
