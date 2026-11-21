
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell
} = require("electron");

const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const { spawn } = require("child_process");

// ==========================================
// GHOSTOS PHASE 9.2
// GHOST BRAIN - SPEED OPTIMIZED
// ==========================================

let mainWindow = null;
let selectedFile = null;
let previousCpu = null;

const approvedFiles = new Set();
const commandHistory = [];
const conversationMemory = [];

const MAX_HISTORY = 100;
const MAX_MEMORY = 10;

const OLLAMA_URL = "http://127.0.0.1:11434";
const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || "llama3.2:1b";

let activeModel = OLLAMA_MODEL;
let cachedModels = null;
let modelCacheTime = 0;

const MODEL_CACHE_MS = 30000;
const AI_TIMEOUT_MS = 90000;

const AI_OPTIONS = {
  temperature: 0.4,
  num_predict: 120,
  num_ctx: 1024,
  num_thread: Math.max(
    1,
    Math.min(4, os.cpus().length)
  )
};

let currentAIController = null;
let currentAIRequestId = null;

// ==========================================
// MAIN WINDOW
// ==========================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#080c18",
    title: "GhostOS - Ghost Brain 9.2",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadFile(
    path.join(__dirname, "index.html")
  );

  mainWindow.on("closed", () => {
    if (currentAIController) {
      currentAIController.abort();
    }
    mainWindow = null;
  });
}

// ==========================================
// ACTIVITY HISTORY
// ==========================================

function recordActivity(source, command, result) {
  commandHistory.unshift({
    id:
      Date.now() + "-" +
      Math.random().toString(36).slice(2),
    source,
    command: String(command).slice(0, 500),
    result: String(result || "").slice(0, 500),
    timestamp: new Date().toISOString()
  });

  if (commandHistory.length > MAX_HISTORY) {
    commandHistory.length = MAX_HISTORY;
  }
}

function getCommandHistory() {
  return commandHistory.map(item => ({ ...item }));
}

function clearCommandHistory() {
  commandHistory.length = 0;
  return "Command history cleared.";
}

// ==========================================
// CONVERSATION MEMORY
// ==========================================

function rememberConversation(role, content) {
  conversationMemory.push({
    role,
    content: String(content).slice(0, 1500)
  });

  if (conversationMemory.length > MAX_MEMORY) {
    conversationMemory.splice(
      0,
      conversationMemory.length - MAX_MEMORY
    );
  }
}

function clearBrainMemory() {
  conversationMemory.length = 0;
  return "Ghost Brain memory cleared.";
}

// ==========================================
// OLLAMA CONNECTION
// ==========================================

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 5000
) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getOllamaModels(force = false) {
  if (
    !force &&
    cachedModels &&
    Date.now() - modelCacheTime < MODEL_CACHE_MS
  ) {
    return cachedModels;
  }

  try {
    const response = await fetchWithTimeout(
      OLLAMA_URL + "/api/tags",
      {},
      5000
    );

    if (!response.ok) {
      throw new Error(
        "Ollama HTTP " + response.status
      );
    }

    const data = await response.json();

    const result = {
      connected: true,
      models: (data.models || [])
        .map(model => model.name)
        .filter(Boolean)
    };

    cachedModels = result;
    modelCacheTime = Date.now();

    return result;
  } catch (error) {
    cachedModels = null;

    return {
      connected: false,
      models: [],
      error: error.message
    };
  }
}

async function resolveOllamaModel() {
  const status = await getOllamaModels();

  if (!status.connected) {
    return {
      error:
        "Ollama is not connected.\n" +
        "Please start Ollama and try again."
    };
  }

  if (!status.models.length) {
    return {
      error:
        "No AI model installed.\n" +
        "Run: ollama pull llama3.2:1b"
    };
  }

  if (status.models.includes(activeModel)) {
    return { model: activeModel };
  }

  activeModel = status.models[0];

  return { model: activeModel };
}

async function getBrainStatus() {
  const ollama = await getOllamaModels();

  return {
    name: "Ghost Brain",
    version: "9.2",
    engine: activeModel,
    connected:
      ollama.connected &&
      ollama.models.length > 0,
    provider: "Ollama Local AI",
    offline: true,
    models: ollama.models,
    memoryCount: conversationMemory.length,
    memoryLimit: MAX_MEMORY,
    systemAwareness: true,
    safeActions: true,
    streaming: true,
    optimized: true
  };
}

// ==========================================
// SYSTEM MONITOR
// ==========================================

function getCpuSnapshot() {
  return os.cpus().reduce(
    (result, cpu) => {
      const times = cpu.times;

      result.total += Object.values(times)
        .reduce((a, b) => a + b, 0);

      result.idle += times.idle;

      return result;
    },
    { total: 0, idle: 0 }
  );
}

function getSystemInfo() {
  const current = getCpuSnapshot();
  let cpuUsage = null;

  if (previousCpu) {
    const total =
      current.total - previousCpu.total;

    const idle =
      current.idle - previousCpu.idle;

    if (total > 0) {
      cpuUsage = Math.max(
        0,
        Math.min(100, (1 - idle / total) * 100)
      );
    }
  }

  previousCpu = current;

  return {
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model || "Unknown",
    cpuUsage:
      cpuUsage === null
        ? null
        : Number(cpuUsage.toFixed(1)),
    totalRAM:
      (os.totalmem() / 1073741824).toFixed(2),
    freeRAM:
      (os.freemem() / 1073741824).toFixed(2),
    hostname: os.hostname()
  };
}

async function getCpuUsage() {
  let info = getSystemInfo();

  if (info.cpuUsage === null) {
    await new Promise(resolve =>
      setTimeout(resolve, 500)
    );

    info = getSystemInfo();
  }

  return info.cpuUsage === null
    ? "CPU measurement initializing."
    : `CPU Usage: ${info.cpuUsage}%`;
}

// ==========================================
// INTERNAL APPLICATIONS
// ==========================================

