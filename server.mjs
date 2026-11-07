// Gap Stack server: serves the page and data, and proxies two Claude calls.
// No dependencies. Node 18+.  Run: node server.mjs   (then open http://localhost:5173)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Minimal .env loader (keys stay out of git; see .env.example)
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

async function claude(system, user, maxTokens = 1400) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, reason: body?.error?.message || `HTTP ${res.status}` };
  return { ok: true, text: body.content.map((c) => c.text || '').join(''), model: body.model };
}

const MEMO_SYSTEM = `You write one-page funder memos for a small Orange County nonprofit that builds for-sale affordable homes.
Rules that do not bend:
- Use ONLY the numbers in the JSON you are given. Never compute new totals, never invent a number, statute, program, fee or date.
- Any number whose tag is ASSUMPTION or SYNTHETIC must be written with "(assumption)" right after it.
- Programs with status funds_unconfirmed must be described as not yet confirmed. Programs with status unknown are listed as leads only.
- Cite sources inline in short form, e.g. (HCD 2026 State Income Limits, rev. 2026-06-23) or (HCD APR Table A2, n=23 projects).
- Plain English a board member understands. No em-dashes. Markdown with short headings: The ask, The gap, Why time matters, Who can fill it, What we still need to confirm.
- Under 330 words. End with the line: "Prototype output. Not financial or legal advice."`;

const PROGRAM_SYSTEM = `You turn the text of a housing funding program page into one JSON row for a funding-stack tool.
Return ONLY JSON with keys: name, type ("buyer" or "developer"), amount ({"kind":"fixed","value":N} or {"kind":"pct_price","value":0.xx,"cap":N} or {"kind":"unknown"}), terms (one sentence quoting the page), max_ami (number or null), cities (array of UPPERCASE city names or null), status ("confirmed" | "funds_unconfirmed" | "unknown"), status_note, evidence (array of short exact quotes from the text that support each number).
Never guess. If the text does not state an amount, amount.kind is "unknown". If the text does not say funds are open, status is "funds_unconfirmed" or "unknown".`;

function fallbackMemo(p) {
  const f = (v) => '$' + Math.round(v).toLocaleString('en-US');
  return `## The ask
We are building ${p.homes} for-sale homes in ${p.city} for families earning up to ${p.bandLabel}. We need ${f(p.fundraisingTotal)} in philanthropic support to close the project (${f(p.fundraisingPer)} per home).

## The gap
Each home costs ${f(p.costPer)} to create. Under HSC 50052.5(b) a qualifying family can pay about ${f(p.familyPer)} at today's ${p.rate}% rate (Freddie Mac PMMS, ${p.rateDate}; HCD 2026 State Income Limits, rev. 2026-06-23). That leaves a gap of ${f(p.gapPer)} per home.

## Why time matters
${p.timeLine}

## Who can fill it
${p.programLines}

## What we still need to confirm
Program funds marked unconfirmed, the cost lines (assumption), and carrying-cost inputs (assumption).

_Template memo: set ANTHROPIC_API_KEY to have Claude write this from the same numbers._

Prototype output. Not financial or legal advice.`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, claude: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL });
    }
    if (req.method === 'POST' && url.pathname === '/api/memo') {
      const body = await readBody(req);
      const r = await claude(MEMO_SYSTEM, 'Write the funder memo from this engine output:\n```json\n' + JSON.stringify(body.facts, null, 1) + '\n```');
      if (r.ok) return send(res, 200, { memo: r.text, by: r.model });
      return send(res, 200, { memo: fallbackMemo(body.template), by: 'template', reason: r.reason });
    }
    if (req.method === 'POST' && url.pathname === '/api/program') {
      const body = await readBody(req);
      const text = String(body.text || '').slice(0, 30000);
      const r = await claude(PROGRAM_SYSTEM, `Source URL: ${body.url || 'pasted text'}\n\nPage text:\n${text}`, 900);
      if (!r.ok) return send(res, 200, { error: r.reason === 'no_key' ? 'Set ANTHROPIC_API_KEY in .env to use the program reader.' : r.reason });
      const m = r.text.match(/\{[\s\S]*\}/);
      try { return send(res, 200, { row: JSON.parse(m ? m[0] : r.text), by: r.model }); } catch { return send(res, 200, { error: 'Claude did not return valid JSON', raw: r.text }); }
    }
    // static: /data/* from data/, everything else from public/
    let path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const base = path.startsWith('/data/') ? ROOT : join(ROOT, 'public');
    const file = normalize(join(base, path));
    if (!file.startsWith(normalize(ROOT))) return send(res, 403, { error: 'forbidden' });
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`Gap Stack running at http://localhost:${PORT}  (Claude: ${process.env.ANTHROPIC_API_KEY ? MODEL : 'no key, template memo'})`);
});
