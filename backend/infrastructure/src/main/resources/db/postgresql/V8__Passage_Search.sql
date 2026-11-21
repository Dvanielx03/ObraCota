create extension if not exists vector;
create table specification_passage (
 document_id uuid not null references element_specification(id) on delete cascade,
 page_number int not null, offset_chars int not null, content text not null,
 embedding vector(768), embedding_model varchar(100),
 words tsvector generated always as (to_tsvector('simple',content)) stored,
 primary key(document_id,page_number,offset_chars)
);
create index passage_words on specification_passage using gin(words);
