create table element_specification (
 id uuid primary key, version_id uuid not null references model_version(id) on delete cascade,
 element_key varchar(512) not null, filename varchar(255) not null, sha256 varchar(64) not null,
 original bytea not null, unique(version_id,element_key,sha256)
);
create table specification_page (
 document_id uuid not null references element_specification(id) on delete cascade,
 page_number integer not null, content text not null, primary key(document_id,page_number)
);
