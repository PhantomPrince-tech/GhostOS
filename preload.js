
const { contextBridge, ipcRenderer } = require("electron");

// ==========================================
// GHOSTOS PHASE 9.2
// GHOST BRAIN - SECURE PRELOAD BRIDGE
// ==========================================
//
// Features:
// System Monitor
// Smart File Manager
// Ghost Terminal
// Windows App Launcher
// Command History
// Ghost Brain Memory
// Offline Ollama AI
// AI Response Streaming
// AI Cancellation
//
// ==========================================

// ==========================================
// INPUT VALIDATION
// ==========================================

function isValidText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.length <= maxLength
  );
}

function isValidNonEmptyText(value, maxLength) {
  return (
    isValidText(value, maxLength) &&
    value.trim().length > 0
  );
}

// ==========================================
// ALLOWED FOLDERS
// ==========================================

const allowedFolders = new Set([
  "downloads",
  "documents",
  "desktop"
]);

// ==========================================
// ALLOWED WINDOWS APPLICATIONS
// ==========================================

const allowedWindowsApps = new Set([
  "notepad",
  "paint",
  "explorer",
  "windows explorer",
  "windows calculator"
]);

function normalizeWindowsApp(appName) {
  if (typeof appName !== "string") {
    return null;
  }

  const normalized = appName
    .trim()
    .toLowerCase();

  return allowedWindowsApps.has(normalized)
    ? normalized
    : null;
}

// ==========================================
// SAFE RESPONSE HELPERS
// ==========================================

function invalidTextResponse(message) {
  return Promise.resolve({
    type: "text",
    message
  });
}

function invalidFileResponse(message) {
  return Promise.resolve({
    error: message,
    files: []
  });
}

// ==========================================
// STREAMING REQUEST VALIDATION
// ==========================================

function isValidRequestId(requestId) {
  return (
    typeof requestId === "string" &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(requestId)
  );
}

// ==========================================
// STREAMING LISTENER MANAGEMENT
// ==========================================

const streamListeners = new Map();

function addStreamListener(callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  const listener = (_event, data) => {
    if (
      !data ||
      !isValidRequestId(data.requestId) ||
      typeof data.chunk !== "string"
    ) {
      return;
    }

    callback({
      requestId: data.requestId,
      chunk: data.chunk
    });
  };

  ipcRenderer.on(
    "ghost-ai-chunk",
    listener
  );

  const unsubscribe = () => {
    ipcRenderer.removeListener(
      "ghost-ai-chunk",
      listener
    );

    streamListeners.delete(unsubscribe);
  };

  streamListeners.set(
    unsubscribe,
    listener
  );

  return unsubscribe;
}

function removeAllStreamListeners() {
  for (const unsubscribe of Array.from(
    streamListeners.keys()
  )) {
    unsubscribe();
  }

  return true;
}

// ==========================================
// SECURE GHOSTOS API
// ==========================================

