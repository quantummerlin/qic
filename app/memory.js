// ============================================================
// MEMORY LAYER — localStorage persistence
// Chat history, intention state, persona settings
// ============================================================

const STORAGE_KEYS = {
  CHAT_HISTORY: "qc_chat_history",
  INTENTION: "qc_intention",
  PERSONA_SETTINGS: "qc_persona_settings",
  SESSION_ID: "qc_session_id",
  LAST_USER_ACTIVITY: "qc_last_user_activity",
  LAST_COUNCIL_CONVO: "qc_last_council_convo",
  PERSONA_MEMORIES: "qc_persona_memories"
};

const MAX_HISTORY = 200; // max messages stored

// ----------------------------------------------------------
// CHAT HISTORY
// ----------------------------------------------------------

function loadChatHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to load chat history:", e);
    return [];
  }
}

function saveChatHistory(messages) {
  try {
    // Keep only last MAX_HISTORY messages
    const trimmed = messages.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(trimmed));
  } catch (e) {
    console.error("Failed to save chat history:", e);
  }
}

function addMessage(messages, msg) {
  const message = {
    id: generateId(),
    timestamp: Date.now(),
    ...msg
  };
  messages.push(message);
  saveChatHistory(messages);
  return message;
}

function clearChatHistory() {
  localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
}

// ----------------------------------------------------------
// INTENTION STATE
// ----------------------------------------------------------

function loadIntention() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INTENTION);
    return raw ? JSON.parse(raw) : {
      text: "",
      lastUpdated: null,
      history: []
    };
  } catch (e) {
    console.error("Failed to load intention:", e);
    return { text: "", lastUpdated: null, history: [] };
  }
}

function saveIntention(intentionText) {
  const current = loadIntention();
  // Keep history of past intentions
  if (current.text && current.text !== intentionText) {
    current.history.push({
      text: current.text,
      timestamp: current.lastUpdated
    });
    // Keep last 20 intention versions
    if (current.history.length > 20) {
      current.history = current.history.slice(-20);
    }
  }
  const updated = {
    text: intentionText,
    lastUpdated: Date.now(),
    history: current.history
  };
  localStorage.setItem(STORAGE_KEYS.INTENTION, JSON.stringify(updated));
  return updated;
}

function clearIntention() {
  localStorage.removeItem(STORAGE_KEYS.INTENTION);
}

// ----------------------------------------------------------
// PERSONA SETTINGS (API keys, model overrides)
// ----------------------------------------------------------

function loadPersonaSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PERSONA_SETTINGS);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to load persona settings:", e);
    return {};
  }
}

function savePersonaSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.PERSONA_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save persona settings:", e);
  }
}

/**
 * Apply saved settings (API keys, models) to persona objects.
 * Mutates the PERSONAS array in place.
 */
function applyPersonaSettings(personas) {
  const settings = loadPersonaSettings();
  for (const p of personas) {
    if (settings[p.id]) {
      if (settings[p.id].apiKey !== undefined) {
        p.apiKey = settings[p.id].apiKey;
      }
      if (settings[p.id].model !== undefined && settings[p.id].model.trim() !== "") {
        p.model = settings[p.id].model;
      }
    }
  }
}

/**
 * Extract current settings from persona objects for saving.
 */
function extractPersonaSettings(personas) {
  const settings = {};
  for (const p of personas) {
    settings[p.id] = {
      apiKey: p.apiKey || "",
      model: p.model || ""
    };
  }
  return settings;
}

// ----------------------------------------------------------
// CONTEXT BUILDER — builds message array for API calls
// ----------------------------------------------------------

/**
 * Build context messages for a persona call.
 * Includes intention context + recent chat history.
 *
 * @param {Array} chatHistory - Full chat history
 * @param {string} userMessage - Current user message
 * @param {number} contextWindow - Number of recent messages to include
 * @returns {Array} Messages array for API call
 */
