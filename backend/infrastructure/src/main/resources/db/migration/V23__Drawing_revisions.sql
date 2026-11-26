-- DWG revisions are written as DXF («Revisión DXF real»): a change can be drafted over a DXF version of a drawing.
alter table model_change drop constraint ck_model_change_format;
alter table model_change add constraint ck_model_change_format check (format in ('IFC','DWG','DXF'));
