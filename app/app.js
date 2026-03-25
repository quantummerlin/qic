// ============================================================
// APP.JS — Main application wiring
// ============================================================

(function () {
  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------
  let chatHistory = [];
  let mode = "council"; // "council" or persona id for 1-on-1
  let activeIntentionId = null; // current library thread id
  let vaultSession = null; // { password, intentions } when unlocked
  let vaultChatHistory = []; // chat history for vault thread
  let activeVaultIntentionId = null; // current vault thread

  // Message selection mode state
  let messageSelectionMode = false;
  let selectedMessageIds = [];
  let longPressTimer = null;
  const LONG_PRESS_DURATION = 500; // ms

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------
  function init() {
    // Load saved persona settings (API keys, models)
    Memory.applyPersonaSettings(PERSONAS);

    // Load library state
    activeIntentionId = Memory.getActiveIntentionId();
    const library = Memory.loadIntentionsLibrary();

    // If we have a library entry, load its chat; else fall back to legacy chat
    if (activeIntentionId && library.find(e => e.id === activeIntentionId)) {
      chatHistory = Memory.loadLibraryChatHistory(activeIntentionId);
    } else if (library.length > 0) {
      activeIntentionId = library[0].id;
      Memory.setActiveIntentionId(activeIntentionId);
      chatHistory = Memory.loadLibraryChatHistory(activeIntentionId);
    } else {
      // Migrate legacy chat + intention into library
      const legacyIntention = Memory.loadIntention();
      const legacyChat = Memory.loadChatHistory();
      if (legacyIntention.text) {
        const entry = Memory.createLibraryIntention(
          legacyIntention.text.substring(0, 60),
          legacyIntention.text
        );
        activeIntentionId = entry.id;
        if (legacyChat.length > 0) {
          Memory.saveLibraryChatHistory(activeIntentionId, legacyChat);
        }
        chatHistory = legacyChat;
      } else {
        chatHistory = [];
      }
    }

    // Render existing chat
    renderChatHistory();

    // Update intention display
    updateIntentionDisplay();

    // Bind events
    bindEvents();

    // Scroll to bottom
    scrollToBottom();

    // Start ambient messages (every 10 minutes)
    Orchestrator.startAmbient(10 * 60 * 1000, handleAmbientMessage);

    // Start inactivity watcher — council converses after 12hrs of user absence
    Orchestrator.startInactivityWatcher(handleCouncilConversationNeeded);

    // Touch activity on load
    Memory.touchUserActivity();

    // If no library entries at all, show welcome/setup flow
    const freshLibrary = Memory.loadIntentionsLibrary();
    if (freshLibrary.length === 0) {
      showWelcomeFlow();
    } else if (chatHistory.length === 0) {
      showWelcome();
    } else {
      // Check if council met while user was away
      checkForCouncilMeeting();
    }
  }

  // ----------------------------------------------------------
  // CHECK FOR COUNCIL MEETING (return greeting)
  // ----------------------------------------------------------
  function checkForCouncilMeeting() {
    const hoursSinceUser = Memory.getHoursSinceActivity();
    const hoursSinceConvo = Memory.getHoursSinceCouncilConvo();
    
    // If council met while user was away (council convo happened after user left)
    // and user has been gone for more than 1 hour
    if (hoursSinceUser !== null && hoursSinceUser >= 1) {
      // Check if there's a council-convo message in recent history
      const recentConvo = chatHistory.slice(-20).find(m => 
        m.messageType === "council-convo" || m.messageType === "council-convo-close"
      );
      
      if (recentConvo && hoursSinceConvo !== null && hoursSinceConvo < hoursSinceUser) {
        // Council met while user was away - show return message
        showCouncilReturnMessage();
      }
    }
  }

  function showCouncilReturnMessage() {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "council-return-message";
    div.innerHTML = `
      <div class="return-icon">🔮</div>
      <div class="return-text">
        <strong>Welcome back.</strong> While you were away, the council met to hold your intention.
        <br><br>
        <span style="color:#6a8a6a;">Scroll up to see what was discussed, or continue the conversation below.</span>
      </div>
    `;
    container.appendChild(div);
    scrollToBottom();
    
    // Touch activity so this doesn't show again
    Memory.touchUserActivity();
  }

  // ----------------------------------------------------------
  // EVENT BINDING
  // ----------------------------------------------------------
  function bindEvents() {
    // Send button
    document.getElementById("send-btn").addEventListener("click", handleSend);

    // Council button
    document.getElementById("council-btn").addEventListener("click", handleCouncilRun);

    // Text input — Enter to send, Shift+Enter for newline
    document.getElementById("user-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Settings (opened from bottom nav — wire up close/save buttons)
    document.getElementById("settings-close").addEventListener("click", closeSettings);
    document.getElementById("settings-save").addEventListener("click", saveSettings);

    // Intention edit
    document.getElementById("intention-edit-btn").addEventListener("click", openIntentionEdit);

    // Message selection mode
    const editBtn = document.getElementById("edit-messages-btn");
    const doneBtn = document.getElementById("done-messages-btn");
    if (editBtn) editBtn.addEventListener("click", enterMessageSelectionMode);
    if (doneBtn) doneBtn.addEventListener("click", exitMessageSelectionMode);
    document.getElementById("selection-cancel").addEventListener("click", exitMessageSelectionMode);
    document.getElementById("selection-share").addEventListener("click", openShareFormatSheet);
    document.getElementById("selection-delete").addEventListener("click", deleteSelectedMessages);
    document.getElementById("share-plain-btn").addEventListener("click", () => shareMessages('plain'));
    document.getElementById("share-formatted-btn").addEventListener("click", () => shareMessages('formatted'));

    // Mode selector
    document.getElementById("mode-select").addEventListener("change", (e) => {
      mode = e.target.value;
      updateModeDisplay();
    });

    // Manual council conversation trigger
    document.getElementById("council-convo-btn").addEventListener("click", handleManualCouncilConvo);

    // Council mode toggle (Clarify / Embody)
    document.getElementById("council-mode-toggle").addEventListener("click", toggleCouncilMode);

    // Fill all API keys
    document.getElementById("fill-all-btn").addEventListener("click", fillAllKeys);

    // Intention journal (opened from bottom nav — wire up close button)
    document.getElementById("journal-close").addEventListener("click", closeIntentionJournal);

    // Start session (Architect opens)
    document.getElementById("start-session-btn").addEventListener("click", handleStartSession);

    // Top three-dot kebab menu
    const topDotsBtn = document.getElementById("top-dots-btn");
    const topDotsMenu = document.getElementById("top-dots-menu");
    if (topDotsBtn && topDotsMenu) {
      topDotsBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        const isOpen = topDotsMenu.classList.contains("open");
        closeAllContextMenus();
        if (!isOpen) {
          topDotsMenu.classList.add("open");
          topDotsBtn.classList.add("open");
        }
      });
    }
    const kmenuMode = document.getElementById("kmenu-mode");
    const kmenuEdit = document.getElementById("kmenu-edit");
    if (kmenuMode) kmenuMode.addEventListener("click", function() { closeAllContextMenus(); toggleCouncilMode(); });
    if (kmenuEdit) kmenuEdit.addEventListener("click", function() { closeAllContextMenus(); enterMessageSelectionMode(); });

    // Close all menus on outside click
    document.addEventListener("click", closeAllContextMenus);

    // Save last-read on page hide
    document.addEventListener("visibilitychange", function() {
      if (document.hidden && activeIntentionId && chatHistory.length > 0) {
        const lastMsg = chatHistory[chatHistory.length - 1];
        if (lastMsg && lastMsg.id) {
          Memory.setLastReadMessageId(activeIntentionId, lastMsg.id);
        }
      }
    });
  }

  // ----------------------------------------------------------
  // SEND MESSAGE (single persona or trigger council)
  // ----------------------------------------------------------
  function handleSend() {
    const input = document.getElementById("user-input");
    const text = input.value.trim();
    if (!text || Orchestrator.getIsRunning()) return;

    removeWelcome();
    input.value = "";
    input.style.height = "50px";
    Memory.touchUserActivity();

    const userMsg = Memory.addMessage(chatHistory, {
      role: "user",
      content: text
    });
    appendMessageToUI(userMsg);
    scrollToBottom();

    if (mode === "council") {
      // Regular sends: Architect picks 2-3 most relevant personas
      runCouncilCurated(text);
    } else {
      runSinglePersona(mode, text);
    }
  }

  function handleCouncilRun() {
    const input = document.getElementById("user-input");
    const text = input.value.trim();
    if (!text || Orchestrator.getIsRunning()) return;

    removeWelcome();
    input.value = "";
    input.style.height = "50px";
    Memory.touchUserActivity();

    const userMsg = Memory.addMessage(chatHistory, {
      role: "user",
      content: text
    });
    appendMessageToUI(userMsg);
    scrollToBottom();

    runCouncilRound(text);
  }

  // ----------------------------------------------------------
  // COUNCIL ROUND (⚡ button — all personas)
  // ----------------------------------------------------------
  function runCouncilRound(userMessage) {
    setButtonsDisabled(true);
    if (window.QuantumEffects) {
      window.QuantumEffects.setCouncilState('convening');
    }

    Orchestrator.runCouncil(userMessage, chatHistory, {
      onPersonaMessage: (persona, response, type) => {
        if (window.QuantumEffects) {
          const state = type === 'synthesis' ? 'synthesizing' : 'speaking';
          window.QuantumEffects.setCouncilState(state);
        }
        const msg = Memory.addMessage(chatHistory, {
          role: "persona",
          personaId: persona.id,
          personaName: persona.shortName,
          personaIcon: persona.icon,
          model: persona.model,
          content: response,
          messageType: type
        });
        appendMessageToUI(msg);
        scrollToBottom();
      },
      onTypingStart: (name) => showTyping(name),
      onTypingStop: () => hideTyping(),
      onStatusUpdate: (text) => updateStatus(text),
      onPhaseUpdate: (phaseName) => showPhase(phaseName),
      onComplete: () => {
        setButtonsDisabled(false);
        updateStatus("");
        hidePhase();
        saveCurrentChat();
        if (window.QuantumEffects) {
          window.QuantumEffects.setCouncilState('resting');
        }
        document.getElementById("user-input").focus();
      }
    });
  }

  // ----------------------------------------------------------
  // COUNCIL CURATED (regular send — Architect picks 2-3 personas)
  // ----------------------------------------------------------
  function runCouncilCurated(userMessage) {
    setButtonsDisabled(true);
    if (window.QuantumEffects) {
      window.QuantumEffects.setCouncilState('convening');
    }

    Orchestrator.runCouncilCurated(userMessage, chatHistory, {
      onPersonaMessage: (persona, response, type) => {
        if (window.QuantumEffects) {
          const state = type === 'synthesis' ? 'synthesizing' : 'speaking';
          window.QuantumEffects.setCouncilState(state);
        }
        const msg = Memory.addMessage(chatHistory, {
          role: "persona",
          personaId: persona.id,
          personaName: persona.shortName,
          personaIcon: persona.icon,
          model: persona.model,
          content: response,
          messageType: type
        });
        appendMessageToUI(msg);
        scrollToBottom();
      },
      onTypingStart: (name) => showTyping(name),
      onTypingStop: () => hideTyping(),
      onStatusUpdate: (text) => updateStatus(text),
      onPhaseUpdate: (phaseName) => showPhase(phaseName),
      onComplete: () => {
        setButtonsDisabled(false);
        updateStatus("");
        hidePhase();
        saveCurrentChat();
        if (window.QuantumEffects) {
          window.QuantumEffects.setCouncilState('resting');
        }
        document.getElementById("user-input").focus();
      }
    });
  }

  // ----------------------------------------------------------
  // SINGLE PERSONA
  // ----------------------------------------------------------
  function runSinglePersona(personaId, userMessage) {
    setButtonsDisabled(true);

    Orchestrator.askSinglePersona(personaId, userMessage, chatHistory, {
      onPersonaMessage: (persona, response, type) => {
        const msg = Memory.addMessage(chatHistory, {
          role: "persona",
          personaId: persona.id,
          personaName: persona.shortName,
          personaIcon: persona.icon,
          model: persona.model,
          content: response,
          messageType: type
        });
        appendMessageToUI(msg);
        scrollToBottom();
      },
      onTypingStart: (name) => showTyping(name),
      onTypingStop: () => hideTyping(),
      onStatusUpdate: (text) => updateStatus(text),
      onComplete: () => {
        setButtonsDisabled(false);
        updateStatus("");
        saveCurrentChat();
        document.getElementById("user-input").focus();
      }
    });
  }

  // ----------------------------------------------------------
  // SAVE CURRENT CHAT HELPER
  // ----------------------------------------------------------
  function saveCurrentChat() {
    if (activeVaultIntentionId && vaultSession) {
      Memory.vaultSaveChat(vaultSession.password, activeVaultIntentionId, chatHistory);
    } else if (activeIntentionId) {
      Memory.saveLibraryChatHistory(activeIntentionId, chatHistory);
    }
  }

  // ----------------------------------------------------------
  // START SESSION (Architect opens)
  // ----------------------------------------------------------
  function handleStartSession() {
    if (Orchestrator.getIsRunning()) return;
    const intention = Memory.loadIntention();
    if (!intention.text) {
      // Show helpful guidance in chat instead of just status
      const container = document.getElementById("chat-messages");
      const guidance = document.createElement("div");
      guidance.className = "guidance-message";
      guidance.innerHTML = `
        <div style="padding:16px;background:#1a1a2e;border:1px solid #334;border-radius:8px;margin:8px 0;">
          <div style="font-size:14px;color:#889;margin-bottom:8px;">🔮 To start a session, first set your intention:</div>
          <ol style="margin:0;padding-left:20px;color:#aab;font-size:13px;line-height:1.8;">
            <li>Click <strong>Edit</strong> next to the intention bar above</li>
            <li>Write what you're manifesting as if it's <em>already real</em></li>
            <li>Click <strong>🧠 Start</strong> to have the Architect open the session</li>
          </ol>
        </div>
      `;
      container.appendChild(guidance);
      scrollToBottom();
      return;
    }

    removeWelcome();
    setButtonsDisabled(true);

    Orchestrator.startSession(chatHistory, {
      onPersonaMessage: (persona, response, type) => {
        const msg = Memory.addMessage(chatHistory, {
          role: "persona",
          personaId: persona.id,
          personaName: persona.shortName,
          personaIcon: persona.icon,
          model: persona.model,
          content: response,
          messageType: type || "session-open"
        });
        appendMessageToUI(msg);
        scrollToBottom();
      },
      onTypingStart: (name) => showTyping(name),
      onTypingStop: () => hideTyping(),
      onStatusUpdate: (text) => updateStatus(text),
      onComplete: () => {
        setButtonsDisabled(false);
        updateStatus("");
        saveCurrentChat();
        document.getElementById("user-input").focus();
      }
    });
  }

  // ----------------------------------------------------------
  // COUNCIL CONVERSATION (autonomous — personas talk to each other)
  // ----------------------------------------------------------

  function handleCouncilConversationNeeded() {
    // Don't interrupt if council is already running
    if (Orchestrator.getIsRunning()) return;
    triggerCouncilConversation();
  }

  function handleManualCouncilConvo() {
    if (Orchestrator.getIsRunning()) return;
    triggerCouncilConversation();
  }

  function triggerCouncilConversation() {
    const intention = Memory.loadIntention();
    if (!intention.text) {
      updateStatus("Set an intention first before the council can meet.");
      setTimeout(() => updateStatus(""), 3000);
      return;
    }

    removeWelcome();
    setButtonsDisabled(true);

    if (window.QuantumEffects) {
      window.QuantumEffects.setCouncilState('convening');
    }

    // Add a visual council meeting header
    appendCouncilMeetingHeader();

    Orchestrator.runCouncilConversation(chatHistory, {
      onConversationStart: () => {},
      onPersonaMessage: (persona, response, type) => {
        if (window.QuantumEffects) {
          window.QuantumEffects.setCouncilState('speaking');
        }
        const msg = Memory.addMessage(chatHistory, {
          role: "persona",
          personaId: persona.id,
          personaName: persona.shortName,
          personaIcon: persona.icon,
          model: persona.model,
          content: response,
          messageType: type
        });
        appendMessageToUI(msg);
        scrollToBottom();
      },
      onTypingStart: (name) => showTyping(name),
      onTypingStop: () => hideTyping(),
      onStatusUpdate: (text) => updateStatus(text),
      onComplete: () => {
        setButtonsDisabled(false);
        updateStatus("");
        hidePhase();        saveCurrentChat();
        if (window.QuantumEffects) {
          window.QuantumEffects.setCouncilState('resting');
        }
      }
    });
  }

  function appendCouncilMeetingHeader() {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "council-meeting-header";
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateStr = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    div.innerHTML = `<span>🔮 Council Meeting — ${dateStr} at ${timeStr} — holding your intention in your absence</span>`;
    container.appendChild(div);
    scrollToBottom();
  }

  // ----------------------------------------------------------
  // AMBIENT MESSAGES
  // ----------------------------------------------------------
  function handleAmbientMessage(persona, text) {
    const msg = Memory.addMessage(chatHistory, {
      role: "persona",
      personaId: persona.id,
      personaName: persona.shortName,
      personaIcon: persona.icon,
      model: persona.model,
      content: text,
      messageType: "ambient"
    });
    appendMessageToUI(msg);
    scrollToBottom();
  }

  // ----------------------------------------------------------
  // COUNCIL MODE TOGGLE (Clarify / Embody)
  // ----------------------------------------------------------
  function toggleCouncilMode() {
    const currentMode = Orchestrator.getCouncilMode();
    const modes = Orchestrator.COUNCIL_MODES;
    const newMode = currentMode === modes.EMBODY ? modes.CLARIFY : modes.EMBODY;
    Orchestrator.setCouncilMode(newMode);

    const btn = document.getElementById("council-mode-toggle");
    const kmenuMode = document.getElementById("kmenu-mode");
    if (newMode === modes.CLARIFY) {
      btn.textContent = "🔍 Clarify Mode";
      btn.style.borderColor = "#443";
      btn.style.color = "#aa8";
      if (kmenuMode) kmenuMode.textContent = "🔍 Clarify Mode";
    } else {
      btn.textContent = "✨ Embody Mode";
      btn.style.borderColor = "#333";
      btn.style.color = "#888";
      if (kmenuMode) kmenuMode.textContent = "✨ Embody Mode";
    }
  }

  // ----------------------------------------------------------
  // LIBRARY SHEET
  // ----------------------------------------------------------
  function openLibrarySheet() {
    const sheet = document.getElementById("library-sheet");
    renderLibrarySheet();
    sheet.classList.add("active");
  }

  function closeLibrarySheet() {
    document.getElementById("library-sheet").classList.remove("active");
    // Also hide vault input if open
    const vaultUnlock = document.getElementById("vault-unlock-row");
    if (vaultUnlock) vaultUnlock.style.display = "none";
  }

  function renderLibrarySheet() {
    const list = document.getElementById("library-entry-list");
    if (!list) return;
    list.innerHTML = "";

    const library = Memory.loadIntentionsLibrary();

    if (library.length === 0) {
      list.innerHTML = "<p style='color:#555;font-size:13px;padding:12px 0;'>No intentions yet. Create your first one below.</p>";
    } else {
      library.forEach(entry => {
        const div = document.createElement("div");
        div.className = "library-entry" + (entry.id === activeIntentionId ? " active" : "");
        const date = new Date(entry.updatedAt || entry.createdAt).toLocaleDateString([], { month: "short", day: "numeric" });
        div.innerHTML = `
          <div class="library-entry-title">${escapeHtml(entry.title)}</div>
          <div class="library-entry-meta">${escapeHtml(entry.text.substring(0, 80))}${entry.text.length > 80 ? "..." : ""}</div>
          <div class="library-entry-date">${date}</div>
        `;
        div.addEventListener("click", () => switchToIntention(entry.id));
        list.appendChild(div);
      });
    }

    // "+ New Intention" button
    const newBtn = document.createElement("button");
    newBtn.className = "library-new-btn";
    newBtn.textContent = "+ New Intention";
    newBtn.addEventListener("click", createNewIntention);
    list.appendChild(newBtn);

    // Vault access (neutral label — blends in)
    const vaultRow = document.createElement("div");
    vaultRow.id = "vault-access-row";
    vaultRow.className = "vault-access-row";
    vaultRow.innerHTML = `
      <div id="vault-unlock-row" style="display:none;">
        <input type="password" id="vault-code-input" class="vault-code-input" placeholder="Access code" />
        <button class="vault-code-submit" id="vault-code-btn">&#10148;</button>
      </div>
      <button class="vault-toggle-btn" id="vault-toggle-btn">&#9679;&#9679;&#9679;</button>
    `;
    list.appendChild(vaultRow);

    // Wire vault toggle
    setTimeout(() => {
      const toggleBtn = document.getElementById("vault-toggle-btn");
      const unlockRow = document.getElementById("vault-unlock-row");
      const codeInput = document.getElementById("vault-code-input");
      const codeBtn = document.getElementById("vault-code-btn");

      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          if (unlockRow.style.display === "none") {
            unlockRow.style.display = "flex";
            if (codeInput) codeInput.focus();
          } else {
            unlockRow.style.display = "none";
          }
        });
      }

      if (vaultSession) {
        // Already unlocked — show vault entries
        renderVaultEntries(list);
      }

      if (codeBtn && codeInput) {
        const tryVaultUnlock = async () => {
          const pw = codeInput.value;
          if (!pw) return;
          const ok = await Memory.vaultVerifyPassword(pw);
          if (ok) {
            vaultSession = { password: pw, intentions: await Memory.vaultLoad(pw) };
            unlockRow.style.display = "none";
            codeInput.value = "";
            renderVaultEntries(list);
          } else {
            // Silent fail — no indication
            codeInput.value = "";
          }
        };
        codeBtn.addEventListener("click", tryVaultUnlock);
        codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryVaultUnlock(); });
      }
    }, 50);
  }

  function renderVaultEntries(container) {
    if (!vaultSession) return;
    // Remove existing vault section if any
    const existing = container.querySelector(".vault-entries-section");
    if (existing) existing.remove();

    const section = document.createElement("div");
    section.className = "vault-entries-section";

    const intentions = vaultSession.intentions || [];
    if (intentions.length === 0) {
      section.innerHTML = "<p style='color:#444;font-size:12px;padding:8px 0;'>&nbsp;</p>";
    } else {
      intentions.forEach(entry => {
        const div = document.createElement("div");
        div.className = "library-entry vault-entry" + (entry.id === activeVaultIntentionId ? " active" : "");
        const date = new Date(entry.updatedAt || entry.createdAt).toLocaleDateString([], { month: "short", day: "numeric" });
        div.innerHTML = `
          <div class="library-entry-title">${escapeHtml(entry.title)}</div>
          <div class="library-entry-meta">${escapeHtml(entry.text.substring(0, 80))}${entry.text.length > 80 ? "..." : ""}</div>
          <div class="library-entry-date">${date}</div>
        `;
        div.addEventListener("click", () => switchToVaultIntention(entry.id));
        section.appendChild(div);
      });
    }

    const newVaultBtn = document.createElement("button");
    newVaultBtn.className = "library-new-btn";
    newVaultBtn.style.opacity = "0.7";
    newVaultBtn.textContent = "+ Add Entry";
    newVaultBtn.addEventListener("click", createNewVaultIntention);
    section.appendChild(newVaultBtn);

    // Insert before vault-access-row
    const vaultAccessRow = container.querySelector("#vault-access-row");
    if (vaultAccessRow) {
      container.insertBefore(section, vaultAccessRow);
    } else {
      container.appendChild(section);
    }
  }

  function switchToIntention(id) {
    // Save last-read position before switching away
    if (activeIntentionId && chatHistory.length > 0) {
      const lastMsg = chatHistory[chatHistory.length - 1];
      if (lastMsg && lastMsg.id) {
        Memory.setLastReadMessageId(activeIntentionId, lastMsg.id);
      }
    }

    saveCurrentChat();
    activeVaultIntentionId = null;
    vaultChatHistory = [];

    const result = Memory.switchToLibraryIntention(id);
    if (!result) return;
    activeIntentionId = id;
    chatHistory = result.chatHistory;
    renderChatHistory();
    updateIntentionDisplay();
    closeLibrarySheet();

    // Activate council nav tab
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("nav-council").classList.add("active");

    if (chatHistory.length === 0) showWelcome();
    else scrollToBottom();
  }

  function switchToVaultIntention(id) {
    if (!vaultSession) return;
    saveCurrentChat();
    activeIntentionId = null;
    chatHistory = [];
    activeVaultIntentionId = id;
    vaultChatHistory = Memory.vaultLoadChat(vaultSession.password, id) || [];
    chatHistory = vaultChatHistory;

    // Load the vault entry and update intention display
    const entry = (vaultSession.intentions || []).find(e => e.id === id);
    if (entry) {
      // Temporarily display vault entry intention in the bar
      const el = document.getElementById("intention-text");
      if (el) el.textContent = entry.text || entry.title;
    }

    renderChatHistory();
    closeLibrarySheet();

    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("nav-council").classList.add("active");

    if (chatHistory.length === 0) showWelcome();
    else scrollToBottom();
  }

  async function createNewIntention() {
    const title = prompt("Name this intention:");
    if (!title || !title.trim()) return;
    const text = prompt("Describe your intention (as if it's already real):", title.trim());
    if (!text || !text.trim()) return;

    saveCurrentChat();
    const entry = Memory.createLibraryIntention(title.trim(), text.trim());
    activeIntentionId = entry.id;
    activeVaultIntentionId = null;
    chatHistory = [];
    renderChatHistory();
    updateIntentionDisplay();
    closeLibrarySheet();
    showWelcome();

    // Full council celebrates new intention creation
    const celebrateMsg = `A new intention has been created: "${text.trim()}". Welcome this intention into existence with genuine enthusiasm and your unique perspective.`;
    runCouncilRound(celebrateMsg);
  }

  async function createNewVaultIntention() {
    if (!vaultSession) return;
    const title = prompt("Name this intention:");
    if (!title || !title.trim()) return;
    const text = prompt("Describe this intention:", title.trim());
    if (!text || !text.trim()) return;

    saveCurrentChat();
    const updated = await Memory.vaultAddIntention(vaultSession.password, title.trim(), text.trim());
    vaultSession.intentions = updated;
    const entry = updated[updated.length - 1];
    await switchToVaultIntentionFromEntry(entry);
  }

  async function switchToVaultIntentionFromEntry(entry) {
    saveCurrentChat();
    activeIntentionId = null;
    chatHistory = [];
    activeVaultIntentionId = entry.id;
    vaultChatHistory = Memory.vaultLoadChat(vaultSession.password, entry.id) || [];
    chatHistory = vaultChatHistory;

    const el = document.getElementById("intention-text");
    if (el) el.textContent = entry.text || entry.title;

    renderChatHistory();
    closeLibrarySheet();
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("nav-council").classList.add("active");
    showWelcome();
    const celebrateMsg = `A new intention has been created: "${entry.text}". Welcome this intention with genuine enthusiasm and your unique perspective.`;
    runCouncilRound(celebrateMsg);
  }

  // ----------------------------------------------------------
  // WELCOME FLOW (first launch onboarding)
  // ----------------------------------------------------------
  function showWelcomeFlow() {
    const overlay = document.getElementById("welcome-flow-overlay");
    if (!overlay) return;
    overlay.classList.add("active");
    // Show first step
    document.querySelectorAll(".welcome-step").forEach(s => s.classList.remove("active"));
    const step1 = document.getElementById("welcome-step-1");
    if (step1) step1.classList.add("active");
  }

  function closeWelcomeFlow() {
    const overlay = document.getElementById("welcome-flow-overlay");
    if (overlay) overlay.classList.remove("active");
    renderChatHistory();
    updateIntentionDisplay();
    showWelcome();

    // Kick off full council greeting for new intention
    if (activeIntentionId) {
      const lib = Memory.loadIntentionsLibrary();
      const entry = lib.find(e => e.id === activeIntentionId);
      if (entry) {
        const celebrateMsg = `A new intention has been set: "${entry.text}". Welcome this intention into existence with genuine enthusiasm and your unique perspective.`;
        setTimeout(() => runCouncilRound(celebrateMsg), 300);
      }
    }
  }

  function completeWelcomeFlow(intentionText) {
    if (intentionText) {
      const entry = Memory.createLibraryIntention(
        intentionText.substring(0, 60),
        intentionText
      );
      activeIntentionId = entry.id;
      chatHistory = [];
      updateIntentionDisplay();
    }
    const overlay = document.getElementById("welcome-flow-overlay");
    if (overlay) overlay.classList.remove("active");
    renderChatHistory();
    showWelcome();

    if (activeIntentionId && intentionText) {
      const celebrateMsg = `A new intention has been set: "${intentionText}". Welcome this intention into existence with genuine enthusiasm and your unique perspective.`;
      setTimeout(() => runCouncilRound(celebrateMsg), 500);
    }
  }

  // ----------------------------------------------------------
  // INTENTION JOURNAL
  // ----------------------------------------------------------
  function openIntentionJournal() {
    const overlay = document.getElementById("journal-sheet");
    const container = document.getElementById("journal-entries");
    container.innerHTML = "";

    const intention = Memory.loadIntention();
    const history = intention.history || [];

    if (history.length === 0) {
      container.innerHTML = "<p style='color:#555;font-size:13px;'>No intention history yet.</p>";
    } else {
      // Show newest first
      [...history].reverse().forEach((entry, i) => {
        const div = document.createElement("div");
        div.className = "journal-entry";
        const date = new Date(entry.timestamp).toLocaleString();
        div.innerHTML = `
          <div class="journal-date">${date}</div>
          <div class="journal-text">${escapeHtml(entry.text)}</div>
        `;
        container.appendChild(div);
      });
    }

    overlay.classList.add("active");
  }

  function closeIntentionJournal() {
    document.getElementById("journal-sheet").classList.remove("active");
  }

  // ----------------------------------------------------------
  // FILL ALL API KEYS
  // ----------------------------------------------------------
  function fillAllKeys() {
    // Repurposed: test that the Worker is reachable and the token is accepted
    const urlEl   = document.getElementById("worker-url-input");
    const tokenEl = document.getElementById("worker-token-input");
    const url   = urlEl   ? urlEl.value.trim()   : localStorage.getItem("qc_proxy_url")   || "";
    const token = tokenEl ? tokenEl.value.trim() : localStorage.getItem("qc_proxy_token") || "";

    if (!url) {
      updateStatus("Enter your Worker URL first.");
      setTimeout(() => updateStatus(""), 3000);
      return;
    }
    updateStatus("Testing connection...");
    fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json"
      },
      // Use a known-invalid personaId so the Worker returns a predictable error
      body: JSON.stringify({ personaId: "_ping_", messages: [], model: "_ping_" })
    })
    .then(r => r.json())
    .then(data => {
      if (data.error === "Unauthorized") {
        updateStatus("❌ Wrong access token — check Settings.");
      } else {
        // Any other response (including missing-key error) means auth passed
        updateStatus("✅ Worker reachable. Auth accepted.");
      }
      setTimeout(() => updateStatus(""), 4000);
    })
    .catch(() => {
      updateStatus("❌ Cannot reach Worker URL.");
      setTimeout(() => updateStatus(""), 4000);
    });
  }

  // ----------------------------------------------------------
  // PHASE INDICATOR
  // ----------------------------------------------------------
  function showPhase(phaseName) {
    const el = document.getElementById("phase-indicator");
    if (el) {
      el.textContent = phaseName;
      el.style.display = "block";
    }
  }

  function hidePhase() {
    const el = document.getElementById("phase-indicator");
    if (el) {
      el.style.display = "none";
      el.textContent = "";
    }
  }

  // ----------------------------------------------------------
  // WELCOME SCREEN
  // ----------------------------------------------------------
  function showWelcome() {
    const container = document.getElementById("chat-messages");
    // Don't add if already there
    if (container.querySelector(".welcome-message")) return;

    const div = document.createElement("div");
    div.className = "welcome-message";
    div.innerHTML = `
      <div class="welcome-icon">🌌</div>
      <div class="welcome-title">The Quantum Council Awaits</div>
      <div class="welcome-body">
        Set your intention above, then press <strong>🧠 Start</strong> to open a session,
        or type a message and press <strong>⚡ Council</strong> to convene the full council.
      </div>
    `;
    container.appendChild(div);
  }

  function removeWelcome() {
    const el = document.querySelector(".welcome-message");
    if (el) el.remove();
  }

  // ----------------------------------------------------------
  // UI RENDERING
  // ----------------------------------------------------------
  function appendMessageToUI(msg) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");

    if (msg.role === "user") {
      div.className = "message user";
      div.dataset.msgId = msg.id || "";
      div.innerHTML = `<div class="content">${escapeHtml(msg.content)}</div>`;
      container.appendChild(div);
    } else if (msg.role === "persona") {
      const typeClass = msg.messageType === "synthesis"       ? "synthesis" :
                        msg.messageType === "session-open"    ? "session-open" :
                        msg.messageType === "council-convo"   ? "council-convo" :
                        msg.messageType === "council-convo-close" ? "council-convo-close" :
                        msg.messageType === "ambient"         ? "ambient" :
                        msg.personaId === "architect"         ? "architect" :
                        msg.personaId === "observer"          ? "observer" : "";
      div.className = `message persona ${typeClass}`;
      div.dataset.msgId = msg.id || "";

      let lockBtn = "";
      if (msg.messageType === "synthesis") {
        lockBtn = `<button class="lock-in-btn" title="Save this as your intention">🔒 Lock This In</button>`;
      }

      // Ambient whisper indicator
      let ambientTag = "";
      if (msg.messageType === "ambient") {
        ambientTag = `<span class="ambient-tag" title="This appeared on its own while you were away">✨ whisper</span>`;
      }

      div.innerHTML = `
        <div class="persona-name">
          ${msg.personaIcon || "🔮"} ${msg.personaName || "Unknown"}
          ${ambientTag}
          ${lockBtn}
        </div>
        <div class="content">${escapeHtml(msg.content)}</div>
      `;

      // Bind lock-in button after insertion
      if (msg.messageType === "synthesis") {
        const btn = div.querySelector(".lock-in-btn");
        if (btn) {
          btn.addEventListener("click", () => {
            Memory.saveIntention(msg.content);
            if (activeIntentionId) {
              Memory.updateLibraryIntention(activeIntentionId, { text: msg.content, title: msg.content.substring(0, 60) });
            }
            updateIntentionDisplay();
            btn.textContent = "\u2705 Locked In";
            btn.disabled = true;
            
            // Add a visible system message showing the intention was updated
            const sysMsg = Memory.addMessage(chatHistory, {
              role: "system",
              content: `📝 Intention locked in: "${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}"`,
              messageType: "intention-update"
            });
            appendMessageToUI(sysMsg);
            scrollToBottom();
          });
        }
      }

      // Per-message three-dot context menu
      const msgDotsBtn = document.createElement("button");
      msgDotsBtn.type = "button";
      msgDotsBtn.className = "msg-dots-btn";
      msgDotsBtn.innerHTML = "&#8942;";
      msgDotsBtn.title = "Message options";
      div.appendChild(msgDotsBtn);

      const msgCtxMenu = document.createElement("div");
      msgCtxMenu.className = "msg-context-menu";
      const modelInfoHtml = msg.model
        ? `<div class="dots-menu-divider"></div><div class="msg-context-info">${escapeHtml(msg.model)}</div>`
        : "";
      msgCtxMenu.innerHTML = `
        <button type="button" class="msg-context-item" data-action="copy">&#128203; Copy</button>
        <div class="dots-menu-divider"></div>
        <button type="button" class="msg-context-item danger" data-action="delete">&#128465; Delete</button>
        ${modelInfoHtml}
      `;
      div.appendChild(msgCtxMenu);

      msgDotsBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        const isOpen = msgCtxMenu.classList.contains("open");
        closeAllContextMenus();
        if (!isOpen) {
          const rect = msgDotsBtn.getBoundingClientRect();
          msgCtxMenu.style.top = (rect.bottom + 4) + "px";
          msgCtxMenu.style.right = (window.innerWidth - rect.right) + "px";
          msgCtxMenu.classList.add("open");
          msgDotsBtn.classList.add("open");
        }
      });

      msgCtxMenu.querySelector('[data-action="copy"]').addEventListener("click", function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(msg.content).then(function() {
          updateStatus("Copied.");
          setTimeout(function() { updateStatus(""); }, 1500);
        });
        closeAllContextMenus();
      });

      msgCtxMenu.querySelector('[data-action="delete"]').addEventListener("click", function(e) {
        e.stopPropagation();
        const msgId = msg.id;
        const idx = chatHistory.findIndex(function(m) { return m.id === msgId; });
        if (idx !== -1) {
          chatHistory.splice(idx, 1);
          saveCurrentChat();
          div.remove();
        }
        closeAllContextMenus();
      });

      container.appendChild(div);
    } else if (msg.role === "system") {
      // System messages (intention updates, etc.)
      div.className = `message system ${msg.messageType || ""}`;
      div.dataset.msgId = msg.id || "";
      div.innerHTML = `<div class="content">${escapeHtml(msg.content)}</div>`;
      container.appendChild(div);
    }
  }

  function renderChatHistory() {
    const container = document.getElementById("chat-messages");
    container.innerHTML = "";
    for (const msg of chatHistory) {
      appendMessageToUI(msg);
    }

    // Insert unread divider if we have a last-read position and messages after it
    const lastReadId = activeIntentionId ? Memory.getLastReadMessageId(activeIntentionId) : null;
    if (lastReadId) {
      const lastReadEl = container.querySelector(`[data-msg-id="${lastReadId}"]`);
      if (lastReadEl && lastReadEl !== container.lastElementChild) {
        const divider = document.createElement("div");
        divider.className = "unread-divider";
        divider.id = "unread-divider";
        divider.innerHTML = "<span>New Messages</span>";
        lastReadEl.insertAdjacentElement("afterend", divider);
      }
    }
  }

  function showTyping(name) {
    const el = document.getElementById("typing-indicator");
    el.textContent = `${name} is typing...`;
    el.style.display = "block";
    scrollToBottom();
  }

  function hideTyping() {
    document.getElementById("typing-indicator").style.display = "none";
  }

  function updateStatus(text) {
    const el = document.getElementById("council-status");
    if (text) {
      el.textContent = text;
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  }

  function setButtonsDisabled(disabled) {
    document.getElementById("send-btn").disabled = disabled;
    document.getElementById("council-btn").disabled = disabled;
    const councilConvoBtn = document.getElementById("council-convo-btn");
    const startBtn = document.getElementById("start-session-btn");
    if (councilConvoBtn) councilConvoBtn.disabled = disabled;
    if (startBtn) startBtn.disabled = disabled;
    if (disabled) {
      document.getElementById("council-btn").classList.add("running");
    } else {
      document.getElementById("council-btn").classList.remove("running");
    }
  }

  function scrollToBottom() {
    const chat = document.getElementById("chat-area");
    requestAnimationFrame(() => {
      const divider = document.getElementById("unread-divider");
      if (divider) {
        const chatRect = chat.getBoundingClientRect();
        const dividerRect = divider.getBoundingClientRect();
        chat.scrollTop += dividerRect.top - chatRect.top - 60;
      } else {
        chat.scrollTop = chat.scrollHeight;
      }
    });
  }

  function updateModeDisplay() {
    const label = document.getElementById("mode-label");
    if (mode === "council") {
      label.textContent = "Full Council";
    } else {
      const p = PERSONAS.find(pp => pp.id === mode);
      label.textContent = p ? `1-on-1: ${p.icon} ${p.shortName}` : mode;
    }
  }

  // ----------------------------------------------------------
  // INTENTION
  // ----------------------------------------------------------
  function updateIntentionDisplay() {
    const el = document.getElementById("intention-text");
    if (activeVaultIntentionId && vaultSession) {
      const entry = (vaultSession.intentions || []).find(e => e.id === activeVaultIntentionId);
      el.textContent = entry ? (entry.text || entry.title) : "(No intention set)";
      return;
    }
    if (activeIntentionId) {
      const lib = Memory.loadIntentionsLibrary();
      const entry = lib.find(e => e.id === activeIntentionId);
      if (entry) {
        el.textContent = entry.text || entry.title;
        return;
      }
    }
    const intention = Memory.loadIntention();
    el.textContent = intention.text || "(No intention set — tap Edit to set one)";
  }

  function openIntentionEdit() {
    // Edit the active library intention, or fall back to legacy
    if (activeIntentionId) {
      const lib = Memory.loadIntentionsLibrary();
      const entry = lib.find(e => e.id === activeIntentionId);
      const current = entry ? entry.text : "";
      const newText = prompt("Set your intention (this is already real):", current);
      if (newText !== null && newText.trim()) {
        Memory.updateLibraryIntention(activeIntentionId, { text: newText.trim(), title: newText.trim().substring(0, 60) });
        Memory.saveIntention(newText.trim()); // keep legacy in sync
        updateIntentionDisplay();
      }
    } else {
      const intention = Memory.loadIntention();
      const newText = prompt("Set your intention (this is already real):", intention.text || "");
      if (newText !== null && newText.trim()) {
        Memory.saveIntention(newText.trim());
        updateIntentionDisplay();
      }
    }
  }

  // ----------------------------------------------------------
  // SETTINGS
  // ----------------------------------------------------------
  function openSettings() {
    const panel = document.getElementById("settings-sheet");
    const container = document.getElementById("persona-settings-list");
    container.innerHTML = "";

    // Worker connection section
    const savedUrl   = localStorage.getItem("qc_proxy_url")   || "";
    const savedToken = localStorage.getItem("qc_proxy_token") || "";
    const workerBlock = document.createElement("div");
    workerBlock.style.cssText = "border:1px solid #336;padding:14px;margin-bottom:16px;background:#0d0d1a;border-radius:2px;";
    const savedOrKey = localStorage.getItem("qc_openrouter_key") || "";
    workerBlock.innerHTML = `
      <div style="font-size:13px;color:#88a;margin-bottom:10px;">🔑 API Connection</div>
      <label>OpenRouter API Key <span style="color:#555;font-size:11px">(direct — no worker needed)</span></label>
      <input id="or-key-input" type="password"
        value="${escapeHtml(savedOrKey)}"
        placeholder="sk-or-v1-..." autocomplete="off" />
      <div style="margin:12px 0;border-top:1px solid #222;"></div>
      <label>Worker URL <span style="color:#555;font-size:11px">(optional — advanced setup)</span></label>
      <input id="worker-url-input" type="text"
        value="${escapeHtml(savedUrl)}"
        placeholder="https://quantum-council-proxy.YOUR-ID.workers.dev" />
      <label>Worker Access Token</label>
      <input id="worker-token-input" type="password"
        value="${escapeHtml(savedToken)}"
        placeholder="Your secret access token" />
    `;
    container.appendChild(workerBlock);

    for (const p of PERSONAS) {
      const block = document.createElement("details");
      block.className = "persona-block";
      block.innerHTML = `
        <summary>${p.icon} ${p.name} ${p.isArchitect ? "(MAIN)" : ""}</summary>
        <label>Model</label>
        <input type="text" data-persona="${p.id}" data-field="model"
          value="${escapeHtml(p.model || "")}"
          placeholder="e.g. mistralai/mistral-small" />
        <div style="margin-top:8px;font-size:11px;color:#555;">
          Role: ${p.role}<br/>
          Influences: ${p.influences}
        </div>
      `;
      container.appendChild(block);
    }

    panel.classList.add("active");
  }

  function closeSettings() {
    document.getElementById("settings-sheet").classList.remove("active");
  }

  function saveSettings() {
    // Save API connection details
    const orKeyEl       = document.getElementById("or-key-input");
    const workerUrlEl   = document.getElementById("worker-url-input");
    const workerTokenEl = document.getElementById("worker-token-input");
    if (orKeyEl && orKeyEl.value.trim())       localStorage.setItem("qc_openrouter_key", orKeyEl.value.trim());
    else if (orKeyEl && !orKeyEl.value.trim()) localStorage.removeItem("qc_openrouter_key");
    if (workerUrlEl)   localStorage.setItem("qc_proxy_url",   workerUrlEl.value.trim());
    if (workerTokenEl && workerTokenEl.value.trim()) {
      localStorage.setItem("qc_proxy_token", workerTokenEl.value.trim());
    }

    // Save per-persona model overrides only (API keys are in the Worker)
    const inputs = document.querySelectorAll("#persona-settings-list input[data-persona]");
    const settings = Memory.loadPersonaSettings();
    inputs.forEach(input => {
      const personaId = input.dataset.persona;
      const field = input.dataset.field;
      if (!settings[personaId]) settings[personaId] = {};
      settings[personaId][field] = input.value.trim();
    });

    Memory.savePersonaSettings(settings);
    Memory.applyPersonaSettings(PERSONAS);
    closeSettings();
    updateStatus("Settings saved.");
    setTimeout(() => updateStatus(""), 2000);
  }

  // ----------------------------------------------------------
  // UTILITY
  // ----------------------------------------------------------
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ----------------------------------------------------------
  // MESSAGE SELECTION MODE
  // ----------------------------------------------------------
  function enterMessageSelectionMode() {
    messageSelectionMode = true;
    selectedMessageIds = [];

    const editBtn = document.getElementById("edit-messages-btn");
    const doneBtn = document.getElementById("done-messages-btn");
    if (editBtn) editBtn.classList.add("hidden");
    if (doneBtn) doneBtn.classList.remove("hidden");
    document.getElementById("message-selection-toolbar").classList.remove("hidden");

    document.querySelectorAll("#chat-messages .message").forEach((msg, index) => {
      msg.classList.add("selectable");
      msg.dataset.messageIndex = index;

      const checkbox = document.createElement("div");
      checkbox.className = "message-checkbox";
      msg.appendChild(checkbox);

      msg.addEventListener("click", handleMessageClick);
      msg.addEventListener("touchstart", handleTouchStart, { passive: true });
      msg.addEventListener("touchend", handleTouchEnd);
      msg.addEventListener("mousedown", handleMouseDown);
      msg.addEventListener("mouseup", handleMouseUp);
      msg.addEventListener("mouseleave", handleMouseLeave);
    });

    updateSelectionUI();
  }

  function exitMessageSelectionMode() {
    messageSelectionMode = false;
    selectedMessageIds = [];

    const editBtn = document.getElementById("edit-messages-btn");
    const doneBtn = document.getElementById("done-messages-btn");
    if (editBtn) editBtn.classList.remove("hidden");
    if (doneBtn) doneBtn.classList.add("hidden");
    document.getElementById("message-selection-toolbar").classList.add("hidden");

    document.querySelectorAll("#chat-messages .message").forEach(msg => {
      msg.classList.remove("selectable", "selected", "long-pressing");
      delete msg.dataset.messageIndex;

      const checkbox = msg.querySelector(".message-checkbox");
      if (checkbox) checkbox.remove();

      msg.removeEventListener("click", handleMessageClick);
      msg.removeEventListener("touchstart", handleTouchStart);
      msg.removeEventListener("touchend", handleTouchEnd);
      msg.removeEventListener("mousedown", handleMouseDown);
      msg.removeEventListener("mouseup", handleMouseUp);
      msg.removeEventListener("mouseleave", handleMouseLeave);
    });

    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleMessageClick(e) {
    if (!messageSelectionMode) return;
    const msg = e.currentTarget;
    const index = parseInt(msg.dataset.messageIndex);
    toggleMessageSelection(index, msg);
  }

  function handleTouchStart(e) {
    if (!messageSelectionMode) return;
    const msg = e.currentTarget;
    msg.classList.add("long-pressing");
    longPressTimer = setTimeout(() => {
      const index = parseInt(msg.dataset.messageIndex);
      if (!selectedMessageIds.includes(index)) toggleMessageSelection(index, msg);
      msg.classList.remove("long-pressing");
    }, LONG_PRESS_DURATION);
  }

  function handleTouchEnd(e) {
    if (!messageSelectionMode) return;
    e.currentTarget.classList.remove("long-pressing");
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  function handleMouseDown(e) {
    if (!messageSelectionMode) return;
    const msg = e.currentTarget;
    msg.classList.add("long-pressing");
    longPressTimer = setTimeout(() => {
      const index = parseInt(msg.dataset.messageIndex);
      if (!selectedMessageIds.includes(index)) toggleMessageSelection(index, msg);
      msg.classList.remove("long-pressing");
    }, LONG_PRESS_DURATION);
  }

  function handleMouseUp(e) {
    if (!messageSelectionMode) return;
    e.currentTarget.classList.remove("long-pressing");
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  function handleMouseLeave(e) {
    if (!messageSelectionMode) return;
    e.currentTarget.classList.remove("long-pressing");
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  function toggleMessageSelection(index, msgElement) {
    const idIndex = selectedMessageIds.indexOf(index);
    if (idIndex === -1) {
      selectedMessageIds.push(index);
      msgElement.classList.add("selected");
    } else {
      selectedMessageIds.splice(idIndex, 1);
      msgElement.classList.remove("selected");
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = selectedMessageIds.length;
    const shareBtn = document.getElementById("selection-share");
    const deleteBtn = document.getElementById("selection-delete");
    const shareCount = document.getElementById("share-count");
    const deleteCount = document.getElementById("delete-count");
    shareBtn.disabled = count === 0;
    deleteBtn.disabled = count === 0;
    shareCount.textContent = count;
    deleteCount.textContent = count;
  }

  function openShareFormatSheet() {
    document.getElementById("share-format-sheet").classList.add("active");
  }

  function shareMessages(format) {
    if (selectedMessageIds.length === 0) return;
    const sortedIndices = [...selectedMessageIds].sort((a, b) => a - b);
    const selectedMessages = sortedIndices.map(i => chatHistory[i]).filter(Boolean);
    let shareText = "";
    if (format === "plain") {
      shareText = selectedMessages.map(msg => {
        const timestamp = new Date(msg.timestamp || Date.now()).toLocaleString();
        if (msg.role === "user") return `[${timestamp}] You: ${msg.content}`;
        if (msg.role === "persona") return `[${timestamp}] ${msg.personaName || "Council"}: ${msg.content}`;
        return `[${timestamp}] ${msg.content}`;
      }).join("\n\n");
    } else {
      shareText = selectedMessages.map(msg => {
        const timestamp = new Date(msg.timestamp || Date.now()).toLocaleString();
        if (msg.role === "user") return `[${timestamp}] You:\n${msg.content}`;
        if (msg.role === "persona") return `[${timestamp}] ${msg.personaIcon || "🔮"} ${msg.personaName || "Council"}:\n${msg.content}`;
        return `[${timestamp}] ${msg.content}`;
      }).join("\n\n---\n\n");
    }
    navigator.clipboard.writeText(shareText).then(() => {
      updateStatus(`Copied ${selectedMessageIds.length} message(s) to clipboard`);
      setTimeout(() => updateStatus(""), 2000);
      closeSheet("share-format-sheet");
      exitMessageSelectionMode();
    }).catch(() => {
      alert("Failed to copy to clipboard. Please try again.");
    });
  }

  function deleteSelectedMessages() {
    if (selectedMessageIds.length === 0) return;
    const count = selectedMessageIds.length;
    if (!confirm(`Delete ${count} message${count === 1 ? "" : "s"}?`)) return;
    const sortedIndices = [...selectedMessageIds].sort((a, b) => b - a);
    sortedIndices.forEach(index => { chatHistory.splice(index, 1); });
    saveCurrentChat();
    renderChatHistory();
    exitMessageSelectionMode();
    updateStatus(`Deleted ${count} message${count === 1 ? "" : "s"}`);
    setTimeout(() => updateStatus(""), 2000);
  }

  function closeSheet(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  }

  // ----------------------------------------------------------
  // CLOSE ALL CONTEXT MENUS
  // ----------------------------------------------------------
  function closeAllContextMenus() {
    document.querySelectorAll(".msg-context-menu.open").forEach(function(m) { m.classList.remove("open"); });
    document.querySelectorAll(".msg-dots-btn.open").forEach(function(b) { b.classList.remove("open"); });
    const topMenu = document.getElementById("top-dots-menu");
    const topBtn  = document.getElementById("top-dots-btn");
    if (topMenu) topMenu.classList.remove("open");
    if (topBtn)  topBtn.classList.remove("open");
  }

  // ----------------------------------------------------------
  // ACTIVE PERSONAS FILTER
  // ----------------------------------------------------------
  function getActivePersonas() {
    const stored = localStorage.getItem("qc_active_personas");
    if (!stored) return PERSONAS; // default: all active
    try {
      const ids = JSON.parse(stored);
      // Always include the Architect; filter others by saved list
      return PERSONAS.filter(p => p.isArchitect || ids.includes(p.id));
    } catch (e) {
      return PERSONAS;
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  // Expose functions needed by inline HTML scripts
  window.openSettings = openSettings;
  window.openIntentionJournal = openIntentionJournal;
  window.openLibrarySheet = openLibrarySheet;
  window.closeLibrarySheet = closeLibrarySheet;
  window.closeWelcomeFlow = closeWelcomeFlow;
  window.completeWelcomeFlow = completeWelcomeFlow;
  window.getActivePersonas = getActivePersonas;
})();