ALTER TABLE operations.work_items
  ADD COLUMN context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT work_items_context_object CHECK (jsonb_typeof(context_json)='object');
