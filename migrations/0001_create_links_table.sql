-- Create links table
CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    description TEXT,
    author TEXT,
    site_name TEXT,
    published_date TEXT,
    image_url TEXT,
    favicon_url TEXT,
    content_type TEXT,
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('read', 'unread')),
    markdown_content TEXT,
    ai_summary TEXT,
    -- ISO-8601 UTC timestamps (e.g. 2026-05-22T14:31:00Z) for unambiguous parsing
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    metadata_extracted_at TEXT,
    scraped_at TEXT,
    reading_time_minutes INTEGER,
    -- Generated domain column — handles URLs with and without a trailing slash
    domain TEXT GENERATED ALWAYS AS (
        CASE
            WHEN url LIKE 'http://%' THEN
                CASE
                    WHEN instr(substr(url, 8), '/') > 0
                    THEN substr(url, 8, instr(substr(url, 8), '/') - 1)
                    ELSE substr(url, 8)
                END
            WHEN url LIKE 'https://%' THEN
                CASE
                    WHEN instr(substr(url, 9), '/') > 0
                    THEN substr(url, 9, instr(substr(url, 9), '/') - 1)
                    ELSE substr(url, 9)
                END
            ELSE NULL
        END
    ) STORED
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_links_status ON links(status);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_domain ON links(domain);
-- Composite index for the common filtered+sorted list query
CREATE INDEX IF NOT EXISTS idx_links_status_created ON links(status, created_at DESC);

-- Create processing queue table for tracking async jobs
CREATE TABLE IF NOT EXISTS processing_queue (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    link_id TEXT NOT NULL UNIQUE REFERENCES links(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_link_id ON processing_queue(link_id);