const internalApps = {
  files: "files",
  "file explorer": "files",
  notes: "notes",
  note: "notes",
  calculator: "calc",
  calc: "calc",
  ai: "ai",
  "ghost ai": "ai",
  terminal: "terminal",
  monitor: "monitor",
  "system monitor": "monitor",
  system: "system",
  launcher: "launcher",
  "windows apps": "launcher"
};

// ==========================================
// WINDOWS APPLICATIONS
// ==========================================

const windowsApps = {
  notepad: "notepad.exe",
  paint: "mspaint.exe",
  explorer: "explorer.exe",
  "windows explorer": "explorer.exe",
  "windows calculator": "calc.exe"
};

function normalizeWindowsApp(name) {
  if (typeof name !== "string") return null;

  const key = name.trim().toLowerCase();

  return Object.prototype.hasOwnProperty.call(
    windowsApps,
    key
  ) ? key : null;
}

async function launchWindowsApp(name) {
  const key = normalizeWindowsApp(name);

  if (!key) {
    return "Application is not approved.";
  }

  if (process.platform !== "win32") {
    return "Windows app launching requires Windows.";
  }

  return new Promise(resolve => {
    let settled = false;

    const finish = message => {
      if (settled) return;
      settled = true;
      resolve(message);
    };

    try {
      const child = spawn(windowsApps[key], [], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        shell: false
      });

      child.once("spawn", () => {
        child.unref();
        finish(`Launched ${key}.`);
      });

      child.once("error", error => {
        finish(
          "Unable to launch: " + error.message
        );
      });
    } catch (error) {
      finish(
        "Launch failed: " + error.message
      );
    }
  });
}

// ==========================================
// APPROVED FOLDERS
// ==========================================

function getKnownFolders() {
  return {
    downloads: app.getPath("downloads"),
    documents: app.getPath("documents"),
    desktop: app.getPath("desktop")
  };
}

function normalizeFolderName(name) {
  if (typeof name !== "string") return null;

  const aliases = {
    download: "downloads",
    downloads: "downloads",
    document: "documents",
    documents: "documents",
    desktop: "desktop"
  };

  return aliases[
    name.trim().toLowerCase()
  ] || null;
}

async function openKnownFolder(folder) {
  const key = normalizeFolderName(folder);

  if (!key) return "Unknown folder.";

  const error = await shell.openPath(
    getKnownFolders()[key]
  );

  return error || `Opening ${key} folder...`;
}

// ==========================================
// SECURE FILE MANAGER
// ==========================================

function isInsideFolder(target, root) {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative)
    )
  );
}

async function resolveSafePath(input) {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 4096
  ) {
    throw new Error("Invalid folder path.");
  }

  const folders = getKnownFolders();
  const alias = normalizeFolderName(input);

  const requested = alias
    ? folders[alias]
    : path.resolve(input);

  const realTarget = await fs.realpath(requested);

  const roots = await Promise.all(
    Object.values(folders).map(folder =>
      fs.realpath(folder).catch(() => null)
    )
  );

  if (!roots.some(root =>
    root && isInsideFolder(realTarget, root)
  )) {
    throw new Error(
      "Access restricted to Downloads, " +
      "Documents and Desktop."
    );
  }

  return realTarget;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1048576) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1073741824) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

async function getFileDetails(filePath) {
  const safePath = await resolveSafePath(filePath);
  const stats = await fs.stat(safePath);

  return {
    name: path.basename(safePath),
    path: safePath,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    extension: stats.isDirectory()
      ? "Folder"
      : path.extname(safePath).toLowerCase() || "File",
    size: stats.size,
    formattedSize: stats.isDirectory()
      ? "Folder"
      : formatFileSize(stats.size),
    modified: stats.mtime.toLocaleString(),
    created: stats.birthtime.toLocaleString()
  };
}

async function listFiles(folderInput) {
  const safeFolder = await resolveSafePath(
    folderInput || "downloads"
  );

  const stats = await fs.stat(safeFolder);

  if (!stats.isDirectory()) {
    throw new Error(
      "Selected path is not a folder."
    );
  }

  const entries = await fs.readdir(
    safeFolder,
    { withFileTypes: true }
  );

  const files = [];

  for (const entry of entries.slice(0, 500)) {
    try {
      const details = await getFileDetails(
        path.join(safeFolder, entry.name)
      );

      if (
        details.isDirectory ||
        details.isFile
      ) {
        files.push(details);
      }
    } catch {
      // Skip inaccessible entries.
    }
  }

  files.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  approvedFiles.clear();

  for (const file of files) {
    approvedFiles.add(file.path);
  }

  return {
    folder: safeFolder,
    count: files.length,
    truncated: entries.length > 500,
    files
  };
}

async function searchFiles(folder, query) {
  if (
    typeof query !== "string" ||
    query.length > 200
  ) {
    throw new Error("Invalid search query.");
  }

  const result = await listFiles(folder);
  const term = query.trim().toLowerCase();

  if (!term) return result;

  const files = result.files.filter(file =>
    file.name.toLowerCase().includes(term) ||
    file.extension.toLowerCase().includes(term)
  );

  return {
    folder: result.folder,
    count: files.length,
    truncated: result.truncated,
    files
  };
}

// ==========================================
// SAFE FILE OPENING
// ==========================================

const blockedExtensions = new Set([
  ".exe", ".bat", ".cmd", ".com",
  ".ps1", ".vbs", ".js", ".jse",
  ".wsf", ".scr", ".msi", ".msp",
  ".lnk", ".url", ".hta", ".jar"
]);

async function safeOpenFile(filePath) {
  const stats = await fs.stat(filePath);

  if (!stats.isFile()) {
    return "Selected path is not a file.";
  }

  const extension =
    path.extname(filePath).toLowerCase();

  if (blockedExtensions.has(extension)) {
    return "Opening executable or script files is restricted.";
  }

  const error = await shell.openPath(filePath);

  return error || "File opened successfully.";
}

