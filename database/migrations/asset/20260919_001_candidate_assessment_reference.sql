ALTER TABLE asset.replacement_plans
  ADD COLUMN recommendation_assessment_id text,
  ADD COLUMN scoring_profile_id text,
  ADD COLUMN scoring_profile_version text;

CREATE INDEX replacement_plan_assessment_reference
  ON asset.replacement_plans(tenant_id,recommendation_assessment_id)
  WHERE recommendation_assessment_id IS NOT NULL;
