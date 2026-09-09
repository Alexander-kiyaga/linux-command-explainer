/**
 * Linux Command Explainer - Frontend Application Logic
 *
 * CRITICAL SECURITY PRINCIPLES:
 * 1. Safe DOM manipulation: Untrusted user input and AI responses are ALWAYS
 *    rendered using `textContent` or DOM element creation. Never use `innerHTML`
 *    for dynamic content.
 * 2. Commands are purely explained and NEVER executed.
 * 3. Read-only commands are NOT automatically labelled as "safe".
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements - Explainer
  const explainForm = document.getElementById("explain-form");
  const commandInput = document.getElementById("command-input");
  const explainBtn = document.getElementById("explain-btn");
  const clearBtn = document.getElementById("clear-btn");
  const charCounter = document.getElementById("char-counter");
  const quickChips = document.querySelectorAll(".chip");

  // DOM Elements - Output Container
  const explanationContainer = document.getElementById("explanation-container");
  const loadingState = document.getElementById("loading-state");
  const errorCard = document.getElementById("error-card");
  const errorTitle = document.getElementById("error-title");
  const errorMessage = document.getElementById("error-message");
  const errorActions = document.getElementById("error-actions");
  const resultsCard = document.getElementById("results-card");

  // DOM Elements - Result Fields
  const resultCommandText = document.getElementById("result-command-text");
  const resultImpactBadge = document.getElementById("result-impact-badge");
  const resultImpactLabel = document.getElementById("result-impact-label");
  const impactBanner = document.getElementById("impact-banner");
  const impactIcon = document.getElementById("impact-icon");
  const impactDescription = document.getElementById("impact-description");
  const safetyWarningBox = document.getElementById("safety-warning-box");
  const safetyWarningText = document.getElementById("safety-warning-text");
  const resultSummary = document.getElementById("result-summary");
  const breakdownGrid = document.getElementById("breakdown-grid");
  const optionsGrid = document.getElementById("options-grid");
  const examplesList = document.getElementById("examples-list");
  const resultNotes = document.getElementById("result-notes");

  // DOM Elements - Dictionary
  const dictionarySearch = document.getElementById("dictionary-search");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const resetSearchBtn = document.getElementById("reset-search-btn");
  const categoryPills = document.querySelectorAll(".cat-pill");
  const dictionaryGrid = document.getElementById("dictionary-grid");
  const noCommandsFound = document.getElementById("no-commands-found");
  const countAllSpan = document.getElementById("count-all");
  const apiKeyBanner = document.getElementById("api-key-banner");
  const toast = document.getElementById("toast");

  // State
  let commandsData = [];
  let activeCategory = "all";
  let searchQuery = "";
  const maxLength = parseInt(commandInput?.getAttribute("maxlength") || "500", 10);

  // -------------------------------------------------------------------------
  // Safe Impact Configuration
  // -------------------------------------------------------------------------
  const IMPACT_MAP = {
    read: {
      label: "Reads Information",
      className: "impact-read",
      icon: "ℹ️",
      defaultDesc: "Reads or inspects files or system data. Does not alter files, but reading sensitive files or massive data streams has operational risks."
    },
    modify: {
      label: "Modifies Files / State",
      className: "impact-modify",
      icon: "✏️",
      defaultDesc: "Creates, updates, renames, or edits files, directories, or system configurations."
    },
    delete: {
      label: "Deletes / Destructive",
      className: "impact-delete",
      icon: "⚠️",
      defaultDesc: "Permanently deletes files/directories, unlinks data, or terminates active processes."
    },
    depends: {
      label: "Impact Depends on Flags",
      className: "impact-depends",
      icon: "🔄",
      defaultDesc: "The impact varies significantly based on flags or operands provided (e.g. read-only display vs. in-place modification)."
    },
    unknown: {
      label: "Unknown / Ambiguous",
      className: "impact-unknown",
      icon: "❓",
      defaultDesc: "The command or flags could not be unambiguously classified."
    }
  };

  function getImpactConfig(impactKey) {
    const key = (impactKey || "unknown").toLowerCase();
    return IMPACT_MAP[key] || IMPACT_MAP.unknown;
  }

  // -------------------------------------------------------------------------
  // Toast Notification
  // -------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    toast.style.opacity = "1";

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.classList.add("hidden"), 200);
    }, 2200);
  }

  // -------------------------------------------------------------------------
  // Clipboard Copy Helper
  // -------------------------------------------------------------------------
  async function copyToClipboard(text, btnElement) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-https or older browser environments
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      showToast(`Copied: "${text}"`);
      if (btnElement) {
        const originalText = btnElement.textContent;
        btnElement.textContent = "✓ Copied!";
        setTimeout(() => {
          btnElement.textContent = originalText;
        }, 1800);
      }
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      showToast("Failed to copy to clipboard.");
    }
  }

  // -------------------------------------------------------------------------
  // Character Counter & Input Helpers
  // -------------------------------------------------------------------------
  function updateCharCounter() {
    const len = commandInput.value.length;
    charCounter.textContent = `${len} / ${maxLength}`;
    if (len > 0) {
      clearBtn.classList.remove("hidden");
    } else {
      clearBtn.classList.add("hidden");
    }
  }

  commandInput.addEventListener("input", updateCharCounter);

  clearBtn.addEventListener("click", () => {
    commandInput.value = "";
    updateCharCounter();
    commandInput.focus();
  });

  // Quick Chips
  quickChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const cmd = chip.getAttribute("data-cmd");
      if (cmd) {
        commandInput.value = cmd;
        updateCharCounter();
        handleExplain(cmd);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Safe Result Rendering (Strictly textContent, zero innerHTML)
  // -------------------------------------------------------------------------
  function renderExplanation(commandText, data) {
    // 1. Command Text
    resultCommandText.textContent = commandText;

    // 2. Impact Badge & Banner
    const impactInfo = getImpactConfig(data.impact);

    // Reset impact badge classes
    resultImpactBadge.className = "impact-badge " + impactInfo.className;
    resultImpactLabel.textContent = impactInfo.label;

    // Impact Banner
    impactBanner.className = "impact-banner " + impactInfo.className;
    impactIcon.textContent = impactInfo.icon;
    impactDescription.textContent = data.impact_explanation || impactInfo.defaultDesc;

    // 3. Safety Warning Box
    if (data.safety_warning && data.safety_warning.trim()) {
      safetyWarningText.textContent = data.safety_warning.trim();
      safetyWarningBox.classList.remove("hidden");
    } else {
      safetyWarningBox.classList.add("hidden");
    }

    // 4. Plain-English Summary
    resultSummary.textContent = data.summary || "No summary provided.";

    // 5. Token Breakdown Grid (Clear and safely append elements)
    breakdownGrid.innerHTML = ""; // Empty previous children
    if (Array.isArray(data.breakdown) && data.breakdown.length > 0) {
      data.breakdown.forEach(item => {
        const card = document.createElement("div");
        card.className = "breakdown-card";

        const header = document.createElement("div");
        header.className = "breakdown-header";

        const tokenEl = document.createElement("span");
        tokenEl.className = "breakdown-token";
        tokenEl.textContent = item.token || "";

        const tagEl = document.createElement("span");
        tagEl.className = "breakdown-type-tag";
        tagEl.textContent = item.token_type || "token";

        header.appendChild(tokenEl);
        header.appendChild(tagEl);

        const meaningEl = document.createElement("p");
        meaningEl.className = "breakdown-meaning";
        meaningEl.textContent = item.explanation || "";

        card.appendChild(header);
        card.appendChild(meaningEl);
        breakdownGrid.appendChild(card);
      });
      document.getElementById("breakdown-section").classList.remove("hidden");
    } else {
      document.getElementById("breakdown-section").classList.add("hidden");
    }

    // 6. Common Additional Options Grid
    optionsGrid.innerHTML = "";
    if (Array.isArray(data.common_options) && data.common_options.length > 0) {
      data.common_options.forEach(opt => {
        const card = document.createElement("div");
        card.className = "option-card";

        const flagEl = document.createElement("span");
        flagEl.className = "option-flag";
        flagEl.textContent = opt.option || "";

        const descEl = document.createElement("p");
        descEl.className = "option-desc";
        descEl.textContent = opt.explanation || "";

        card.appendChild(flagEl);
        card.appendChild(descEl);
        optionsGrid.appendChild(card);
      });
      document.getElementById("common-options-section").classList.remove("hidden");
    } else {
      document.getElementById("common-options-section").classList.add("hidden");
    }

    // 7. Useful Examples List
    examplesList.innerHTML = "";
    if (Array.isArray(data.useful_examples) && data.useful_examples.length > 0) {
      data.useful_examples.forEach(ex => {
        const item = document.createElement("div");
        item.className = "example-item";

        const row = document.createElement("div");
        row.className = "example-cmd-row";

        const codeEl = document.createElement("code");
        codeEl.className = "example-cmd-code";
        codeEl.textContent = ex.command || "";

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "0.4rem";

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "btn-icon-copy";
        copyBtn.textContent = "📋 Copy";
        copyBtn.addEventListener("click", () => copyToClipboard(ex.command, copyBtn));

        const explainBtn = document.createElement("button");
        explainBtn.type = "button";
        explainBtn.className = "btn-icon-explain";
        explainBtn.textContent = "🔍 Explain";
        explainBtn.addEventListener("click", () => {
          commandInput.value = ex.command;
          updateCharCounter();
          handleExplain(ex.command);
        });

        actions.appendChild(copyBtn);
        actions.appendChild(explainBtn);

        row.appendChild(codeEl);
        row.appendChild(actions);

        const descEl = document.createElement("p");
        descEl.className = "example-desc";
        descEl.textContent = ex.explanation || "";

        item.appendChild(row);
        item.appendChild(descEl);
        examplesList.appendChild(item);
      });
      document.getElementById("examples-section").classList.remove("hidden");
    } else {
      document.getElementById("examples-section").classList.add("hidden");
    }

    // 8. Linux vs macOS / Version Notes
    if (data.version_and_system_notes && data.version_and_system_notes.trim()) {
      resultNotes.textContent = data.version_and_system_notes.trim();
      document.getElementById("notes-section").classList.remove("hidden");
    } else {
      document.getElementById("notes-section").classList.add("hidden");
    }

    // Reveal Results Card
    resultsCard.classList.remove("hidden");
  }

  // -------------------------------------------------------------------------
  // Handle Explain Action
  // -------------------------------------------------------------------------
  async function handleExplain(rawCommand) {
    const command = (rawCommand || "").trim();

    if (!command) {
      showError("Empty Command", "Please enter a Linux command to explain.");
      commandInput.focus();
      return;
    }

    if (command.length > maxLength) {
      showError("Command Too Long", `Command exceeds maximum limit of ${maxLength} characters.`);
      return;
    }

    // Scroll smoothly to output container
    explanationContainer.classList.remove("hidden");
    explanationContainer.scrollIntoView({ behavior: "smooth", block: "start" });

    // Set UI to loading state
    loadingState.classList.remove("hidden");
    errorCard.classList.add("hidden");
    resultsCard.classList.add("hidden");
    explainBtn.disabled = true;

    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ command: command })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        if (result.error === "api_key_missing") {
          // Show honest setup notification
          if (apiKeyBanner) {
            apiKeyBanner.classList.remove("hidden");
            apiKeyBanner.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          showError(
            "Gemini API Key Required",
            "A Google Gemini API key is required for real AI explanations. Please set GEMINI_API_KEY in your local .env file. We do not generate fake mock responses.",
            true
          );
        } else if (result.error === "validation_error") {
          showError("Validation Error", result.message || "Invalid command input.");
        } else {
          showError("Service Error", result.message || "Failed to analyze command with Gemini.");
        }
        return;
      }

      // Render the structured response safely
      renderExplanation(command, result.data);

    } catch (err) {
      console.error("Explain request failed:", err);
      showError("Network Error", "Unable to reach the local explainer server. Please verify the Flask server is running.");
    } finally {
      loadingState.classList.add("hidden");
      explainBtn.disabled = false;
    }
  }

  function showError(title, message, showSetupLink = false) {
    errorTitle.textContent = title;
    errorMessage.textContent = message;
    if (showSetupLink) {
      errorActions.classList.remove("hidden");
    } else {
      errorActions.classList.add("hidden");
    }
    errorCard.classList.remove("hidden");
    resultsCard.classList.add("hidden");
  }

  explainForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleExplain(commandInput.value);
  });

  // -------------------------------------------------------------------------
  // Searchable Command Dictionary Logic
  // -------------------------------------------------------------------------
  async function loadDictionary() {
    try {
      const res = await fetch("/api/commands");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      commandsData = json.commands || [];
      if (countAllSpan) countAllSpan.textContent = commandsData.length;
      renderDictionary();
    } catch (err) {
      console.error("Failed to load command dictionary:", err);
      dictionaryGrid.innerHTML = "";
      const errEl = document.createElement("div");
      errEl.className = "loading-commands";
      errEl.textContent = "Failed to load command dictionary. Please refresh.";
      dictionaryGrid.appendChild(errEl);
    }
  }

  function renderDictionary() {
    dictionaryGrid.innerHTML = "";

    const query = searchQuery.trim().toLowerCase();

    const filtered = commandsData.filter(item => {
      // Category filter
      if (activeCategory !== "all" && item.category !== activeCategory) {
        return false;
      }
      // Search text filter
      if (!query) return true;

      const inName = (item.name || "").toLowerCase().includes(query);
      const inDesc = (item.description || "").toLowerCase().includes(query);
      const inExample = (item.example || "").toLowerCase().includes(query);
      const inCategory = (item.category || "").toLowerCase().includes(query);

      return inName || inDesc || inExample || inCategory;
    });

    if (filtered.length === 0) {
      noCommandsFound.classList.remove("hidden");
      return;
    }

    noCommandsFound.classList.add("hidden");

    filtered.forEach(item => {
      const card = document.createElement("article");
      card.className = "command-card";

      // Card Header
      const top = document.createElement("div");
      top.className = "card-top";

      const titleWrap = document.createElement("div");
      titleWrap.className = "cmd-title-wrap";

      const nameEl = document.createElement("h3");
      nameEl.className = "cmd-name";
      nameEl.textContent = item.name;

      const catEl = document.createElement("span");
      catEl.className = "cmd-category-tag";
      catEl.textContent = item.category;

      titleWrap.appendChild(nameEl);
      titleWrap.appendChild(catEl);

      // Impact badge for the displayed example
      const impactInfo = getImpactConfig(item.impact);
      const badge = document.createElement("span");
      badge.className = "impact-badge " + impactInfo.className;
      badge.style.fontSize = "0.72rem";
      badge.style.padding = "0.2rem 0.55rem";
      badge.textContent = impactInfo.label;
      badge.title = item.impact_reason || impactInfo.defaultDesc;

      top.appendChild(titleWrap);
      top.appendChild(badge);

      // Description
      const desc = document.createElement("p");
      desc.className = "card-desc";
      desc.textContent = item.description;

      // Example Box
      const exampleBox = document.createElement("div");
      exampleBox.className = "example-box";

      const exCode = document.createElement("code");
      exCode.className = "example-text";
      exCode.textContent = item.example;
      exCode.title = item.example;

      exampleBox.appendChild(exCode);

      // Actions (Copy & Explain)
      const actions = document.createElement("div");
      actions.className = "card-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-card-copy";
      copyBtn.textContent = "📋 Copy";
      copyBtn.addEventListener("click", () => copyToClipboard(item.example, copyBtn));

      const expBtn = document.createElement("button");
      expBtn.type = "button";
      expBtn.className = "btn-card-explain";
      expBtn.textContent = "🔍 Explain";
      expBtn.addEventListener("click", () => {
        commandInput.value = item.example;
        updateCharCounter();
        handleExplain(item.example);
      });

      actions.appendChild(copyBtn);
      actions.appendChild(expBtn);

      // Assemble card
      card.appendChild(top);
      card.appendChild(desc);
      card.appendChild(exampleBox);
      card.appendChild(actions);

      dictionaryGrid.appendChild(card);
    });
  }

  // Dictionary Search Input
  dictionarySearch.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    if (searchQuery.length > 0) {
      clearSearchBtn.classList.remove("hidden");
    } else {
      clearSearchBtn.classList.add("hidden");
    }
    renderDictionary();
  });

  clearSearchBtn.addEventListener("click", () => {
    dictionarySearch.value = "";
    searchQuery = "";
    clearSearchBtn.classList.add("hidden");
    renderDictionary();
    dictionarySearch.focus();
  });

  resetSearchBtn.addEventListener("click", () => {
    dictionarySearch.value = "";
    searchQuery = "";
    clearSearchBtn.classList.add("hidden");
    activeCategory = "all";
    categoryPills.forEach(p => p.classList.toggle("active", p.getAttribute("data-category") === "all"));
    renderDictionary();
  });

  // Category Pills
  categoryPills.forEach(pill => {
    pill.addEventListener("click", () => {
      categoryPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeCategory = pill.getAttribute("data-category") || "all";
      renderDictionary();
    });
  });

  // Initialize
  updateCharCounter();
  loadDictionary();
});
