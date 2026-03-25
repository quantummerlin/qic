// ============================================================
// API LAYER
// Two modes:
//   1. Cloudflare Worker proxy — Worker holds the OpenRouter key.
//      Configure: Worker URL + personal access token in Settings.
//   2. Direct OpenRouter — user pastes their own key.
//      Configure: OpenRouter API key in Settings or welcome flow.
//
// Priority: Worker proxy (if configured) > Direct key
// ============================================================

// localStorage keys
const QC_PROXY_URL_KEY   = "qc_proxy_url";
const QC_PROXY_TOKEN_KEY = "qc_proxy_token";
const QC_OR_KEY          = "qc_openrouter_key";

function getProxyConfig() {
  return {
    url:   localStorage.getItem(QC_PROXY_URL_KEY)   || "",
    token: localStorage.getItem(QC_PROXY_TOKEN_KEY) || ""
  };
}

/**
 * Call a single persona — tries Worker proxy first, then direct OpenRouter key.
 */
async function callPersona(persona, messages, options = {}) {
  const { url, token } = getProxyConfig();

  // --- Mode 1: Worker proxy ---
  if (url && token) {
    const payload = {
      personaId:    persona.id,
      systemPrompt: persona.systemPrompt,
      messages,
      model:        persona.model,
      temperature:  options.temperature ?? 0.85,
      max_tokens:   options.max_tokens  ?? 600
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type":  "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error || response.statusText || "Unknown error";
        console.error(`[${persona.shortName}] Worker error ${response.status}:`, errMsg);
        return `[${persona.shortName} encountered an error: ${response.status} — ${errMsg}]`;
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content.trim();
      }
      console.error(`[${persona.shortName}] No choices in response:`, data);
      return `[${persona.shortName} returned an empty response.]`;
    } catch (err) {
      console.error(`[${persona.shortName}] Network error:`, err);
      return `[${persona.shortName} network error: ${err.message}]`;
    }
  }

  // --- Mode 2: Direct OpenRouter key ---
  const directKey = localStorage.getItem(QC_OR_KEY) || persona.apiKey || "";
  if (directKey) {
    return await callPersonaDirect(persona, messages, options, directKey);
  }

  return `[${persona.shortName}: No API connection configured. Open ⚙ Settings to add your OpenRouter key or Worker URL.]`;
}

/**
 * Call OpenRouter directly using a user-supplied API key (no Worker needed).
 */
async function callPersonaDirect(persona, messages, options, apiKey) {
  const payload = {
    model: persona.model,
    messages: [
      { role: "system", content: persona.systemPrompt },
      ...messages
    ],
    temperature: options.temperature ?? 0.85,
    max_tokens:  options.max_tokens  ?? 600
  };

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
        "HTTP-Referer":  window.location.origin,
        "X-Title":       "Quantum Council"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || errData?.error || response.statusText || "Unknown error";
      console.error(`[${persona.shortName}] OpenRouter error ${response.status}:`, errMsg);
      return `[${persona.shortName} encountered an error: ${response.status} — ${errMsg}]`;
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content.trim();
    }
    console.error(`[${persona.shortName}] No choices in response:`, data);
    return `[${persona.shortName} returned an empty response.]`;
  } catch (err) {
    console.error(`[${persona.shortName}] Network error:`, err);
    return `[${persona.shortName} network error: ${err.message}]`;
  }
}

/**
 * Call all non-Architect personas in parallel.
 *
 * @param {Array} personas - All persona configs
 * @param {Array} messages - Chat context messages
 * @returns {Array} Array of {persona, response} objects
 */
async function callAllCouncil(personas, messages) {
  const nonArchitect = personas.filter(p => !p.isArchitect);

  const results = await Promise.allSettled(
    nonArchitect.map(async (persona) => {
      const response = await callPersona(persona, messages);
      return { persona, response };
    })
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      return {
        persona: nonArchitect[i],
        response: `[${nonArchitect[i].shortName} failed: ${result.reason}]`
      };
    }
  });
}

/**
 * Call the Architect for final synthesis.
 * Receives the user message + all council responses.
 *
 * @param {Object} architect - Architect persona config
 * @param {Array} baseMessages - Original chat context
 * @param {Array} councilResponses - Array of {persona, response}
 * @param {string} currentIntention - The current intention statement
 * @returns {string} Architect's synthesis
 */
async function callArchitectSynthesis(architect, baseMessages, councilResponses, currentIntention) {
  // Build a synthesis prompt with all council input
  let councilSummary = "=== COUNCIL RESPONSES ===\n\n";
  for (const cr of councilResponses) {
    councilSummary += `${cr.persona.icon} ${cr.persona.name}:\n${cr.response}\n\n`;
  }

  const synthesisInstruction = {
    role: "user",
    content: `The council has spoken. Here are all their responses to the user's latest message.

${councilSummary}

${currentIntention ? `CURRENT LOCKED INTENTION: ${currentIntention}\n\n` : ""}

Now, as The Reality Architect, synthesize everything above. Weave the council's insights into a unified perspective. Reference specific contributions that stand out. End with a clear, locked-in reality statement that captures the current state of the intention. Speak as if this is all already real and simply being clarified further.`
  };

  const messages = [
    ...baseMessages,
    synthesisInstruction
  ];

  return await callPersona(architect, messages, { max_tokens: 800 });
}

// Export
window.callPersona = callPersona;
window.callAllCouncil = callAllCouncil;
window.callArchitectSynthesis = callArchitectSynthesis;