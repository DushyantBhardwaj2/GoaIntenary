-- Additive upgrade: existing trip/member/invitation rows remain intact.
ALTER TABLE goa_core_trips
  ADD COLUMN region text NOT NULL DEFAULT 'all' CHECK (region IN ('north','south','central','all')),
  ADD COLUMN traveller_count integer NOT NULL DEFAULT 1 CHECK (traveller_count BETWEEN 1 AND 50),
  ADD COLUMN budget_paise bigint CHECK (budget_paise BETWEEN 0 AND 1000000000),
  ADD COLUMN styles text[] NOT NULL DEFAULT '{}' CHECK (cardinality(styles) <= 6 AND styles <@ ARRAY['beaches','nightlife','food','culture','adventure','relaxation']::text[]),
  ADD COLUMN deleted_at timestamptz;

ALTER TABLE goa_core_audit DROP CONSTRAINT goa_core_audit_action_check;
ALTER TABLE goa_core_audit ADD COLUMN target_key text CHECK (length(target_key) <= 100);
ALTER TABLE goa_core_audit ADD CONSTRAINT goa_core_audit_action_check CHECK (action IN (
  'trip.created','trip.updated','trip.deleted','invitation.created','invitation.revoked',
  'membership.requested','membership.accepted','membership.approved','membership.removed',
  'activity.created','activity.updated','activity.deleted','activity.reordered',
  'place.saved','place.unsaved','expense.created','expense.updated','expense.deleted'));

CREATE TABLE goa_core_activities (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('beach','food','cafe','nightlife','culture','adventure','shopping','transport','other')),
  day date,
  start_time text CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  estimated_cost_paise bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_paise BETWEEN 0 AND 1000000000),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  meeting_point text NOT NULL DEFAULT '' CHECK (length(meeting_point) <= 200),
  place_id text CHECK (length(place_id) BETWEEN 1 AND 100 AND place_id ~ '^[A-Za-z0-9_-]+$'),
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (trip_id, created_by) REFERENCES goa_core_memberships(trip_id,user_id),
  CHECK (end_time IS NULL OR (start_time IS NOT NULL AND end_time > start_time)),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX goa_core_activity_order ON goa_core_activities(trip_id,day,sort_order) WHERE deleted_at IS NULL;
CREATE FUNCTION goa_core_validate_activity_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.day IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM goa_core_trips WHERE id = NEW.trip_id AND NEW.day BETWEEN start_date AND end_date
  ) THEN RAISE EXCEPTION 'Activity day is outside trip dates' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER goa_core_activity_day BEFORE INSERT OR UPDATE ON goa_core_activities
  FOR EACH ROW EXECUTE FUNCTION goa_core_validate_activity_day();

CREATE TABLE goa_core_saved_places (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  place_id text NOT NULL CHECK (length(place_id) BETWEEN 1 AND 100 AND place_id ~ '^[A-Za-z0-9_-]+$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  category text NOT NULL CHECK (category IN ('beach','food','cafe','nightlife','culture','adventure','shopping','transport','other')),
  region text NOT NULL CHECK (region IN ('north','south','central')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  source_url text NOT NULL CHECK (length(source_url) <= 2048 AND source_url ~* '^https?://'),
  saved_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id,place_id),
  FOREIGN KEY (trip_id,saved_by) REFERENCES goa_core_memberships(trip_id,user_id)
);

CREATE TABLE goa_core_expenses (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 1000000000),
  category text NOT NULL CHECK (category IN ('accommodation','transport','food','activities','shopping','other')),
  date date NOT NULL,
  paid_by_user_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (trip_id,paid_by_user_id) REFERENCES goa_core_memberships(trip_id,user_id),
  FOREIGN KEY (trip_id,created_by) REFERENCES goa_core_memberships(trip_id,user_id)
);
CREATE INDEX goa_core_expenses_trip ON goa_core_expenses(trip_id,date) WHERE deleted_at IS NULL;
CREATE TABLE goa_core_expense_history (
  id uuid PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES goa_core_expenses(id),
  version integer NOT NULL CHECK (version > 0),
  actor_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  operation text NOT NULL CHECK (operation IN ('created','updated','deleted')),
  title text NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 1000000000),
  category text NOT NULL,
  date date NOT NULL,
  paid_by_user_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(expense_id,version)
);
CREATE TRIGGER goa_core_expense_history_append_only BEFORE UPDATE OR DELETE ON goa_core_expense_history
  FOR EACH ROW EXECUTE FUNCTION goa_core_reject_audit_change();

CREATE TABLE goa_core_write_idempotency (
  actor_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  scope text NOT NULL CHECK (scope IN ('activity','expense')),
  request_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id,trip_id,scope,request_key)
);
