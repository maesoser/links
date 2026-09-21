import { execFileSync } from "node:child_process";

const ACCOUNT_ID = "ef14d03a812ae805da92b1f3370faf8a";
const QUEUE_ID = "5f8f6f19161744c7bfdabece6ef07155";
const DATABASE = "links-db";
const BATCH = 100;

const email = process.env.CLOUDFLARE_EMAIL || process.env.CF_API_EMAIL;
const apiKey = process.env.CLOUDFLARE_API_KEY || process.env.CF_API_KEY;

if (!email || !apiKey) {
  console.error("Missing CLOUDFLARE_EMAIL / CLOUDFLARE_API_KEY (or CF_API_EMAIL / CF_API_KEY).");
  process.exit(1);
}

const sql =
  "SELECT id FROM links WHERE markdown_content IS NOT NULL AND length(markdown_content) >= 100";

const raw = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", sql],
  { encoding: "utf8" }
);

const parsed = JSON.parse(raw);
const ids = parsed
  .flatMap((entry) => entry.results ?? [])
  .map((row) => row.id)
  .filter(Boolean);

if (ids.length === 0) {
  console.log("No eligible links to re-summarize.");
  process.exit(0);
}

console.log(`Queuing ${ids.length} links for re-summarization...`);

for (let i = 0; i < ids.length; i += BATCH) {
  const chunk = ids.slice(i, i + BATCH);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/queues/${QUEUE_ID}/messages/batch`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Email": email,
        "X-Auth-Key": apiKey,
      },
      body: JSON.stringify({
        messages: chunk.map((id) => ({
          body: { linkId: id, resummarize: true },
          content_type: "json",
        })),
      }),
    }
  );

  const body = await response.json();
  if (!response.ok || body.success === false) {
    console.error(`Batch ${i / BATCH + 1} failed (${response.status}):`, body.errors ?? body);
    process.exit(1);
  }

  console.log(`Queued ${Math.min(i + BATCH, ids.length)} / ${ids.length}`);
}

console.log("Done. Summaries will update as the queue consumer processes them.");
