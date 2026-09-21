-- Add UNIQUE constraint on processing_queue.link_id.
-- SQLite does not support ALTER TABLE ADD UNIQUE, so we recreate the table.
-- Existing rows are preserved.

CREATE TABLE processing_queue_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    link_id TEXT NOT NULL UNIQUE REFERENCES links(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    processed_at TEXT
);

-- Copy existing rows; in the unlikely event of duplicate link_id entries,
-- keep only the most recent one (highest rowid).
INSERT INTO processing_queue_new
    SELECT id, link_id, status, attempts, error_message, created_at, processed_at
    FROM processing_queue
    WHERE rowid IN (
        SELECT MAX(rowid) FROM processing_queue GROUP BY link_id
    );

DROP TABLE processing_queue;
ALTER TABLE processing_queue_new RENAME TO processing_queue;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_queue_status  ON processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_link_id ON processing_queue(link_id);
