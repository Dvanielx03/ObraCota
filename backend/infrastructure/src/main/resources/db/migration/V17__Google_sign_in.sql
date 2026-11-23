-- «Continuar con Google»: an account may be linked to one Google account (its stable "sub").
-- An account created with Google has no password until the person sets one.
alter table security_user alter column password_hash drop not null;
alter table security_user add column google_subject varchar(255);
create unique index ux_security_user_google on security_user(google_subject);
