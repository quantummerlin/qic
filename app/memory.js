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
  PERSONA_MEMORIES: "qc_persona_memories",
  INTENTIONS_LIBRARY: "qc_intentions_library",  // [{ id, title, text, createdAt, updatedAt, chatKey }]
  ACTIVE_INTENTION_ID: "qc_active_intention_id", // id of current library entry
  VAULT_HASH: "qc_vault_hash",                   // SHA-256 of vault password
  VAULT_INTENTIONS: "qc_vault_intentions"        // encrypted (XOR+b64) vault entries
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
// INTENTIONS LIBRARY
// Multiple named intentions, each with its own chat thread
// ----------------------------------------------------------

function loadIntentionsLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INTENTIONS_LIBRARY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveIntentionsLibrary(lib) {
  try {
    localStorage.setItem(STORAGE_KEYS.INTENTIONS_LIBRARY, JSON.stringify(lib));
  } catch (e) { console.error("Failed to save library:", e); }
}

function getActiveIntentionId() {
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_INTENTION_ID) || null;
}

function setActiveIntentionId(id) {
  localStorage.setItem(STORAGE_KEYS.ACTIVE_INTENTION_ID, id);
}

/**
 * Create a new library entry and make it active.
 * Returns the new entry.
 */
function createLibraryIntention(title, text) {
  const lib = loadIntentionsLibrary();
  const id = generateId();
  const now = Date.now();
  const entry = { id, title: title || text.substring(0, 60), text, createdAt: now, updatedAt: now, chatKey: "qc_chat_" + id };
  lib.unshift(entry); // newest first
  saveIntentionsLibrary(lib);
  setActiveIntentionId(id);
  // Sync legacy intention storage too
  saveIntention(text);
  return entry;
}

/**
 * Update text/title of an existing library entry.
 */
function updateLibraryIntention(id, changes) {
  const lib = loadIntentionsLibrary();
  const idx = lib.findIndex(e => e.id === id);
  if (idx === -1) return null;
  Object.assign(lib[idx], changes, { updatedAt: Date.now() });
  saveIntentionsLibrary(lib);
  if (changes.text && id === getActiveIntentionId()) saveIntention(lib[idx].text);
  return lib[idx];
}

function deleteLibraryIntention(id) {
  let lib = loadIntentionsLibrary();
  const entry = lib.find(e => e.id === id);
  if (!entry) return;
  lib = lib.filter(e => e.id !== id);
  saveIntentionsLibrary(lib);
  // Clean up its chat history
  localStorage.removeItem(entry.chatKey);
  // If it was the active one, switch to first remaining
  if (getActiveIntentionId() === id) {
    setActiveIntentionId(lib.length ? lib[0].id : null);
    if (lib.length) saveIntention(lib[0].text);
    else clearIntention();
  }
}

/**
 * Switch active intention -> loads that entry's chat history.
 * Returns { entry, chatHistory }
 */
function switchToLibraryIntention(id) {
  const lib = loadIntentionsLibrary();
  const entry = lib.find(e => e.id === id);
  if (!entry) return null;
  setActiveIntentionId(id);
  saveIntention(entry.text);
  const raw = localStorage.getItem(entry.chatKey);
  const chatHistory = raw ? JSON.parse(raw) : [];
  return { entry, chatHistory };
}

/**
 * Save chat history for a specific library entry.
 */
function saveLibraryChatHistory(intentionId, messages) {
  const lib = loadIntentionsLibrary();
  const entry = lib.find(e => e.id === intentionId);
  if (!entry) { saveChatHistory(messages); return; }
  try {
    const trimmed = messages.slice(-MAX_HISTORY);
    localStorage.setItem(entry.chatKey, JSON.stringify(trimmed));
  } catch (e) { console.error("Failed to save library chat:", e); }
}

/**
 * Load chat history for a specific library entry.
 */
