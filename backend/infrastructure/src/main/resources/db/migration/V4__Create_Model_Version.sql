create table model_version (
    id uuid primary key, file_id uuid not null references model_file(id) on delete cascade,
    revision integer not null, name varchar(255) not null, format varchar(3) not null,
    byte_size bigint not null, sha256 varchar(64) not null, uploaded_at timestamp with time zone not null,
    uploaded_by uuid not null references security_user(id), uploader_email varchar(254) not null,
    unique(file_id,revision)
);
create table version_observation (
    id uuid primary key, version_id uuid not null references model_version(id) on delete cascade,
    element_key varchar(512) not null, note varchar(4000) not null, unique(version_id,element_key)
);
