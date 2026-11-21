create table design_option_description (
 batch_id uuid not null references design_option_batch(id) on delete cascade,
 slot int not null, description varchar(500) not null, primary key(batch_id,slot)
);
