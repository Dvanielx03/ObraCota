create table project (
    id uuid primary key,
    owner_id uuid not null references security_user(id),
    name varchar(120) not null,
    created_at timestamp with time zone not null,
    updated_at timestamp with time zone not null
);
create index ix_project_owner_created on project(owner_id,created_at,id);
