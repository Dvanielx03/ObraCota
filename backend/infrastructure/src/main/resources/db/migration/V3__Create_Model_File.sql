create table model_file (
  id uuid primary key,
  project_id uuid not null references project(id) on delete cascade,
  name varchar(255) not null,
  format varchar(3) not null,
  unique(project_id, name)
);