async function openManagedFile(filePath) {
  if (
    typeof filePath !== "string" ||
    !approvedFiles.has(filePath)
  ) {
    return "Please select a file from File Manager first.";
  }

  try {
    const safePath = await resolveSafePath(filePath);
    return await safeOpenFile(safePath);
  } catch (error) {
    return "Unable to open file: " + error.message;
  }
}

async function selectRealFile() {
  const result = await dialog.showOpenDialog(
    mainWindow,
    { properties: ["openFile"] }
  );

  if (result.canceled || !result.filePaths.length) {
    selectedFile = null;
    return null;
  }

  selectedFile = result.filePaths[0];
  return selectedFile;
}

async function openSelectedFile(filePath) {
  if (
    typeof filePath !== "string" ||
    !selectedFile ||
    filePath !== selectedFile
  ) {
    return "Please select a file first.";
  }

  try {
    return await safeOpenFile(selectedFile);
  } catch (error) {
    return error.message;
  }
}

// ==========================================
// GHOST TERMINAL
// ==========================================

async function runCommand(input) {
  if (
    typeof input !== "string" ||
    input.length > 500
  ) {
    return "Invalid command.";
  }

  const command = input.trim();
  const lower = command.toLowerCase();

  if (!command) return "";

  if (lower === "help") {
    return [
      "===== GHOSTOS PHASE 9.2 =====",
      "",
      "SYSTEM",
      "help              Show commands",
      "date              Current date",
      "time              Current time",
      "whoami            Username",
      "sysinfo           System information",
      "cpu               CPU usage",
      "ram               RAM usage",
      "status            GhostOS status",
      "clear             Clear terminal",
      "echo TEXT         Display text",
      "",
      "GHOST BRAIN",
      "brain             AI status",
      "brain models      Installed models",
      "brain memory      Memory information",
      "brain clear       Clear AI memory",
      "brain speed       Speed settings",
      "",
      "APPLICATIONS",
      "open notes",
      "open calculator",
      "open terminal",
      "open monitor",
      "open files",
      "open ai",
      "open system",
      "open launcher",
      "",
      "WINDOWS APPS",
      "open notepad",
      "open paint",
      "open explorer",
      "open windows calculator",
      "",
      "FOLDERS",
      "open downloads",
      "open documents",
      "open desktop",
      "",
      "FILE MANAGER",
      "files downloads",
      "files documents",
      "files desktop",
      "search downloads pdf",
      "search documents report",
      "",
      "HISTORY",
      "history",
      "history clear",
      "",
      "AI: Ollama local",
      "Model: " + activeModel,
      "Phase 9.2 optimization enabled."
    ].join("\n");
  }

  if (lower === "clear") return "__CLEAR__";

  if (lower === "date") {
    return new Date().toLocaleString();
  }

  if (lower === "time") {
    return new Date().toLocaleTimeString();
  }

  if (lower === "whoami") {
    return os.userInfo().username;
  }

  if (lower === "brain") {
    const status = await getBrainStatus();

    return [
      "===== GHOST BRAIN =====",
      "Version: " + status.version,
      "Provider: " + status.provider,
      "Engine: " + status.engine,
      "Connection: " +
        (status.connected ? "Ready" : "Unavailable"),
      "Memory messages: " + status.memoryCount,
      "Offline mode: Enabled",
      "Streaming backend: Enabled",
      "Speed optimization: Enabled"
    ].join("\n");
  }

  if (lower === "brain models") {
    const result = await getOllamaModels();

    if (!result.connected) {
      return "Ollama is not connected.";
    }

    return result.models.length
      ? "Installed models:\n" +
        result.models.join("\n")
      : "No Ollama models installed.";
  }

  if (lower === "brain memory") {
    return (
      `Ghost Brain remembers ${conversationMemory.length} ` +
      "recent messages in this session."
    );
  }

  if (lower === "brain clear") {
    return clearBrainMemory();
  }

  if (lower === "brain speed") {
    return [
      "===== AI SPEED SETTINGS =====",
      "Model: " + activeModel,
      "Max tokens: " + AI_OPTIONS.num_predict,
      "Context: " + AI_OPTIONS.num_ctx,
      "Threads: " + AI_OPTIONS.num_thread,
      "Model keep-alive: 10 minutes",
      "Streaming backend: Available",
      "Status: Optimized for 8 GB RAM"
    ].join("\n");
  }

  if (lower === "sysinfo") {
    const info = getSystemInfo();

    return [
      "===== GhostOS System =====",
      `Platform: ${info.platform}`,
      `Architecture: ${info.architecture}`,
      `CPU: ${info.cpu}`,
      `Total RAM: ${info.totalRAM} GB`,
      `Free RAM: ${info.freeRAM} GB`,
      `Hostname: ${info.hostname}`
    ].join("\n");
  }

  if (lower === "cpu") {
    return await getCpuUsage();
  }

  if (lower === "ram") {
    const info = getSystemInfo();

    const used =
      Number(info.totalRAM) -
      Number(info.freeRAM);

    return (
      `RAM: ${used.toFixed(2)} GB used / ` +
      `${info.totalRAM} GB total`
    );
  }

  if (lower === "status") {
    const brain = await getBrainStatus();

    return [
      "GhostOS Phase 9.2",
      "Backend: Active",
      "Ghost Brain: " +
        (brain.connected ? "Ready" : "Unavailable"),
      "AI Provider: Ollama",
      "Model: " + brain.engine,
      "Platform: " + os.platform(),
      "File manager: Enabled",
      "Smart commands: Enabled",
      "Windows launcher: Enabled",
      "Command history: Enabled",
      "Conversation memory: Enabled",
      "AI optimization: Enabled"
    ].join("\n");
  }

  if (lower === "history") {
    if (!commandHistory.length) {
      return "No command history available.";
    }

    return commandHistory
      .slice(0, 20)
      .map((item, index) =>
        `${index + 1}. [${item.source}] ${item.command}`
      )
      .join("\n");
  }

  if (lower === "history clear") {
    return clearCommandHistory();
  }

  if (lower === "echo" || lower.startsWith("echo ")) {
    return command.slice(4).trim();
  }

  if (lower.startsWith("open ")) {
    const target = lower.slice(5).trim();

    if (normalizeWindowsApp(target)) {
      return await launchWindowsApp(target);
    }

    if (internalApps[target]) {
      return {
        type: "open-app",
        app: internalApps[target],
        message: `Opening ${target}...`
      };
    }

    if (normalizeFolderName(target)) {
      return await openKnownFolder(target);
    }

    return `Unknown application: ${target}`;
  }

  if (lower.startsWith("files ")) {
    const folder = normalizeFolderName(
      lower.slice(6).trim()
    );

    if (!folder) {
      return "Use files downloads, documents or desktop.";
    }

    return {
      type: "browse-files",
      folder,
      message: `Browsing ${folder}...`
    };
  }

  if (lower.startsWith("search ")) {
    const match = command.match(
      /^search\s+(downloads?|documents?|desktop)\s+(.+)$/i
    );

    if (!match) {
      return "Example: search downloads pdf";
    }

    return {
      type: "search-files",
      folder: normalizeFolderName(match[1]),
      query: match[2].trim(),
      message: `Searching for ${match[2].trim()}...`
    };
  }

  return (
    `Command not found: ${command}\n` +
    "Type 'help' for commands."
  );
}

