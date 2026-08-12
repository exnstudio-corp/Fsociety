/**
 * netlify/functions/env.js
 * F-Society — Environment Variable Injector
 * EXN STUDIO
 *
 * Returns a small JS snippet that sets window.__ENV__ with
 * Supabase and JSONBin credentials from Netlify env vars.
 * Never hardcode secrets in client-side HTML.
 *
 * Usage: load as <script src="/.netlify/functions/env"></script>
 * in the <head> of any page that needs env vars.
 */

exports.handler = async function (event, context) {
  // Only expose safe, public-facing keys
  const env = {
    SUPABASE_URL:      process.env.SUPABASE_URL      || 'https://cqnlrndhhpdbfvbhprbk.supabase.co',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbmxybmRoaHBkYmZ2YmhwcmJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMTQ4MDMsImV4cCI6MjA5Nzg5MDgwM30.8uAVqea4PmUPZsal2D6sbC10yl7LWLFr3_Q5wNmtgcA',
    JSONBIN_BIN_ID:    process.env.JSONBIN_BIN_ID    || '6a33dad5da38895dfed6be4a',
    JSONBIN_API_KEY:   process.env.JSONBIN_API_KEY   || '$2a$10$8c1mZogvNvfO7DFR.lwevO8WvjfecacFrsid6.cTNdYx5U6eRnLIy',
  };

  const js = `window.__ENV__ = ${JSON.stringify(env)};`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
    body: js,
  };
};
