export interface BrowserRun {
  quickAction(action: string, options: Record<string, unknown>): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  AI: Ai;
  BROWSER: BrowserRun;
  LINK_QUEUE: Queue;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
}

export interface Link {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  author: string | null;
  site_name: string | null;
  published_date: string | null;
  image_url: string | null;
  favicon_url: string | null;
  content_type: string | null;
  status: 'read' | 'unread';
  markdown_content: string | null;
  ai_summary: string | null;
  reading_time_minutes: number | null;
  created_at: string;
  updated_at: string;
  metadata_extracted_at: string | null;
  scraped_at: string | null;
  domain: string | null;
  starred: number;
  is_pdf: number;
  tags?: string[];
  processing_status?: 'pending' | 'processing' | 'completed' | 'failed' | null;
  processing_error?: string | null;
}

export interface CreateLinkRequest {
  url: string;
  title?: string;
  tags?: string[];
}

export interface UpdateLinkRequest {
  status?: 'read' | 'unread';
  title?: string;
  starred?: boolean;
  tags?: string[];
}

export interface BulkLinksRequest {
  ids: string[];
  action: 'read' | 'unread' | 'delete' | 'resummarize' | 'star' | 'unstar';
}

export interface QueueMessage {
  linkId: string;
  resummarize?: boolean;
}