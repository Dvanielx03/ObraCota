create table door_change (
 id uuid primary key,
 project_id uuid not null references project(id) on delete cascade,
 base_version uuid not null references model_version(id) on delete cascade,
 author_id uuid not null references security_user(id),
 element_key varchar(22) not null,
 type_key varchar(22) not null,
 description varchar(2000) not null,
 picture bytea,
 review text not null,
 applied_version uuid references model_version(id) on delete set null,
 restored_version uuid references model_version(id) on delete set null,
 created_at timestamp with time zone not null,
 applied_at timestamp with time zone
);
create index door_change_project on door_change(project_id,created_at);
create table door_unit_price (
 project_id uuid not null references project(id) on delete cascade,
 version_id uuid not null references model_version(id) on delete cascade,
 type_key varchar(22) not null, amount decimal(18,2) not null,
 source varchar(300) not null, price_date date not null,
 primary key(project_id,version_id,type_key)
);
create table door_project_minimum (
 project_id uuid primary key references project(id) on delete cascade,
 width_m decimal(10,6) not null
);