// ==========================================
// SMART DESKTOP ACTION DETECTION
// ==========================================

function detectDesktopAction(message) {
  if (typeof message !== "string") return null;

  const text = message.toLowerCase().trim();

  if (
    /^(help|date|time|whoami|sysinfo|cpu|ram|status|history|history clear|brain|brain clear|brain memory|brain models|brain speed)$/.test(text) ||
    /^(open|files|search|echo)\s+/.test(text)
  ) {
    return text;
  }

  const folderMatch = text.match(
    /\b(downloads?|documents?|desktop)\b/
  );

  const folder = folderMatch
    ? normalizeFolderName(folderMatch[1])
    : null;

  if (
    folder &&
    /\b(find|search|look for)\b/.test(text)
  ) {
    const query = text
      .replace(/\b(find|search|look for)\b/g, "")
      .replace(/\b(in|inside|from|my|the|folder)\b/g, "")
      .replace(/\b(downloads?|documents?|desktop)\b/g, "")
      .replace(/\b(files?|for)\b/g, "")
      .trim();

    return {
      type: "search-files",
      folder,
      query,
      message: `Searching ${folder}...`
    };
  }

  if (
    folder &&
    /\b(browse|list|show files|view files)\b/.test(text)
  ) {
    return {
      type: "browse-files",
      folder,
      message: `Browsing ${folder}...`
    };
  }

  const patterns = [
    [/\b(open|launch|start)\b.*\bnotepad\b/, "open notepad"],
    [/\b(open|launch|start)\b.*\bpaint\b/, "open paint"],
    [/\b(open|launch|start)\b.*\b(windows explorer|explorer)\b/, "open explorer"],
    [/\b(open|launch|start)\b.*\bwindows calculator\b/, "open windows calculator"],
    [/\b(open|launch|show)\b.*\bdownloads?\b/, "open downloads"],
    [/\b(open|launch|show)\b.*\bdocuments?\b/, "open documents"],
    [/\b(open|launch|show)\b.*\bdesktop\b/, "open desktop"],
    [/\b(open|launch)\b.*\bnotes?\b/, "open notes"],
    [/\b(open|launch)\b.*\bcalculator\b/, "open calculator"],
    [/\b(open|launch)\b.*\bterminal\b/, "open terminal"],
    [/\b(open|launch)\b.*\bmonitor\b/, "open monitor"],
    [/\b(open|launch)\b.*\bfiles?\b/, "open files"],
    [/\b(open|launch)\b.*\b(ghost ai|ai)\b/, "open ai"],
    [/\b(open|launch)\b.*\b(system info|system information)\b/, "open system"],
    [/\b(open|launch)\b.*\blauncher\b/, "open launcher"],
    [/\b(show|check|display)\b.*\bcpu\b/, "cpu"],
    [/\b(show|check|display)\b.*\bram\b/, "ram"],
    [/\b(show|check|display)\b.*\b(command history|recent commands)\b/, "history"]
  ];

  for (const [pattern, command] of patterns) {
    if (pattern.test(text)) return command;
  }

  return null;
}

// ==========================================
// PHASE 9.2 - SHORT SYSTEM PROMPT
// ==========================================

function buildBrainPrompt() {
  return [
    "You are Ghost Brain, the local AI inside GhostOS.",
    "Be helpful, accurate and concise.",
    "Understand English, Hindi and Hinglish.",
    "Prefer short answers unless details are requested.",
    "Never claim to execute actions unless confirmed.",
    "Never request passwords.",
    "Do not invent system information.",
    "Respond in the user's language."
  ].join("\n");
}

// ==========================================
// PHASE 9.2 - OLLAMA AI ENGINE
// ==========================================