contextBridge.exposeInMainWorld("ghostAPI", {

  // ========================================
  // SYSTEM INFORMATION
  // ========================================

  getSystemInfo: () => {
    return ipcRenderer.invoke(
      "system-info"
    );
  },

  // ========================================
  // WINDOWS FILE PICKER
  // ========================================

  selectFile: () => {
    return ipcRenderer.invoke(
      "select-file"
    );
  },

  openFile: (filePath) => {
    if (!isValidNonEmptyText(filePath, 4096)) {
      return Promise.resolve(
        "Invalid file path"
      );
    }

    return ipcRenderer.invoke(
      "open-file",
      filePath
    );
  },

  // ========================================
  // SMART FILE MANAGER
  // ========================================

  listFiles: (folder) => {
    if (!isValidNonEmptyText(folder, 4096)) {
      return invalidFileResponse(
        "Invalid folder path"
      );
    }

    return ipcRenderer.invoke(
      "list-files",
      folder
    );
  },

  searchFiles: (folder, query) => {
    if (
      !isValidNonEmptyText(folder, 4096) ||
      !isValidText(query, 200)
    ) {
      return invalidFileResponse(
        "Invalid search request"
      );
    }

    return ipcRenderer.invoke(
      "search-files",
      folder,
      query
    );
  },

  getFileDetails: (filePath) => {
    if (!isValidNonEmptyText(filePath, 4096)) {
      return Promise.resolve({
        error: "Invalid file path"
      });
    }

    return ipcRenderer.invoke(
      "file-details",
      filePath
    );
  },

  openManagedFile: (filePath) => {
    if (!isValidNonEmptyText(filePath, 4096)) {
      return Promise.resolve(
        "Invalid file path"
      );
    }

    return ipcRenderer.invoke(
      "open-managed-file",
      filePath
    );
  },

  // ========================================
  // WINDOWS KNOWN FOLDERS
  // ========================================

  openKnownFolder: (folder) => {
    if (typeof folder !== "string") {
      return Promise.resolve(
        "Unsupported folder"
      );
    }

    const normalized = folder
      .trim()
      .toLowerCase();

    if (!allowedFolders.has(normalized)) {
      return Promise.resolve(
        "Unsupported folder"
      );
    }

    return ipcRenderer.invoke(
      "open-known-folder",
      normalized
    );
  },

  // ========================================
  // GHOST TERMINAL
  // ========================================

  runCommand: (command) => {
    if (!isValidText(command, 500)) {
      return Promise.resolve(
        "Invalid command"
      );
    }

    return ipcRenderer.invoke(
      "ghost-command",
      command
    );
  },

  // ========================================
  // GHOST BRAIN - STANDARD AI CHAT
  // ========================================

  // Backward compatible with Phase 9.1.

  askAI: (message) => {
    if (!isValidNonEmptyText(message, 4000)) {
      return invalidTextResponse(
        "Please enter a valid AI message."
      );
    }

    return ipcRenderer.invoke(
      "ghost-ai",
      message
    );
  },

  // ========================================
  // DIRECT OLLAMA AI
  // ========================================

  askOllama: (message) => {
    if (!isValidNonEmptyText(message, 4000)) {
      return invalidTextResponse(
        "Please enter a valid AI message."
      );
    }

    return ipcRenderer.invoke(
      "ollama-chat",
      message
    );
  },

  // ========================================
  // PHASE 9.2 - STREAMING AI CHAT
  // ========================================

  // Usage:
  //
  // const unsubscribe =
  //   window.ghostAPI.onAIChunk(data => {
  //     console.log(data.chunk);
  //   });
  //
  // const result =
  //   await window.ghostAPI.askAIStream(
  //     "Hello",
  //     "request_1"
  //   );
  //
  // unsubscribe();

  askAIStream: (message, requestId) => {
    if (!isValidNonEmptyText(message, 4000)) {
      return invalidTextResponse(
        "Please enter a valid AI message."
      );
    }

    if (!isValidRequestId(requestId)) {
      return invalidTextResponse(
        "Invalid AI request ID."
      );
    }

    return ipcRenderer.invoke(
      "ghost-ai-stream",
      message,
      requestId
    );
  },

  // ========================================
  // PHASE 9.2 - AI STREAM EVENTS
  // ========================================

  onAIChunk: (callback) => {
    return addStreamListener(callback);
  },

  removeAIChunkListeners: () => {
    return removeAllStreamListeners();
  },

  // ========================================
  // PHASE 9.2 - CANCEL AI REQUEST
  // ========================================

  cancelAI: (requestId) => {
    if (!isValidRequestId(requestId)) {
      return Promise.resolve(false);
    }

    return ipcRenderer.invoke(
      "ghost-ai-cancel",
      requestId
    );
  },

  // ========================================
  // OLLAMA CONNECTION STATUS
  // ========================================

  getOllamaStatus: () => {
    return ipcRenderer.invoke(
      "ollama-status"
    );
  },

  // ========================================
  // INSTALLED OLLAMA MODELS
  // ========================================

  getOllamaModels: () => {
    return ipcRenderer.invoke(
      "ollama-models"
    );
  },

  // ========================================
  // SMART COMMAND ENGINE
  // ========================================

  smartCommand: (message) => {
    if (!isValidNonEmptyText(message, 4000)) {
      return invalidTextResponse(
        "Please enter a valid command."
      );
    }

    return ipcRenderer.invoke(
      "smart-command",
      message
    );
  },

  // ========================================
  // WINDOWS APPLICATION LAUNCHER
  // ========================================

  launchWindowsApp: (appName) => {
    const normalized =
      normalizeWindowsApp(appName);

    if (!normalized) {
      return Promise.resolve(
        "Application is not approved."
      );
    }

    return ipcRenderer.invoke(
      "launch-windows-app",
      normalized
    );
  },

  // ========================================
  // COMMAND HISTORY
  // ========================================

  getCommandHistory: () => {
    return ipcRenderer.invoke(
      "get-command-history"
    );
  },

  clearCommandHistory: () => {
    return ipcRenderer.invoke(
      "clear-command-history"
    );
  },

  // ========================================
  // GHOST BRAIN STATUS
  // ========================================

  getBrainStatus: () => {
    return ipcRenderer.invoke(
      "brain-status"
    );
  },

  // ========================================
  // GHOST BRAIN MEMORY
  // ========================================

  clearBrainMemory: () => {
    return ipcRenderer.invoke(
      "brain-clear-memory"
    );
  },


  getBrainMemoryInfo: () => {
    return ipcRenderer.invoke(
      "brain-memory-info"
    );
  },

  // ========================================
  // PHASE 10 - GHOST AUTOPILOT
  // ========================================

  autopilotPlan: (command) => {
    if (!isValidNonEmptyText(command, 500)) {
      return Promise.reject(
        new Error("Invalid Autopilot command.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot-plan",
      command
    );
  },

  autopilotRun: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot-run",
      id
    );
  },

  autopilotApprove: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot-approve",
      id
    );
  },

  autopilotReject: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot-reject",
      id
    );
  },

  autopilotStatus: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot-status",
      id
    );
  },

  // ========================================
  // GHOST AUTOPILOT 2.0
  // INTELLIGENT FILE DISCOVERY
  // ========================================

  autopilot2Plan: (command) => {
    if (!isValidNonEmptyText(command, 500)) {
      return Promise.reject(
        new Error("Invalid Autopilot 2.0 command.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot2-plan",
      command
    );
  },

  autopilot2Run: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot2-run",
      id
    );
  },

  autopilot2Approve: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot2-approve",
      id
    );
  },

  autopilot2Reject: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot2-reject",
      id
    );
  },

  autopilot2Status: (id) => {
    if (!isValidNonEmptyText(id, 80)) {
      return Promise.reject(
        new Error("Invalid task ID.")
      );
    }

    return ipcRenderer.invoke(
      "autopilot2-status",
      id
    );
  }


});

// ==========================================
// GHOSTOS PHASE 9.2 - SECURITY
// ==========================================
//
// 1. Node integration disabled.
//
// 2. Context isolation enabled.
//
// 3. Only approved IPC methods exposed.
//
// 4. Ollama runs locally.
//
// 5. No Groq API key required.
//
// 6. No unrestricted shell execution.
//
// 7. File access validated by backend.
//
// 8. No file deletion or modification API.
//
// 9. Windows applications use allowlist.
//
// 10. Renderer cannot access Node.js.
//
// 11. Command history is session-based.
//
// 12. Backend validates IPC sender.
//
// 13. Ghost Brain memory is session-based.
//
// 14. Memory can be cleared.
//
// 15. AI streaming uses approved IPC.
//
// 16. AI cancellation uses request IDs.
//
// 17. Stream callbacks do not expose
//     Electron IPC event objects.
//
// 18. Local AI works offline once Ollama
//     and the model are installed.
//
// ==========================================
// END - GHOSTOS PHASE 9.2 PRELOAD
// ==========================================
