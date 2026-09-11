const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const INGEST_TOKEN = process.env.INGEST_TOKEN || '';

const TARGET = {
  primaryNumber: '504-494-4022',
  historicalNumbers: ['504-400-3107'],
  names: ['Rebecca Canady', 'ohmygodbeckky'],
  since: '2020-01-01T00:00:00.000Z'
};

let events = [];

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

function isTargetRecord(record = {}) {
  const blob = JSON.stringify(record).toLowerCase();
  const numbers = [TARGET.primaryNumber, ...TARGET.historicalNumbers]
    .map(normalizePhone)
    .filter(Boolean);
  const nameHit = TARGET.names.some((n) => blob.includes(n.toLowerCase()));
  const numberHit = numbers.some((n) => normalizePhone(blob).includes(n));
  return nameHit || numberHit;
}

function afterCutoff(record = {}) {
  const raw = record.timestamp || record.date || record.created_at || record.createdAt;
  if (!raw) return true;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t >= new Date(TARGET.since).getTime() : true;
}

function requireToken(req, res, next) {
  if (!INGEST_TOKEN) return res.status(503).json({ error: 'INGEST_TOKEN is not configured on the server.' });
  const supplied = req.get('x-ingest-token') || req.query.token;
  if (supplied !== INGEST_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/target', (_req, res) => res.json(TARGET));

app.get('/api/events', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);
  const source = req.query.source ? String(req.query.source).toLowerCase() : null;
  const out = events
    .filter((e) => !source || String(e.source || '').toLowerCase() === source)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, limit);
  res.json({ count: out.length, events: out, updatedAt: new Date().toISOString() });
});

app.post('/api/ingest', requireToken, (req, res) => {
  const incoming = Array.isArray(req.body) ? req.body : [req.body];
  const accepted = [];
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue;
    const record = {
      id: raw.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      source: raw.source || 'authorized-feed',
      type: raw.type || 'activity',
      timestamp: raw.timestamp || raw.date || new Date().toISOString(),
      title: raw.title || raw.name || raw.from || raw.handle || 'Activity',
      summary: raw.summary || raw.text || raw.message || '',
      phone: raw.phone || raw.number || '',
      handle: raw.handle || raw.username || '',
      raw
    };
    if (!afterCutoff(record) || !isTargetRecord(record)) continue;
    accepted.push(record);
  }
  events = [...accepted, ...events].slice(0, 5000);
  res.json({ accepted: accepted.length, ignored: incoming.length - accepted.length, totalStored: events.length });
});

app.post('/api/import', (req, res) => {
  const incoming = Array.isArray(req.body) ? req.body : req.body?.records;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Send {"records": [...]} or a JSON array.' });
  const matched = incoming.filter((r) => r && typeof r === 'object' && afterCutoff(r) && isTargetRecord(r));
  const mapped = matched.map((raw) => ({
    id: raw.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: raw.source || 'manual-import',
    type: raw.type || 'record',
    timestamp: raw.timestamp || raw.date || raw.created_at || new Date().toISOString(),
    title: raw.title || raw.name || raw.from || raw.handle || 'Imported record',
    summary: raw.summary || raw.text || raw.message || '',
    phone: raw.phone || raw.number || '',
    handle: raw.handle || raw.username || '',
    raw
  }));
  events = [...mapped, ...events].slice(0, 5000);
  res.json({ imported: mapped.length, scanned: incoming.length, totalStored: events.length });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, now: new Date().toISOString(), storedEvents: events.length }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Target Activity Hub listening on port ${PORT}`);
});
