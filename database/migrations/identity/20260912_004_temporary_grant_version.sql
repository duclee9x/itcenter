ALTER TABLE identity.temporary_grants
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN revoked_at timestamptz;