async function askOllamaAI(
  message,
  onChunk = null,
  requestId = null
) {
  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 4000
  ) {
    return {
      type: "text",
      message: "Please enter a valid message."
    };
  }

  const resolved = await resolveOllamaModel();

  if (resolved.error) {
    return {
      type: "text",
      message: resolved.error
    };
  }

  if (currentAIController) {
    return {
      type: "text",
      message:
        "Ghost Brain is processing another request. " +
        "Please wait or cancel it."
    };
  }

  const controller = new AbortController();

  currentAIController = controller;
  currentAIRequestId = requestId;

  const timeout = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);

  let fullAnswer = "";

  try {
    const messages = [
      {
        role: "system",
        content: buildBrainPrompt()
      },
      ...conversationMemory.slice(-6),
      {
        role: "user",
        content: message
      }
    ];

    const response = await fetch(
      OLLAMA_URL + "/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: resolved.model,
          messages,
          stream: true,
          options: AI_OPTIONS,
          keep_alive: "10m"
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Ollama HTTP ${response.status}: ` +
        errorText.slice(0, 300)
      );
    }

    if (!response.body) {
      throw new Error("No AI response stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();

      if (done) {
        finished = true;
      } else {
        buffer += decoder.decode(value, {
          stream: true
        });
      }

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      if (finished && buffer.trim()) {
        lines.push(buffer);
        buffer = "";
      }

      for (const line of lines) {
        if (!line.trim()) continue;

        let data;

        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        if (data.error) {
          throw new Error(data.error);
        }

        const chunk = data.message?.content || "";

        if (chunk) {
          fullAnswer += chunk;

          if (typeof onChunk === "function") {
            onChunk(chunk);
          }
        }

        if (data.done) {
          finished = true;
          break;
        }
      }
    }

    if (!fullAnswer.trim()) {
      return {
        type: "text",
        message:
          "Ghost Brain received an empty response."
      };
    }

    rememberConversation("user", message);
    rememberConversation("assistant", fullAnswer);

    return {
      type: "text",
      message: fullAnswer
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        type: "text",
        message:
          fullAnswer ||
          "Ghost Brain stopped or timed out. " +
          "Try a shorter question."
      };
    }

    return {
      type: "text",
      message:
        "Local AI error: " + error.message
    };
  } finally {
    clearTimeout(timeout);

    if (currentAIController === controller) {
      currentAIController = null;
      currentAIRequestId = null;
    }
  }
}

// ==========================================
// GHOST BRAIN ACTION HANDLER
// ==========================================

async function handleGhostAI(
  message,
  onChunk = null,
  requestId = null
) {
  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 4000
  ) {
    return {
      type: "text",
      message: "Please enter a valid message."
    };
  }

  const action = detectDesktopAction(message);

  if (action) {
    const result = typeof action === "object"
      ? action
      : await runCommand(action);

    const response =
      result && typeof result === "object"
        ? result
        : {
            type: "text",
            message: String(result)
          };

    recordActivity(
      "Ghost Brain",
      message,
      response.message || "Desktop action"
    );

    return response;
  }

  return await askOllamaAI(
    message,
    onChunk,
    requestId
  );
}

// ==========================================
// SECURE IPC
// ==========================================

function isTrustedSender(event) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame ===
      mainWindow.webContents.mainFrame
  );
}

function secureHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      throw new Error("Unauthorized IPC request.");
    }

    return await handler(...args);
  });
}

function sendAIChunk(requestId, chunk) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  mainWindow.webContents.send(
    "ghost-ai-chunk",
    {
      requestId,
      chunk
    }
  );
}

// ==========================================
// ELECTRON IPC HANDLERS
// ==========================================

app.whenReady().then(() => {

  secureHandle("system-info", () => {
    return getSystemInfo();
  });

  secureHandle("select-file", async () => {
    return await selectRealFile();
  });

  secureHandle("open-file", async filePath => {
    return await openSelectedFile(filePath);
  });

  secureHandle("list-files", async folder => {
    try {
      return await listFiles(folder);
    } catch (error) {
      return {
        error: error.message,
        files: []
      };
    }
  });

  secureHandle(
    "search-files",
    async (folder, query) => {
      try {
        return await searchFiles(folder, query);
      } catch (error) {
        return {
          error: error.message,
          files: []
        };
      }
    }
  );

  secureHandle("file-details", async filePath => {
    try {
      if (!approvedFiles.has(filePath)) {
        throw new Error(
          "Select a file from File Manager first."
        );
      }

      return await getFileDetails(filePath);
    } catch (error) {
      return { error: error.message };
    }
  });

  secureHandle(
    "open-managed-file",
    async filePath => {
      return await openManagedFile(filePath);
    }
  );

  secureHandle(
    "open-known-folder",
    async folder => {
      try {
        return await openKnownFolder(folder);
      } catch (error) {
        return error.message;
      }
    }
  );

  secureHandle(
    "ghost-command",
    async command => {
      try {
        const result = await runCommand(command);

        if (
          typeof command === "string" &&
          command.trim() &&
          ![
            "history",
            "history clear",
            "clear"
          ].includes(command.trim().toLowerCase())
        ) {
          recordActivity(
            "Terminal",
            command,
            typeof result === "object"
              ? result.message
              : result
          );
        }

        return result;
      } catch (error) {
        return (
          "Command error: " + error.message
        );
      }
    }
  );

  secureHandle("ghost-ai", async message => {
    try {
      return await handleGhostAI(message);
    } catch (error) {
      return {
        type: "text",
        message:
          "Ghost Brain error: " + error.message
      };
    }
  });

  secureHandle(
    "smart-command",
    async message => {
      try {
        return await handleGhostAI(message);
      } catch (error) {
        return {
          type: "text",
          message:
            "Smart command error: " + error.message
        };
      }
    }
  );

  secureHandle(
    "launch-windows-app",
    async appName => {
      try {
        const result =
          await launchWindowsApp(appName);

        recordActivity(
          "Launcher",
          "open " + String(appName),
          result
        );

        return result;
      } catch (error) {
        return (
          "Launch error: " + error.message
        );
      }
    }
  );

  secureHandle(
    "get-command-history",
    () => getCommandHistory()
  );

  secureHandle(
    "clear-command-history",
    () => clearCommandHistory()
  );

  secureHandle(
    "brain-status",
    async () => await getBrainStatus()
  );

  secureHandle(
    "brain-clear-memory",
    () => clearBrainMemory()
  );

  secureHandle(
    "brain-memory-info",
    () => ({
      count: conversationMemory.length,
      limit: MAX_MEMORY,
      persistent: false
    })
  );

  secureHandle(
    "ollama-status",
    async () => await getOllamaModels()
  );

  secureHandle(
    "ollama-models",
    async () => await getOllamaModels()
  );

  secureHandle(
    "ollama-chat",
    async message => {
      return await askOllamaAI(message);
    }
  );

  // ========================================
  // PHASE 9.2 - STREAMING IPC
  // ========================================

  secureHandle(
    "ghost-ai-stream",
    async (message, requestId) => {
      if (
        typeof requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)
      ) {
        return {
          type: "text",
          message: "Invalid request ID."
        };
      }

      return await handleGhostAI(
        message,
        chunk => sendAIChunk(requestId, chunk),
        requestId
      );
    }
  );

  secureHandle(
    "ghost-ai-cancel",
    async requestId => {
      if (
        typeof requestId !== "string" ||
        requestId !== currentAIRequestId ||
        !currentAIController
      ) {
        return false;
      }

      currentAIController.abort();
      return true;
    }
  );

  createWindow();

  app.on("activate", () => {
    if (
      BrowserWindow.getAllWindows().length === 0
    ) {
      createWindow();
    }
  });
});

// ==========================================
// APPLICATION LIFECYCLE
// ==========================================

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

 // ==========================================
 // GHOSTOS PHASE 10 - GHOST AUTOPILOT
 // SAFE MULTI-STEP DESKTOP AUTOMATION
 // ==========================================

 const autopilotSessions = new Map();
 const AUTOPILOT_LIMIT = 20;

 function autopilotPlan(command) {
   if (
     typeof command !== "string" ||
     !command.trim() ||
     command.length > 500
   ) {
     throw new Error("Enter a valid task.");
   }

   const text = command.toLowerCase();
   const folderMatch = text.match(
     /\b(downloads?|documents?|desktop)\b/
   );

   const folder = folderMatch
     ? normalizeFolderName(folderMatch[1])
     : "downloads";

   const extensionMatch = text.match(
     /\b(pdf|docx?|xlsx?|pptx?|txt|png|jpe?g)\b/
   );

   const extension = extensionMatch
     ? "." + extensionMatch[1].replace(/^jpg$/, "jpg")
     : null;

   const latest = /\b(latest|newest|recent)\b/.test(text);

   const wantsOpen =
     /\b(open|launch|start)\b/.test(text);

   const wantsFind =
     /\b(find|search|locate|show|list|latest|newest)\b/
       .test(text);

   if (!wantsFind && !wantsOpen) {
     throw new Error(
       "Try: Find my latest PDF in Downloads"
     );
   }

   const steps = [
     {
       id: "scan",
       title: "Scan " + folder,
       status: "pending"
     },
     {
       id: "filter",
       title: extension
         ? "Find " + extension + " files"
         : "Identify matching files",
       status: "pending"
     },
     {
       id: "select",
       title: latest
         ? "Select most recently modified file"
         : "Select matching file",
       status: "pending"
     }
   ];

   if (wantsOpen) {
     steps.push({
       id: "open",
       title: "Open file after approval",
       status: "pending"
     });
   }

   return {
     folder,
     extension,
     latest,
     wantsOpen,
     steps
   };
 }

 function autopilotPublic(session) {
   return {
     id: session.id,
     command: session.command,
     status: session.status,
     steps: session.steps.map(step => ({ ...step })),
     files: session.files.map(file => ({
       name: file.name,
       path: file.path,
       extension: file.extension,
       modified: file.modified
     })),
     selectedFile: session.selectedFile
       ? {
           name: session.selectedFile.name,
           path: session.selectedFile.path
         }
       : null,
     message: session.message
   };
 }

 function autopilotUpdate(session, id, status) {
   const step = session.steps.find(
     item => item.id === id
   );

   if (step) step.status = status;
 }

 async function autopilotExecute(session) {
   session.status = "running";

   try {
     autopilotUpdate(session, "scan", "running");

     const result = await listFiles(session.folder);

     if (result.error) {
       throw new Error(result.error);
     }

     autopilotUpdate(session, "scan", "done");
     autopilotUpdate(session, "filter", "running");

     let files = result.files.filter(
       file => file.isFile
     );

     if (session.extension) {
       files = files.filter(file =>
         file.extension === session.extension
       );
     }

     autopilotUpdate(session, "filter", "done");
     autopilotUpdate(session, "select", "running");

     files.sort((a, b) =>
       new Date(b.modified) - new Date(a.modified)
     );

     session.files = files.slice(0, 20);
     session.selectedFile = files[0] || null;

     autopilotUpdate(session, "select", "done");

     if (!session.selectedFile) {
       session.status = "completed";
       session.message = "No matching files found.";
     } else if (session.wantsOpen) {
       session.status = "awaiting_approval";
       session.message =
         "Approval required to open: " +
         session.selectedFile.name;
     } else {
       session.status = "completed";
       session.message =
         "Found " + files.length +
         " matching files. Best match: " +
         session.selectedFile.name;
     }

     recordActivity(
       "Autopilot",
       session.command,
       session.message
     );

   } catch (error) {
     session.status = "failed";
     session.message = error.message;
   }

   return autopilotPublic(session);
 }

 function autopilotCreate(command) {
   const plan = autopilotPlan(command);

   const id =
     Date.now().toString(36) +
     Math.random().toString(36).slice(2, 9);

   const session = {
     id,
     command,
     ...plan,
     status: "planned",
     files: [],
     selectedFile: null,
     message: "Plan ready for execution."
   };

   autopilotSessions.set(id, session);

   if (autopilotSessions.size > AUTOPILOT_LIMIT) {
     const oldest = autopilotSessions.keys().next().value;
     autopilotSessions.delete(oldest);
   }

   return autopilotPublic(session);
 }

 async function autopilotApprove(id) {
   const session = autopilotSessions.get(id);

   if (!session) {
     throw new Error("Autopilot task not found.");
   }

   if (
     session.status !== "awaiting_approval" ||
     !session.selectedFile
   ) {
     throw new Error("No action awaiting approval.");
   }

   const filePath = session.selectedFile.path;
   const safePath = await resolveSafePath(filePath);

   if (safePath !== filePath) {
     throw new Error("File path changed.");
   }

   const result = await safeOpenFile(safePath);

   if (result !== "File opened successfully.") {
     session.status = "failed";
     session.message = result;
     autopilotUpdate(session, "open", "failed");
   } else {
     session.status = "completed";
     session.message = result;
     autopilotUpdate(session, "open", "done");
   }

   recordActivity(
     "Autopilot",
     "Approve: " + session.command,
     session.message
   );

   return autopilotPublic(session);
 }

 // Register new IPC channels after Electron is ready.
 app.whenReady().then(() => {

   secureHandle("autopilot-plan", command => {
     return autopilotCreate(command);
   });

   secureHandle("autopilot-run", async id => {
     const session = autopilotSessions.get(id);

     if (!session) {
       throw new Error("Task not found.");
     }

     if (session.status !== "planned") {
       throw new Error("Task already started.");
     }

     return await autopilotExecute(session);
   });

   secureHandle("autopilot-approve", async id => {
     return await autopilotApprove(id);
   });

   secureHandle("autopilot-reject", id => {
     const session = autopilotSessions.get(id);

     if (!session) {
       throw new Error("Task not found.");
     }

     if (session.status !== "awaiting_approval") {
       throw new Error("Nothing to reject.");
     }

     session.status = "cancelled";
     session.message = "Action cancelled by user.";
     autopilotUpdate(session, "open", "cancelled");

     return autopilotPublic(session);
   });

   secureHandle("autopilot-status", id => {
     const session = autopilotSessions.get(id);

     if (!session) {
       throw new Error("Task not found.");
     }

     return autopilotPublic(session);
   });

 });

 // ==========================================
 // END - GHOST AUTOPILOT PHASE 10
 // ==========================================

// ==========================================
// END - GHOSTOS PHASE 9.2
// ==========================================

// ==========================================
// GHOSTOS - AUTOPILOT 2.0
// INTELLIGENT FILE DISCOVERY ENGINE
// ==========================================

// Paste this at the END of existing main.js.
// Existing features remain unchanged.

const ghostAuto2Sessions = new Map();

const GHOST_AUTO2_MAX_FILES = 1500;
const GHOST_AUTO2_MAX_DEPTH = 3;
const GHOST_AUTO2_MAX_RESULTS = 20;

const ghostAuto2StopWords = new Set([
  "find", "search", "locate", "show",
  "open", "my", "me", "the", "a",
  "an", "in", "from", "inside", "of",
  "file", "files", "folder", "folders",
  "latest", "newest", "recent", "most",
  "updated", "please", "and", "for",
  "downloads", "documents", "desktop"
]);

function ghostAuto2Parse(command) {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > 500
  ) {
    throw new Error("Invalid Autopilot task.");
  }

  const text = command.toLowerCase();

  const folders = [];

  for (const folder of [
    "downloads",
    "documents",
    "desktop"
  ]) {
    if (text.includes(folder)) {
      folders.push(folder);
    }
  }

  if (!folders.length) {
    folders.push(
      "downloads",
      "documents",
      "desktop"
    );
  }

  const extensions = [
    "pdf", "docx", "doc",
    "xlsx", "xls", "pptx",
    "ppt", "txt", "csv"
  ];

  const requestedExtensions = extensions.filter(
    ext => new RegExp(
      "\\b" + ext + "\\b", "i"
    ).test(text)
  );

  const keywords = text
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(word =>
      word.length > 1 &&
      !ghostAuto2StopWords.has(word) &&
      !extensions.includes(word)
    );

  return {
    folders,
    keywords,
    extensions: requestedExtensions,
    latest: /\b(latest|newest|recent|updated)\b/i
      .test(text),
    wantsOpen: /\bopen\b/i.test(text)
  };
}

async function ghostAuto2ScanFolder(
  folderPath,
  depth,
  state
) {
  if (
    depth > GHOST_AUTO2_MAX_DEPTH ||
    state.scanned >= GHOST_AUTO2_MAX_FILES
  ) {
    return;
  }

  let entries;

  try {
    entries = await fs.readdir(folderPath, {
      withFileTypes: true
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (state.scanned >= GHOST_AUTO2_MAX_FILES) {
      state.truncated = true;
      break;
    }

    if (entry.isSymbolicLink()) continue;

    const fullPath = path.join(
      folderPath,
      entry.name
    );

    if (entry.isDirectory()) {
      if (
        !entry.name.startsWith(".") &&
        depth < GHOST_AUTO2_MAX_DEPTH
      ) {
        await ghostAuto2ScanFolder(
          fullPath,
          depth + 1,
          state
        );
      }

      continue;
    }

    if (!entry.isFile()) continue;

    state.scanned++;

    try {
      const safePath = await resolveSafePath(
        fullPath
      );

      const stat = await fs.stat(safePath);

      if (!stat.isFile()) continue;

      state.files.push({
        name: entry.name,
        path: safePath,
        extension: path.extname(
          entry.name
        ).toLowerCase(),
        size: stat.size,
        modifiedMs: stat.mtimeMs,
        modified: stat.mtime.toLocaleString()
      });
    } catch {
      // Ignore inaccessible files.
    }
  }
}

function ghostAuto2Rank(file, plan) {
  const name = file.name.toLowerCase();
  const base = path.parse(name).name;

  let score = 0;
  const reasons = [];

  let keywordMatches = 0;

  for (const keyword of plan.keywords) {
    if (base === keyword) {
      score += 100;
      keywordMatches++;
      reasons.push(
        "Exact filename match: " + keyword
      );
    } else if (base.includes(keyword)) {
      score += 60;
      keywordMatches++;
      reasons.push(
        "Filename matches: " + keyword
      );
    } else if (
      file.path.toLowerCase().includes(keyword)
    ) {
      score += 10;
      keywordMatches++;
      reasons.push(
        "Folder path matches: " + keyword
      );
    }
  }

  if (
    plan.keywords.length &&
    keywordMatches === 0
  ) {
    return null;
  }

  if (
    plan.extensions.length &&
    !plan.extensions.some(
      ext => file.extension === "." + ext
    )
  ) {
    return null;
  }

  if (plan.extensions.length) {
    score += 30;
    reasons.push("Requested file type");
  }

  const ageDays = Math.max(
    0,
    (Date.now() - file.modifiedMs) /
      86400000
  );

  const recencyScore = Math.max(
    0,
    30 - Math.min(30, ageDays)
  );

  score += plan.latest
    ? recencyScore * 2
    : recencyScore * 0.3;

  reasons.push(
    "Modified: " + file.modified
  );

  return {
    ...file,
    score: Math.round(score),
    reasons
  };
}

function ghostAuto2Public(session) {
  return {
    id: session.id,
    command: session.command,
    status: session.status,
    message: session.message,
    scanned: session.scanned,
    truncated: session.truncated,
    steps: session.steps.map(
      step => ({ ...step })
    ),
    files: session.files.map(file => ({
      ...file
    })),
    selectedFile: session.selectedFile
      ? { ...session.selectedFile }
      : null
  };
}

function ghostAuto2Update(
  session,
  stepId,
  status
) {
  const step = session.steps.find(
    step => step.id === stepId
  );

  if (step) step.status = status;
}

function ghostAuto2Create(command) {
  const plan = ghostAuto2Parse(command);

  const id =
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10);

  const session = {
    id,
    command,
    plan,
    status: "planned",
    message: "Autopilot 2.0 plan ready.",
    scanned: 0,
    truncated: false,
    files: [],
    selectedFile: null,
    steps: [
      {
        id: "scan",
        title: "Scan approved folders",
        status: "pending"
      },
      {
        id: "rank",
        title: "Analyze filename relevance",
        status: "pending"
      },
      {
        id: "select",
        title: "Select best matching file",
        status: "pending"
      },
      {
        id: "open",
        title: "Open after approval",
        status: "pending"
      }
    ]
  };

  ghostAuto2Sessions.set(id, session);

  if (ghostAuto2Sessions.size > 20) {
    const oldest =
      ghostAuto2Sessions.keys().next().value;

    ghostAuto2Sessions.delete(oldest);
  }

  return ghostAuto2Public(session);
}

async function ghostAuto2Execute(id) {
  const session = ghostAuto2Sessions.get(id);

  if (!session) {
    throw new Error("Autopilot task not found.");
  }

  if (session.status !== "planned") {
    throw new Error("Task already executed.");
  }

  session.status = "running";

  try {
    ghostAuto2Update(
      session, "scan", "running"
    );

    const state = {
      files: [],
      scanned: 0,
      truncated: false
    };

    const knownFolders = getKnownFolders();

    for (const folder of session.plan.folders) {
      const root = knownFolders[folder];

      await ghostAuto2ScanFolder(
        root,
        0,
        state
      );
    }

    session.scanned = state.scanned;
    session.truncated = state.truncated;

    ghostAuto2Update(
      session, "scan", "done"
    );

    ghostAuto2Update(
      session, "rank", "running"
    );

    const ranked = state.files
      .map(file =>
        ghostAuto2Rank(file, session.plan)
      )
      .filter(Boolean);

    ranked.sort((a, b) => {
      if (session.plan.latest) {
        return (
          b.score - a.score ||
          b.modifiedMs - a.modifiedMs
        );
      }

      return (
        b.score - a.score ||
        b.modifiedMs - a.modifiedMs
      );
    });

    session.files = ranked.slice(
      0,
      GHOST_AUTO2_MAX_RESULTS
    );

    ghostAuto2Update(
      session, "rank", "done"
    );

    ghostAuto2Update(
      session, "select", "running"
    );

    session.selectedFile =
      session.files[0] || null;

    ghostAuto2Update(
      session, "select", "done"
    );

    if (!session.selectedFile) {
      session.status = "completed";
      session.message =
        "No matching files found.";
    } else if (session.plan.wantsOpen) {
      session.status = "awaiting_approval";

      session.message =
        "Best match: " +
        session.selectedFile.name +
        ". Approval required to open.";
    } else {
      session.status = "completed";

      session.message =
        "Found " + ranked.length +
        " matching files. Best match: " +
        session.selectedFile.name;
    }

    recordActivity(
      "Autopilot 2.0",
      session.command,
      session.message
    );

  } catch (error) {
    session.status = "failed";
    session.message = error.message;
  }

  return ghostAuto2Public(session);
}

async function ghostAuto2Approve(id) {
  const session = ghostAuto2Sessions.get(id);

  if (
    !session ||
    session.status !== "awaiting_approval" ||
    !session.selectedFile
  ) {
    throw new Error(
      "No file awaiting approval."
    );
  }

  const safePath = await resolveSafePath(
    session.selectedFile.path
  );

  ghostAuto2Update(
    session, "open", "running"
  );

  const result = await safeOpenFile(safePath);

  if (result === "File opened successfully.") {
    session.status = "completed";
    ghostAuto2Update(
      session, "open", "done"
    );
  } else {
    session.status = "failed";
    ghostAuto2Update(
      session, "open", "failed"
    );
  }

  session.message = result;

  return ghostAuto2Public(session);
}

// ==========================================
// AUTOPILOT 2.0 IPC CHANNELS
// ==========================================

app.whenReady().then(() => {

  secureHandle(
    "autopilot2-plan",
    command => ghostAuto2Create(command)
  );

  secureHandle(
    "autopilot2-run",
    id => ghostAuto2Execute(id)
  );

  secureHandle(
    "autopilot2-approve",
    id => ghostAuto2Approve(id)
  );

  secureHandle(
    "autopilot2-reject",
    id => {
      const session =
        ghostAuto2Sessions.get(id);

      if (
        !session ||
        session.status !== "awaiting_approval"
      ) {
        throw new Error(
          "Nothing awaiting approval."
        );
      }

      session.status = "cancelled";
      session.message =
        "Action rejected by user.";

      ghostAuto2Update(
        session, "open", "cancelled"
      );

      return ghostAuto2Public(session);
    }
  );

  secureHandle(
    "autopilot2-status",
    id => {
      const session =
        ghostAuto2Sessions.get(id);

      if (!session) {
        throw new Error("Task not found.");
      }

      return ghostAuto2Public(session);
    }
  );

});


// END - GHOST AUTOPILOT 2.0
// ==========================================
