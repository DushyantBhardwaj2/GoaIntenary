-- Core API owns all goa_core_* tables. Initial additive migration; no backfill.
CREATE TABLE goa_core_profiles (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  email text CHECK (email IS NULL OR length(email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE goa_core_trips (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  start_date date NOT NULL,
  end_date date NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);

CREATE TABLE goa_core_memberships (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  user_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  role text NOT NULL CHECK (role IN ('organiser', 'member')),
  status text NOT NULL CHECK (status IN ('accepted', 'pending', 'removed')),
  joined_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id),
  CHECK (role <> 'organiser' OR status = 'accepted'),
  CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CHECK (status <> 'accepted' OR joined_at IS NOT NULL)
);
CREATE UNIQUE INDEX goa_core_one_organiser ON goa_core_memberships (trip_id) WHERE role = 'organiser';
CREATE INDEX goa_core_user_trips ON goa_core_memberships (user_id, status, trip_id);

CREATE TABLE goa_core_invitations (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  token_hash char(64) NOT NULL UNIQUE,
  requires_approval boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX goa_core_trip_invitations ON goa_core_invitations (trip_id, created_at);

CREATE TABLE goa_core_invitation_acceptances (
  invitation_id uuid NOT NULL REFERENCES goa_core_invitations(id),
  user_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, user_id)
);

CREATE TABLE goa_core_trip_idempotency (
  actor_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  request_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  trip_id uuid REFERENCES goa_core_trips(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_key)
);

CREATE TABLE goa_core_audit (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES goa_core_profiles(id),
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  action text NOT NULL CHECK (action IN ('trip.created', 'invitation.created', 'invitation.revoked', 'membership.requested', 'membership.accepted', 'membership.approved', 'membership.removed')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Application never edits history. Trigger also protects it under its DB role.
CREATE FUNCTION goa_core_reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only';
END;
$$;
CREATE TRIGGER goa_core_audit_append_only BEFORE UPDATE OR DELETE ON goa_core_audit
  FOR EACH ROW EXECUTE FUNCTION goa_core_reject_audit_change();

CREATE TABLE goa_core_rate_limits (
  scope text NOT NULL,
  key_hash char(64) NOT NULL,
  bucket timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (scope, key_hash, bucket)
);
