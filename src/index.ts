import { Env, QueueMessage } from './types';
import { handleLinkRoutes } from './routes/links';
import { processLink, resummarizeLink } from './services/processor';
import { htmlEscape } from './utils/html';
import { createMcpServerHandler } from './mcp';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for API
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // MCP endpoint (protected by Cloudflare Access at the network level)
      if (path.startsWith('/mcp')) {
        return createMcpServerHandler(env)(request, env, ctx);
      }

      // API routes
      if (path.startsWith('/api/')) {
        const response = await handleLinkRoutes(request, env, ctx);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        return response;
      }

      // Bookmarklet / browser-extension link-addition endpoint.
      // Authentication is handled externally (e.g. Cloudflare Access).
      if (path === '/add') {
        const linkUrl = url.searchParams.get('url');

        if (!linkUrl) {
          return new Response('URL parameter is required', { status: 400 });
        }

        // Validate URL — only http/https allowed
        let parsed: URL;
        try {
          parsed = new URL(linkUrl);
        } catch {
          return new Response('Invalid URL', { status: 400 });
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return new Response('Only http and https URLs are allowed', { status: 400 });
        }

        // Insert the link
        const id = crypto.randomUUID();
        try {
          await env.DB.prepare(
            'INSERT INTO links (id, url, status) VALUES (?, ?, ?)'
          ).bind(id, linkUrl, 'unread').run();
        } catch (error: unknown) {
          if (error instanceof Error && error.message?.includes('UNIQUE constraint failed')) {
            return new Response('Link already exists', { status: 409 });
          }
          return new Response('Failed to add link', { status: 500 });
        }

        // Queue for processing — non-fatal so local dev works without a queue binding
        try {
          await env.LINK_QUEUE.send({ linkId: id });
        } catch (queueError: unknown) {
          console.error(JSON.stringify({
            msg: 'queue_send_error',
            linkId: id,
            error: queueError instanceof Error ? queueError.message : String(queueError),
          }));
        }

        return new Response(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Link Added</title>
            <style>
              body { font-family: system-ui; padding: 40px; text-align: center; }
              .success { color: #28B47C; font-size: 24px; margin-bottom: 20px; }
              a { color: #0066FF; }
            </style>
          </head>
          <body>
            <div class="success">&#10003; Link Added Successfully</div>
            <p>${htmlEscape(linkUrl)}</p>
            <p><a href="/">Go to Links</a></p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </body>
          </html>
        `, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Client-side routes: serve the SPA shell so the app can hydrate.
      if (path.startsWith('/article/')) {
        // Let the assets binding serve the root index.html.
        const indexRequest = new Request(new URL('/', request.url).toString(), request);
        return env.ASSETS.fetch(indexRequest);
      }

      // Static assets are served automatically via the assets binding in wrangler.toml
      return new Response(null, { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({
        msg: 'unhandled_worker_error',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },

  // Queue consumer — processes up to CONCURRENCY links in parallel per batch.
  async queue(batch: MessageBatch<QueueMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    const CONCURRENCY = 3;
    const pending = [...batch.messages];

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        let message;
        while ((message = pending.shift())) {
          try {
            if (message.body.resummarize) {
              await resummarizeLink(message.body.linkId, env);
            } else {
              await processLink(message.body.linkId, env, ctx);
            }
            message.ack();
          } catch (error) {
            console.error(JSON.stringify({
              msg: 'queue_retry',
              linkId: message.body.linkId,
              error: error instanceof Error ? error.message : String(error),
            }));
            message.retry();
          }
        }
      })
    );
  }
};
