// ════════════════════════════════════════════════
// notes.js — Netlify Function
// GET    /?club_id=xxx         → fetch all notes for club
// POST   {id,coach,type,text,club_id}  → upsert note
// DELETE {id,club_id}          → remove note
// ════════════════════════════════════════════════
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      type       TEXT,
      text       TEXT,
      coach      TEXT,
      club_id    TEXT NOT NULL DEFAULT 'default',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Safe migration — add club_id if table pre-dates multi-club support
  await client.query(
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS club_id TEXT NOT NULL DEFAULT 'default'`
  ).catch(() => {}); // ignore if column already exists
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const client = await pool.connect();
  try {
    await ensureTable(client);

    // ── GET — fetch all notes for this club ──────────────────────────
    if (event.httpMethod === 'GET') {
      const club_id = (event.queryStringParameters || {}).club_id || 'default';
      const result  = await client.query(
        'SELECT id, type, text, coach, club_id, created_at FROM notes WHERE club_id = $1 ORDER BY created_at ASC',
        [club_id]
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result.rows) };
    }

    // ── POST — upsert a note ─────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body    = JSON.parse(event.body || '{}');
      const { id, coach, type, text } = body;
      const club_id = body.club_id || 'default';
      if (!id || !text) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'id and text required' }) };
      }
      await client.query(
        `INSERT INTO notes (id, type, text, coach, club_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, type = EXCLUDED.type`,
        [id, type || 'general', text, coach || 'Coach', club_id]
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // ── DELETE — remove a note ───────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      if (!id) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'id required' }) };
      }
      await client.query('DELETE FROM notes WHERE id = $1', [id]);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('notes.js error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  } finally {
    client.release();
  }
};
