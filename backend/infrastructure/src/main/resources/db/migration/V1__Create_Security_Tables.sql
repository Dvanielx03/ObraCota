create table security_user (
  id uuid primary key,
  email varchar(254) not null unique,
  password_hash varchar(100) not null,
  role varchar(24) not null
);
create table refresh_token (
  id uuid primary key,
  user_id uuid not null references security_user(id),
  token_id uuid not null,
  expires_at timestamp with time zone not null
);
create index ix_refresh_user on refresh_token(user_id);
