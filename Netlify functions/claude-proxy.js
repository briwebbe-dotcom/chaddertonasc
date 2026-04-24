// ════════════════════════════════════════════════
// claude-proxy.js — Netlify Function
// POST {messages, apiKey, model}
//
// Server-side proxy for Anthropic API calls.
// The app now calls Anthropic directly from the browser
// using the 'anthropic-dangerous-direct-browser-access' header.
// This function is kept as a server-side fallback if needed.
// ════════════════════════════════════════════════
const https = require('https');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const body    = JSON.parse(event.body || '{}');
    const apiKey  = body.apiKey || process.env.ANTHROPIC_API_KEY || '';
    const model   = body.model  || 'claude-sonnet-4-6';
    const messages = body.messages || [];
    const maxTokens = body.max_tokens || 1800;

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Valid Anthropic API key required' }) };
    }

    const payload = JSON.stringify({ model, max_tokens: maxTokens, messages });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':        'application/json',
          'Content-Length':      Buffer.byteLength(payload),
          'x-api-key':           apiKey,
          'anthropic-version':   '2023-06-01'
        }
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    return {
      statusCode: result.status,
      headers:    HEADERS,
      body:       result.body
    };

  } catch (err) {
    console.error('claude-proxy.js error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