function loadLibraryChatHistory(intentionId) {
  const lib = loadIntentionsLibrary();
  const entry = lib.find(e => e.id === intentionId);
  if (!entry) return loadChatHistory();
  try {
    const raw = localStorage.getItem(entry.chatKey);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

// ----------------------------------------------------------
// SECRET VAULT
// Password-protected second set of intentions.
// The vault's existence is never confirmed to someone who can't unlock it.
// Password stored as SHA-256 hash. Content XOR-obfuscated with derived key.
// ----------------------------------------------------------

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function xorObfuscate(text, key) {
  // Simple XOR with repeating key, then base64-encode
  const keyBytes = new TextEncoder().encode(key);
  const textBytes = new TextEncoder().encode(text);
  const out = new Uint8Array(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    out[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return btoa(String.fromCharCode(...out));
}

function xorDeobfuscate(b64, key) {
  const keyBytes = new TextEncoder().encode(key);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return new TextDecoder().decode(out);
}

async function vaultSetPassword(password) {
  const hash = await sha256(password + "qc_vault_salt_v1");
  localStorage.setItem(STORAGE_KEYS.VAULT_HASH, hash);
}

function vaultHasPassword() {
  return !!localStorage.getItem(STORAGE_KEYS.VAULT_HASH);
}

async function vaultVerifyPassword(password) {
  const stored = localStorage.getItem(STORAGE_KEYS.VAULT_HASH);
  if (!stored) return false;
  const attempt = await sha256(password + "qc_vault_salt_v1");
  return attempt === stored;
}

async function vaultLoad(password) {
  const ok = await vaultVerifyPassword(password);
  if (!ok) return null;
  const raw = localStorage.getItem(STORAGE_KEYS.VAULT_INTENTIONS);
  if (!raw) return [];
  try {
    const key = await sha256(password);
    return JSON.parse(xorDeobfuscate(raw, key));
  } catch (e) { return []; }
}

async function vaultSave(password, intentions) {
  const key = await sha256(password);
  const encoded = xorObfuscate(JSON.stringify(intentions), key);
  localStorage.setItem(STORAGE_KEYS.VAULT_INTENTIONS, encoded);
}

async function vaultAddIntention(password, title, text) {
  const intentions = await vaultLoad(password);
  if (!intentions) return false;
  const id = generateId();
  intentions.unshift({ id, title: title || text.substring(0, 60), text, createdAt: Date.now(), chatKey: "qc_vchat_" + id });
  await vaultSave(password, intentions);
  return true;
}

async function vaultDeleteIntention(password, id) {
  const intentions = await vaultLoad(password);
  if (!intentions) return false;
  const updated = intentions.filter(e => e.id !== id);
  await vaultSave(password, updated);
  return true;
}

async function vaultLoadChat(password, intentionId) {
  const intentions = await vaultLoad(password);
  if (!intentions) return null;
  const entry = intentions.find(e => e.id === intentionId);
  if (!entry) return null;
  const rawKey = STORAGE_KEYS.VAULT_INTENTIONS + "_chat_" + intentionId;
  const raw = localStorage.getItem(rawKey);
  if (!raw) return { entry, chatHistory: [] };
  try {
    const key = await sha256(password + intentionId);
    return { entry, chatHistory: JSON.parse(xorDeobfuscate(raw, key)) };
  } catch (e) { return { entry, chatHistory: [] }; }
}

async function vaultSaveChat(password, intentionId, messages) {
  const ok = await vaultVerifyPassword(password);
  if (!ok) return;
  const key = await sha256(password + intentionId);
  const rawKey = STORAGE_KEYS.VAULT_INTENTIONS + "_chat_" + intentionId;
  localStorage.setItem(rawKey, xorObfuscate(JSON.stringify(messages.slice(-MAX_HISTORY)), key));
}

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
  getPersonaMemoryContext,
  // Library
  loadIntentionsLibrary,
  saveIntentionsLibrary,
  getActiveIntentionId,
  setActiveIntentionId,
  createLibraryIntention,
  updateLibraryIntention,
  deleteLibraryIntention,
  switchToLibraryIntention,
  saveLibraryChatHistory,
  loadLibraryChatHistory,
  // Vault
  vaultSetPassword,
  vaultHasPassword,
  vaultVerifyPassword,
  vaultLoad,
  vaultSave,
  vaultAddIntention,
  vaultDeleteIntention,
  vaultLoadChat,
  vaultSaveChat
};