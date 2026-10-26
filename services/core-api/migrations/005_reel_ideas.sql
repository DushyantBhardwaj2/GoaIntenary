-- Additive shared trip ideas; existing trips and planning records are unchanged.
CREATE TABLE goa_core_reel_ideas (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('reel', 'photo')),
  instagram_url text CHECK (length(instagram_url) <= 2048),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (trip_id, id),
  FOREIGN KEY (trip_id, created_by) REFERENCES goa_core_memberships(trip_id, user_id)
);
CREATE INDEX goa_core_reel_ideas_trip ON goa_core_reel_ideas(trip_id, created_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE goa_core_reel_idea_people (
  trip_id uuid NOT NULL,
  idea_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (idea_id, user_id),
  FOREIGN KEY (trip_id, idea_id) REFERENCES goa_core_reel_ideas(trip_id, id),
  FOREIGN KEY (trip_id, user_id) REFERENCES goa_core_memberships(trip_id, user_id)
);

ALTER TABLE goa_core_write_idempotency DROP CONSTRAINT goa_core_write_idempotency_scope_check;
ALTER TABLE goa_core_write_idempotency ADD CONSTRAINT goa_core_write_idempotency_scope_check
  CHECK (scope IN ('activity','expense','guest','repayment','travel','stay','booking','contact','checklist','reel-idea'));
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
  'checklist.created','checklist.updated','checklist.completed','checklist.deleted',
  'reel-idea.created','reel-idea.updated','reel-idea.deleted'));
