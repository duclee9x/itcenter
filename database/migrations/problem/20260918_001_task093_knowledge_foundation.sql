ALTER TABLE problem.knowledge_articles
  ADD COLUMN audience text NOT NULL DEFAULT 'OPERATOR_ONLY'
    CHECK (audience IN ('END_USER_SAFE','OPERATOR_ONLY')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT knowledge_articles_tenant_id_id_unique UNIQUE (tenant_id,id);

ALTER TABLE problem.problems
  ADD CONSTRAINT problems_tenant_id_id_unique UNIQUE (tenant_id,id);

CREATE TABLE problem.knowledge_applicability (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  knowledge_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN (
    'SERVICE','PLATFORM','SERVICE_ENVIRONMENT','SOFTWARE_PRODUCT','PROBLEM','KNOWN_ERROR'
  )),
  service_id uuid,
  platform_id uuid,
  service_environment_id uuid,
  software_product_id uuid,
  problem_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  FOREIGN KEY (tenant_id,knowledge_id)
    REFERENCES problem.knowledge_articles(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,service_id)
    REFERENCES service.services(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,platform_id)
    REFERENCES service.platforms(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,service_environment_id)
    REFERENCES service.environments(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,software_product_id)
    REFERENCES software.software_products(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,problem_id)
    REFERENCES problem.problems(tenant_id,id) ON DELETE RESTRICT,
  CHECK (
    (target_type='SERVICE' AND service_id IS NOT NULL AND num_nonnulls(platform_id,service_environment_id,software_product_id,problem_id)=0)
    OR (target_type='PLATFORM' AND platform_id IS NOT NULL AND num_nonnulls(service_id,service_environment_id,software_product_id,problem_id)=0)
    OR (target_type='SERVICE_ENVIRONMENT' AND service_environment_id IS NOT NULL AND num_nonnulls(service_id,platform_id,software_product_id,problem_id)=0)
    OR (target_type='SOFTWARE_PRODUCT' AND software_product_id IS NOT NULL AND num_nonnulls(service_id,platform_id,service_environment_id,problem_id)=0)
    OR (target_type IN ('PROBLEM','KNOWN_ERROR') AND problem_id IS NOT NULL AND num_nonnulls(service_id,platform_id,service_environment_id,software_product_id)=0)
  )
);

CREATE UNIQUE INDEX knowledge_applicability_service_unique
  ON problem.knowledge_applicability(tenant_id,knowledge_id,service_id)
  WHERE target_type='SERVICE';
CREATE UNIQUE INDEX knowledge_applicability_platform_unique
  ON problem.knowledge_applicability(tenant_id,knowledge_id,platform_id)
  WHERE target_type='PLATFORM';
CREATE UNIQUE INDEX knowledge_applicability_environment_unique
  ON problem.knowledge_applicability(tenant_id,knowledge_id,service_environment_id)
  WHERE target_type='SERVICE_ENVIRONMENT';
CREATE UNIQUE INDEX knowledge_applicability_software_unique
  ON problem.knowledge_applicability(tenant_id,knowledge_id,software_product_id)
  WHERE target_type='SOFTWARE_PRODUCT';
CREATE UNIQUE INDEX knowledge_applicability_problem_unique
  ON problem.knowledge_applicability(tenant_id,knowledge_id,target_type,problem_id)
  WHERE target_type IN ('PROBLEM','KNOWN_ERROR');
CREATE INDEX knowledge_applicability_target_lookup
  ON problem.knowledge_applicability(tenant_id,target_type,knowledge_id);
