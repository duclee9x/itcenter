ALTER TABLE license.assignments
  ADD COLUMN cancelled_at timestamptz;

ALTER TABLE license.assignments
  DROP CONSTRAINT IF EXISTS assignments_state_check;

ALTER TABLE license.assignments
  ADD CONSTRAINT assignments_state_check
    CHECK (state IN (
      'ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING','RECLAIMED','EXPIRED','CANCELLED'
    )),
  ADD CONSTRAINT assignments_cancelled_at_check
    CHECK ((state='CANCELLED') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT assignments_cancelled_unactivated_check
    CHECK (state<>'CANCELLED' OR activated_at IS NULL);

ALTER TABLE license.assignment_history
  DROP CONSTRAINT IF EXISTS assignment_history_action_check;

ALTER TABLE license.assignment_history
  ADD CONSTRAINT assignment_history_action_check
    CHECK (action IN (
      'ASSIGNED','ACTIVATED','SUSPENDED','RECLAIM_PENDING','RECLAIMED','CANCELLED'
    ));

CREATE FUNCTION license.guard_assignment_cancellation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='CANCELLED' AND NEW.state<>'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled license assignment is terminal';
  END IF;
  IF NEW.state='CANCELLED' AND OLD.state<>'ASSIGNED' THEN
    RAISE EXCEPTION 'only an assigned license may be cancelled';
  END IF;
  IF NEW.state='CANCELLED'
     AND (OLD.activated_at IS NOT NULL OR NEW.activated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'activated license assignment cannot be cancelled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignments_guard_cancellation
  BEFORE UPDATE OF state,activated_at ON license.assignments
  FOR EACH ROW EXECUTE FUNCTION license.guard_assignment_cancellation();
