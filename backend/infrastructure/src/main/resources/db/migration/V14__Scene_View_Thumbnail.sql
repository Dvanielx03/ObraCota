-- Small JPEG preview of each saved view (the saved-view strip and the project cover).
-- Older views keep both columns empty and the interface shows their number instead.
alter table scene_view add column thumbnail bytea;
alter table scene_view add column thumbnail_type varchar(20);
alter table scene_view add constraint ck_scene_view_thumbnail check ((thumbnail is null) = (thumbnail_type is null));
