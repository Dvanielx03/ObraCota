-- A project the app keeps for each person to use the server tools (Renderizar, Panorama 360) on a public sample
-- such as ReStage. It holds one version of the sample and stays out of the person's project list; it is null on
-- every project the person creates. Unique per owner and sample (nulls are distinct, so ordinary projects are unaffected).
alter table project add column sample varchar(16);
alter table project add constraint uq_project_owner_sample unique (owner_id, sample);