function buildContext(chatHistory, userMessage, contextWindow = 16, personaId = null) {
  const messages = [];
  const intention = loadIntention();

  // Add intention context if set
  if (intention.text) {
    messages.push({
      role: "user",
      content: `[CONTEXT — The following intention is already real and currently being experienced by the user. This is settled fact, not a goal:]\n\n"${intention.text}"\n\n[All responses should operate within this reality.]`
    });
    messages.push({
      role: "assistant",
      content: "Understood. This intention is already real. I will engage with it as lived reality."
    });
  }

  // Add persona memory if personaId provided
  if (personaId) {
    const memoryContext = getPersonaMemoryContext(personaId);
    if (memoryContext) {
      messages.push({
        role: "user",
        content: `[YOUR MEMORY — Patterns and observations you've noticed about this user over time:]\n${memoryContext}\n\n[Use these insights to provide continuity and deeper engagement.]`
      });
      messages.push({
        role: "assistant",
        content: "I remember these patterns. I'll incorporate them into my response."
      });
    }
  }

  // Add recent chat history (only user and persona messages, summarized)
  const recent = chatHistory.slice(-contextWindow);
  for (const msg of recent) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content });
    } else if (msg.role === "persona") {
      // Include persona messages as assistant context
      messages.push({
        role: "assistant",
        content: `[${msg.personaName}]: ${msg.content}`
      });
    }
  }

  // Add current user message
  if (userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  return messages;
}

// ----------------------------------------------------------
// UTILITIES
// ----------------------------------------------------------

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getSessionId() {
  let id = localStorage.getItem(STORAGE_KEYS.SESSION_ID);
  if (!id) {
    id = generateId();
    localStorage.setItem(STORAGE_KEYS.SESSION_ID, id);
  }
  return id;
}

// ----------------------------------------------------------
// ACTIVITY TRACKING
// ----------------------------------------------------------

function touchUserActivity() {
  localStorage.setItem(STORAGE_KEYS.LAST_USER_ACTIVITY, Date.now().toString());
}

function getLastUserActivity() {
  const raw = localStorage.getItem(STORAGE_KEYS.LAST_USER_ACTIVITY);
  return raw ? parseInt(raw, 10) : null;
}

function getHoursSinceActivity() {
  const last = getLastUserActivity();
  if (!last) return null;
  return (Date.now() - last) / (1000 * 60 * 60);
}

function touchCouncilConvo() {
  localStorage.setItem(STORAGE_KEYS.LAST_COUNCIL_CONVO, Date.now().toString());
}

function getLastCouncilConvo() {
  const raw = localStorage.getItem(STORAGE_KEYS.LAST_COUNCIL_CONVO);
  return raw ? parseInt(raw, 10) : null;
}

function getHoursSinceCouncilConvo() {
  const last = getLastCouncilConvo();
  if (!last) return null;
  return (Date.now() - last) / (1000 * 60 * 60);
}

// ----------------------------------------------------------
// PERSONA MEMORIES (cross-session observations)
// Each persona can store key observations about the user
// ----------------------------------------------------------

function loadPersonaMemories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PERSONA_MEMORIES);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to load persona memories:", e);
    return {};
  }
}

function savePersonaMemories(memories) {
  try {
    localStorage.setItem(STORAGE_KEYS.PERSONA_MEMORIES, JSON.stringify(memories));
  } catch (e) {
    console.error("Failed to save persona memories:", e);
  }
}

function getPersonaMemory(personaId) {
  const memories = loadPersonaMemories();
  return memories[personaId] || { observations: [], lastUpdated: null };
}

function addPersonaObservation(personaId, observation) {
  const memories = loadPersonaMemories();
  if (!memories[personaId]) {
    memories[personaId] = { observations: [], lastUpdated: null };
  }
  
  // Add observation with timestamp
  memories[personaId].observations.push({
    text: observation,
    timestamp: Date.now()
  });
  
  // Keep only last 10 observations per persona
  memories[personaId].observations = memories[personaId].observations.slice(-10);
  memories[personaId].lastUpdated = Date.now();
  
  savePersonaMemories(memories);
}

function getPersonaMemoryContext(personaId) {
  const memory = getPersonaMemory(personaId);
  if (!memory.observations.length) return "";
  
  // Return last 5 observations as context
  const recent = memory.observations.slice(-5);
  return recent.map(o => o.text).join(" ");
}

// ----------------------------------------------------------
// EXPORT
// ----------------------------------------------------------

window.Memory = {
  loadChatHistory,
  saveChatHistory,
  addMessage,
  clearChatHistory,
  loadIntention,
  saveIntention,
  clearIntention,
  loadPersonaSettings,
  savePersonaSettings,
  applyPersonaSettings,
  extractPersonaSettings,
  buildContext,
  generateId,
  getSessionId,
  touchUserActivity,
  getLastUserActivity,
  getHoursSinceActivity,
  touchCouncilConvo,
  getLastCouncilConvo,
  getHoursSinceCouncilConvo,
  loadPersonaMemories,
  savePersonaMemories,
  getPersonaMemory,
  addPersonaObservation,
  getPersonaMemoryContext
};