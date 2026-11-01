-- Allow .ppt legacy files in the private 'files' storage bucket.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/vnd.ms-powerpoint')
where id = 'files' and not ('application/vnd.ms-powerpoint' = any(allowed_mime_types));
