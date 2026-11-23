create table agent_run (
  id uuid primary key,
  project_id uuid not null references project(id) on delete cascade,
  version_id uuid not null references model_version(id) on delete cascade,
  user_id uuid not null references security_user(id),
  provider varchar(32) not null,
  model varchar(128) not null,
  status varchar(16) not null,
  message text not null,
  change_id uuid references model_change(id) on delete set null,
  started_at timestamp with time zone not null,
  finished_at timestamp with time zone,
  constraint ck_agent_run_status check (status in ('RUNNING','READY','NO_CHANGE','DISCARDED','STOPPED_LIMIT','FAILED','INTERRUPTED','LEGACY')),
  constraint ck_agent_run_finished check ((status in ('RUNNING','LEGACY')) = (finished_at is null))
);
create index ix_agent_run_version on agent_run(project_id, user_id, version_id, started_at);
create index ix_agent_run_change on agent_run(project_id, user_id, change_id, started_at);

-- Older linked drafts have a version and an author, but no recorded terminal outcome or provider.
insert into agent_run(id,project_id,version_id,user_id,provider,model,status,message,change_id,started_at)
select c.agent_run_id,c.project_id,c.base_version,c.author_id,'unknown','unknown','LEGACY',
       'Ejecución anterior vinculada al cambio.',c.id,
       coalesce((select min(step.created_at) from agent_tool_call step where step.run_id=c.agent_run_id),c.created_at)
from (
  select draft.*,row_number() over(partition by draft.agent_run_id order by draft.created_at,draft.id) as run_order
  from model_change draft
  where draft.origin='AGENT' and draft.agent_run_id is not null
) c
where c.run_order=1;
