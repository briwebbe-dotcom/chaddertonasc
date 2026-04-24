// ════════════════════════════════════════════════
// swimmers.js — Netlify Function
// GET  /?club_id=xxx        → fetch roster array
// POST {club_id, roster}   → upsert full roster
//
// Roster stored as TEXT (JSON string) for consistency
// with coach-sync. Returned as a parsed array.
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
    CREATE TABLE IF NOT EXISTS swimmers (
      club_id    TEXT PRIMARY KEY,
      roster     TEXT NOT NULL,
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

    // ── GET — fetch roster for a club ───────────────────────────────
    if (event.httpMethod === 'GET') {
      const club_id = (event.queryStringParameters || {}).club_id;
      if (!club_id) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'club_id required' }) };
      }
      const result = await client.query(
        'SELECT roster FROM swimmers WHERE club_id = $1',
        [club_id]
      );
      if (!result.rows.length) {
        // Return empty roster — not a 404, just nothing stored yet
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ roster: [] }) };
      }
      const row = result.rows[0];
      // Normalise: may be TEXT string or JSONB array
      let rosterArr;
      if (typeof row.roster === 'string') {
        try { rosterArr = JSON.parse(row.roster); } catch(e) { rosterArr = []; }
      } else {
        rosterArr = row.roster || [];
      }
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ roster: rosterArr }) };
    }

    // ── POST — upsert roster for a club ─────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { club_id, roster } = body;
      if (!club_id || !roster) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'club_id and roster required' }) };
      }
      const rosterStr = typeof roster === 'string' ? roster : JSON.stringify(roster);
      await client.query(
        `INSERT INTO swimmers (club_id, roster, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (club_id) DO UPDATE SET roster = EXCLUDED.roster, updated_at = NOW()`,
        [club_id, rosterStr]
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('swimmers.js error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  } finally {
    client.release();
  }
};
