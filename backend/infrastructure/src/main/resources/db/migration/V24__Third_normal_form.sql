-- Third normal form: every non-key column depends on the key, the whole key and nothing but the key.
-- Each column dropped here repeated a fact that another table already holds; the backend now reads it through a join.
-- Before this migration the repeated values matched their source on every row, so no information is lost.

-- 1. The uploader's email is a fact of the user (uploaded_by -> security_user.email), not of the version.
alter table model_version drop column uploader_email;

-- 2. The text of each option was stored twice: in design_option_description (written first) and in design_option.
insert into design_option_description(batch_id, slot, description)
select o.batch_id, o.slot, o.description from design_option o
where not exists (select 1 from design_option_description d where d.batch_id = o.batch_id and d.slot = o.slot);
alter table design_option drop column description;
alter table design_option add constraint fk_design_option_description
  foreign key (batch_id, slot) references design_option_description(batch_id, slot) on delete cascade;

-- 3. A Revit translation belongs to the project of its version (version_id -> model_file.project_id).
alter table revit_translation drop column project_id;

-- 4. An agent run belongs to the project of its version.
drop index ix_agent_run_version;
drop index ix_agent_run_change;
alter table agent_run drop column project_id;
create index ix_agent_run_version on agent_run(version_id, user_id, started_at);
create index ix_agent_run_change on agent_run(change_id, started_at);

-- 5. A tool call takes its project and person from its run. Calls journaled before runs were recorded (V20) belong to no
--    run, no change and no version; they are removed so that run_id can reference agent_run.
delete from agent_tool_call where not exists (select 1 from agent_run r where r.id = agent_tool_call.run_id);
alter table agent_tool_call drop column project_id;
alter table agent_tool_call drop column user_id;
alter table agent_tool_call add constraint fk_agent_tool_call_run foreign key (run_id) references agent_run(id) on delete cascade;

-- 6. A model change takes its file, format and project from its base version (base_version -> model_version.file_id,
--    model_version.format -> model_file.project_id). The use cases keep a change on IFC, DWG or DXF versions only.
drop index ix_model_change_project;
drop index ix_model_change_status;
alter table model_change drop constraint ck_model_change_format;
alter table model_change drop column project_id;
alter table model_change drop column file_id;
alter table model_change drop column format;
create index ix_model_change_status on model_change(status, created_at);

-- 7. A unit price belongs to the project of its version: the key is the version and the price key. project_id was part
--    of the old primary key, so the table is rebuilt (the same statements run on PostgreSQL and on the H2 of the tests).
create table unit_price_3fn (
  version_id uuid not null references model_version(id) on delete cascade,
  price_key varchar(80) not null,
  unit varchar(8) not null,
  currency varchar(3) not null,
  amount decimal(18,2) not null,
  source varchar(300) not null,
  price_date date not null,
  copied_from uuid references model_version(id) on delete set null,
  updated_at timestamp with time zone not null,
  primary key (version_id, price_key)
);
insert into unit_price_3fn(version_id, price_key, unit, currency, amount, source, price_date, copied_from, updated_at)
select version_id, price_key, unit, currency, amount, source, price_date, copied_from, updated_at from unit_price;
drop table unit_price;
alter table unit_price_3fn rename to unit_price;
alter table unit_price add constraint ck_unit_price_unit check (unit in ('UNIT','M','M2','M3'));
alter table unit_price add constraint ck_unit_price_amount check (amount >= 0);
