-- Conversion of a stored Revit RVT version to IFC by Autodesk Model Derivative (layer 2 of RVT support).
create table revit_translation (
  id uuid primary key,
  project_id uuid not null references project(id) on delete cascade,
  version_id uuid not null references model_version(id) on delete cascade,
  status varchar(12) not null,
  message varchar(1000),
  result_version_id uuid references model_version(id) on delete set null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  constraint ck_revit_translation_status check (status in ('QUEUED','UPLOADING','TRANSLATING','STORING','DONE','FAILED'))
);
create index ix_revit_translation_version on revit_translation(version_id, created_at);
