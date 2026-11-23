-- R4: retire the pre-H1 door tables. V15 copied door_change into model_change (same ids, legacy_review, events)
-- and door_unit_price into unit_price; since then nothing reads or writes them, and the door routes are a facade
-- over model_change. door_project_minimum stays: PriceBookAdapter still keeps the project's minimum door width there.
drop table if exists door_change;
drop table if exists door_unit_price;
