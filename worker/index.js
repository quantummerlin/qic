// ================================================================
// Quantum Council — Cloudflare Worker API Proxy
// Holds all 11 OpenRouter API keys as Worker secrets.
// The browser never sees a key. Only a personal access token
// is stored in the browser to authenticate to this Worker.
//
// SETUP (run these once after `wrangler login`):
//   wrangler secret put QUANTUM_AUTH_TOKEN
//   wrangler secret put KEY_ARCHITECT
//   wrangler secret put KEY_VISIONARY
//   wrangler secret put KEY_STRATEGIST
//   wrangler secret put KEY_EMOTIONAL
//   wrangler secret put KEY_ENERGY
//   wrangler secret put KEY_QUESTIONER
//   wrangler secret put KEY_HISTORIAN
//   wrangler secret put KEY_LANGUAGE
//   wrangler secret put KEY_CONNECTOR
//   wrangler secret put KEY_COMMANDER
//   wrangler secret put KEY_AMPLIFIER
//   wrangler secret put KEY_OBSERVER
//
// After deploying Cloudflare Pages, lock CORS by setting:
//   wrangler secret put ALLOWED_ORIGIN
//   → paste your Pages URL, e.g. https://quantum-council.pages.dev
// ================================================================

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env, origin)
      });
    }

    if (request.method !== "POST") {
      return respond({ error: "Method not allowed" }, 405, env, origin);
    }

    // ---- Auth ----
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!env.QUANTUM_AUTH_TOKEN || token !== env.QUANTUM_AUTH_TOKEN) {
      return respond({ error: "Unauthorized" }, 401, env, origin);
    }

    // ---- Parse body ----
    let body;
    try {
      body = await request.json();
    } catch {
      return respond({ error: "Invalid JSON body" }, 400, env, origin);
    }

    const { personaId, systemPrompt, messages, model, temperature, max_tokens } = body;

    if (!personaId || !Array.isArray(messages) || !model) {
      return respond(
        { error: "Missing required fields: personaId, messages, model" },
        400, env, origin
      );
    }

    // ---- Resolve API key for this persona ----
    // Secrets named: KEY_ARCHITECT, KEY_VISIONARY, KEY_STRATEGIST, etc.
    const keyName = "KEY_" + personaId.toUpperCase().replace(/-/g, "_");
    const apiKey = env[keyName];

    if (!apiKey) {
      return respond(
        { error: `No API key configured for persona '${personaId}'. Set secret: ${keyName}` },
        400, env, origin
      );
    }

    // Validate model is provided and non-empty
    if (!model || model.trim() === "") {
      return respond({ error: `No model specified for persona '${personaId}'` }, 400, env, origin);
    }

    // ---- Build message array ----
    const fullMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    // ---- Call OpenRouter ----
    let orRes;
    try {
      orRes = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Quantum Council"
        },
        body: JSON.stringify({
          model,
          messages: fullMessages,
          temperature: temperature ?? 0.85,
          max_tokens: max_tokens ?? 600,
          top_p: 0.95
        })
      });
    } catch (err) {
      return respond({ error: `Upstream error: ${err.message}` }, 502, env, origin);
    }

    const data = await orRes.json();

    // If OpenRouter returned an error object, surface it as a readable string
    if (!orRes.ok && data.error) {
      const msg = typeof data.error === "object"
        ? (data.error.message || JSON.stringify(data.error))
        : String(data.error);
      return respond({ error: msg }, orRes.status, env, origin);
    }

    return respond(data, orRes.status, env, origin);
  }
};

function respond(data, status, env, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env, origin)
    }
  });
}

function corsHeaders(env, origin) {
  // Lock to your Pages URL once deployed. Until then "*" allows local testing.
  const allowed = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
