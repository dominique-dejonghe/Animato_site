INSERT INTO member_photos (user_id, data, content_type, size_bytes)
SELECT 
  p.user_id,
  REPLACE(REPLACE(p.foto_url, 'data:image/jpeg;base64,', ''), 'data:image/png;base64,', '') as data,
  CASE WHEN p.foto_url LIKE 'data:image/png%' THEN 'image/png' ELSE 'image/jpeg' END as content_type,
  CAST(LENGTH(REPLACE(REPLACE(p.foto_url, 'data:image/jpeg;base64,', ''), 'data:image/png;base64,', '')) * 3 / 4 AS INTEGER) as size_bytes
FROM profiles p
WHERE p.foto_url IS NOT NULL AND p.foto_url LIKE 'data:%'
ON CONFLICT(user_id) DO UPDATE SET
  data = excluded.data,
  content_type = excluded.content_type,
  size_bytes = excluded.size_bytes,
  updated_at = CURRENT_TIMESTAMP;

UPDATE profiles SET foto_url = '/api/photos/' || user_id WHERE foto_url IS NOT NULL AND foto_url LIKE 'data:%';
