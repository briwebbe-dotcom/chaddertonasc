// ════════════════════════════════════════════════
// coach-sync.js — Netlify Function
// GET  /?club_id=xxx   → fetch full coach data blob
// POST {club_id, data} → upsert full coach data blob
//
// The `data` field is stored as TEXT (JSON string) to avoid
// Postgres JSONB casting issues with very large payloads.
// Client receives it back as a JSON string and parses it.
// ════════════════════════════════════════════════
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS coach_data (
      club_id    TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const client = await pool.connect();
  try {
    await ensureTable(client);

    // ── GET — pull full data blob for a club ─────────────────────────
    if (event.httpMethod === 'GET') {
      const club_id = (event.queryStringParameters || {}).club_id;
      if (!club_id) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'club_id required' }) };
      }
      const result = await client.query(
        'SELECT data, updated_at FROM coach_data WHERE club_id = $1',
        [club_id]
      );
      if (!result.rows.length) {
        return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'No data found for this Club ID' }) };
      }
      const row = result.rows[0];
      // Normalise: data may be TEXT or JSONB depending on existing table schema
      const dataStr = typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ data: dataStr, updated_at: row.updated_at })
      };
    }

    // ── POST — push full data blob for a club ────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { club_id, data } = body;
      if (!club_id || !data) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'club_id and data required' }) };
      }
      // Always store as TEXT string
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      await client.query(
        `INSERT INTO coach_data (club_id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (club_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [club_id, dataStr]
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('coach-sync.js error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  } finally {
    client.release();
  }
};
