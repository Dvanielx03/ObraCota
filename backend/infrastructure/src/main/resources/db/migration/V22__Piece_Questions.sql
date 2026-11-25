-- Questions about every specification of one piece (version + element): the answer may cite several documents.
alter table document_answer alter column document_id drop not null;
alter table document_answer add column version_id uuid references model_version(id) on delete cascade;
alter table document_answer add column element_key varchar(512);
alter table document_answer add constraint document_answer_scope check (document_id is not null or (version_id is not null and element_key is not null));
create index document_answer_piece on document_answer(version_id,element_key,created_at);
