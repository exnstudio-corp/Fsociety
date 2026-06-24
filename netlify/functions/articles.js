/**
 * netlify/functions/articles.js
 * F-Society — JSONBin Proxy Function
 * EXN STUDIO
 *
 * Proxies requests to JSONBin so the JSONBIN_API_KEY
 * never appears in client-side code or browser network logs.
 *
 * Client calls: GET /.netlify/functions/articles
 * Function calls: JSONBin API with the secret key server-side.
 */

const https = require('https');

exports.handler = async function (event, context) {
  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const binId  = process.env.JSONBIN_BIN_ID;
  const apiKey = process.env.JSONBIN_API_KEY;

  if (!binId || !apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSONBin not configured on server.' }),
    };
  }

  try {
    const data = await fetchJsonBin(binId, apiKey);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache articles for 5 minutes at the CDN edge
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': 'https://exn-fsociety.netlify.app',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('[articles proxy]', err.message);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch articles from storage.' }),
    };
  }
};

function fetchJsonBin(binId, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.jsonbin.io',
      path: `/v3/b/${binId}/latest`,
      method: 'GET',
      headers: {
        'X-Master-Key': apiKey,
        'X-Bin-Meta': 'false',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`JSONBin returned ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON from JSONBin'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy(new Error('JSONBin request timed out'));
    });
    req.end();
  });
}
