create table scene_view (
    id uuid primary key, version_id uuid not null references model_version(id) on delete cascade,
    name varchar(60) not null,
    px double precision not null, py double precision not null, pz double precision not null,
    tx double precision not null, ty double precision not null, tz double precision not null,
    span double precision not null, created_at timestamp with time zone not null
);
create index ix_scene_view_version on scene_view(version_id,created_at,id);
