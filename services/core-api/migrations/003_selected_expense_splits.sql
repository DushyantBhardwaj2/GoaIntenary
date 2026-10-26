-- Existing expenses remain explicitly unallocated; no historic split is inferred.
CREATE TABLE goa_core_expense_participants (
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  id uuid NOT NULL,
  user_id uuid REFERENCES goa_core_profiles(id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (trip_id,id),
  UNIQUE (trip_id,user_id),
  CHECK (user_id IS NULL OR id=user_id),
  FOREIGN KEY (trip_id,user_id) REFERENCES goa_core_memberships(trip_id,user_id)
);
INSERT INTO goa_core_expense_participants (trip_id,id,user_id,display_name,created_by)
  SELECT m.trip_id,m.user_id,m.user_id,left(p.display_name,80),t.created_by
  FROM goa_core_memberships m JOIN goa_core_profiles p ON p.id=m.user_id
  JOIN goa_core_trips t ON t.id=m.trip_id WHERE m.status IN ('accepted','removed');

ALTER TABLE goa_core_expenses
  ALTER COLUMN paid_by_user_id DROP NOT NULL,
  ADD COLUMN paid_by_participant_id uuid,
  ADD COLUMN split_mode text NOT NULL DEFAULT 'none' CHECK (split_mode IN ('none','equal','custom')),
  ADD CONSTRAINT goa_core_expense_trip_id UNIQUE (trip_id,id);
UPDATE goa_core_expenses SET paid_by_participant_id=paid_by_user_id;
ALTER TABLE goa_core_expenses ALTER COLUMN paid_by_participant_id SET NOT NULL;
ALTER TABLE goa_core_expenses ADD FOREIGN KEY (trip_id,paid_by_participant_id) REFERENCES goa_core_expense_participants(trip_id,id);
ALTER TABLE goa_core_expenses ADD CHECK (paid_by_user_id IS NULL OR paid_by_user_id=paid_by_participant_id);

CREATE TABLE goa_core_expense_shares (
  trip_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 0 AND 1000000000),
  PRIMARY KEY (expense_id,participant_id),
  FOREIGN KEY (trip_id,expense_id) REFERENCES goa_core_expenses(trip_id,id),
  FOREIGN KEY (trip_id,participant_id) REFERENCES goa_core_expense_participants(trip_id,id)
);
CREATE FUNCTION goa_core_check_expense_shares() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; expense_amount bigint; mode text; share_amount numeric; people integer;
BEGIN
  IF TG_TABLE_NAME='goa_core_expenses' THEN target=COALESCE(NEW.id,OLD.id);
  ELSE target=COALESCE(NEW.expense_id,OLD.expense_id); END IF;
  SELECT amount_paise,split_mode INTO expense_amount,mode FROM goa_core_expenses WHERE id=target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(amount_paise),0),count(*) INTO share_amount,people FROM goa_core_expense_shares WHERE expense_id=target;
  IF (mode='none' AND people<>0) OR (mode<>'none' AND (people<1 OR people>50 OR share_amount<>expense_amount)) THEN
    RAISE EXCEPTION 'Expense shares must match the expense' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER goa_core_expense_share_total AFTER INSERT OR UPDATE ON goa_core_expenses
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION goa_core_check_expense_shares();
CREATE CONSTRAINT TRIGGER goa_core_share_total AFTER INSERT OR UPDATE OR DELETE ON goa_core_expense_shares
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION goa_core_check_expense_shares();

ALTER TABLE goa_core_expense_history
  ALTER COLUMN paid_by_user_id DROP NOT NULL,
  ADD COLUMN paid_by_participant_id uuid,
  ADD COLUMN split_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN shares jsonb NOT NULL DEFAULT '[]';
-- Append-only v1/v2 history is left unchanged, including its original payer.

CREATE TABLE goa_core_repayments (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES goa_core_trips(id),
  from_participant_id uuid NOT NULL,
  to_participant_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 1000000000),
  date date NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note)<=500),
  created_by uuid NOT NULL REFERENCES goa_core_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (from_participant_id<>to_participant_id),
  FOREIGN KEY (trip_id,from_participant_id) REFERENCES goa_core_expense_participants(trip_id,id),
  FOREIGN KEY (trip_id,to_participant_id) REFERENCES goa_core_expense_participants(trip_id,id),
  FOREIGN KEY (trip_id,created_by) REFERENCES goa_core_memberships(trip_id,user_id)
);
CREATE INDEX goa_core_repayments_trip ON goa_core_repayments(trip_id) WHERE deleted_at IS NULL;
ALTER TABLE goa_core_write_idempotency DROP CONSTRAINT goa_core_write_idempotency_scope_check;
ALTER TABLE goa_core_write_idempotency ADD CHECK (scope IN ('activity','expense','guest','repayment'));
ALTER TABLE goa_core_audit DROP CONSTRAINT goa_core_audit_action_check;
ALTER TABLE goa_core_audit ADD CONSTRAINT goa_core_audit_action_check CHECK (action IN (
  'trip.created','trip.updated','trip.deleted','invitation.created','invitation.revoked',
  'membership.requested','membership.accepted','membership.approved','membership.removed',
  'activity.created','activity.updated','activity.deleted','activity.reordered',
  'place.saved','place.unsaved','expense.created','expense.updated','expense.deleted',
  'guest.created','guest.archived','repayment.created','repayment.deleted'));
