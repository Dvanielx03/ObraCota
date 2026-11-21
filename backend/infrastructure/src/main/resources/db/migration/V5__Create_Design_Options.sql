create table ai_model (id varchar(100) primary key, capability varchar(12) not null);
insert into ai_model values ('gemini-3.1-flash-lite','CHAT'), ('gemini-3.1-flash-image','IMAGE');
create table ai_budget_lock (id integer primary key);
insert into ai_budget_lock values (1);
create table design_option_batch (
 id uuid primary key, version_id uuid not null references model_version(id) on delete cascade,
 owner_id uuid not null references security_user(id), element_key varchar(512) not null, description varchar(2000) not null,
 element_name varchar(512) not null, started_at timestamp with time zone, captured bytea not null, state varchar(16) not null, created_at timestamp with time zone not null,
 selected_slot integer, selected_at timestamp with time zone
);
create index design_option_version on design_option_batch(version_id,created_at);
create table design_option (
 batch_id uuid not null references design_option_batch(id) on delete cascade,
 slot integer not null, description varchar(500) not null, image_bytes bytea not null, mime varchar(32) not null,
 primary key(batch_id,slot)
);
create table ai_run (
 id uuid primary key, batch_id uuid not null, slot integer not null, model_id varchar(100) not null references ai_model(id),
 status varchar(16) not null, error_code varchar(80), input_tokens integer, output_tokens integer, total_tokens integer,
 created_at timestamp with time zone not null, unique(batch_id,slot)
);
create table ai_month_budget (month_key varchar(7) primary key, reserved_cents integer not null);
