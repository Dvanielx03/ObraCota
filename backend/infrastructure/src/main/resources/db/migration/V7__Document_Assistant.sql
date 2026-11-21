insert into ai_model values ('gemini-embedding-2','EMBEDDING');
create table document_answer (
 id uuid primary key, document_id uuid not null references element_specification(id) on delete cascade,
 question varchar(600) not null, result text, created_at timestamp with time zone not null
);
create index document_answer_history on document_answer(document_id,created_at);
