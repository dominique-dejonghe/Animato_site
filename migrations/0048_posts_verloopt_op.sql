-- Add expiry date to posts for auto-hiding
-- When verloopt_op is set and past, the post is automatically hidden from public view
ALTER TABLE posts ADD COLUMN verloopt_op DATE;
