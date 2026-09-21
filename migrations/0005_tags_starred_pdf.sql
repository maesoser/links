ALTER TABLE links ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE links ADD COLUMN is_pdf INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_links_starred ON links(starred, created_at DESC);

CREATE TABLE IF NOT EXISTS link_tags (
    link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (link_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_link_tags_tag ON link_tags(tag);
CREATE INDEX IF NOT EXISTS idx_link_tags_link ON link_tags(link_id);

UPDATE links
SET is_pdf = 1
WHERE lower(url) LIKE '%.pdf'
   OR lower(COALESCE(content_type, '')) LIKE '%pdf%';
