"use strict";

// DeepSeek Harness monitor — outbound WebSocket integration.
//
// DeepSeek Harness (desktop shell for the dsh runtime) serves a local web
// server on 127.0.0.1:3080 (random port fallback, no port file). Two
// downlink-only WebSocket streams carry everything Clawd needs:
//
//   /api/events.mux   — session events + approval/requested|resolved frames
//   /api/events.host  — host/session-added|removed, host/agent-error
//
// A plain GET on those paths answers 426 Upgrade Required — that doubles as
// the dsh fingerprint for port discovery. Approval decisions go back via
// POST /api/respond (handled by src/permission.js replyDeepseekApproval).
//
// No auth beyond a loopback Host check; nothing is installed into the app.

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const AGENT_ID = "deepseek-harness";
const SESSION_PREFIX = "dsh:";
const DEFAULT_PORT = 3080;
const MUX_PATH = "/api/events.mux";
const HOST_PATH = "/api/events.host";
const PROBE_TIMEOUT_MS = 1500;
const DISCOVERY_INTERVAL_MS = 15000;
const RECONNECT_DELAY_MS = 3000;
const CALL_ID_MAP_MAX = 64;

function defaultLogDir() {
  return path.join(os.homedir(), "Library", "Application Support", "DeepSeek Harness", "logs");
}

function prefixSessionId(sessionId) {
  const raw = sessionId == null || sessionId === "" ? "default" : String(sessionId);
  return raw.startsWith(SESSION_PREFIX) ? raw : `${SESSION_PREFIX}${raw}`;
}

// The last "dsh web: http://127.0.0.1:<port>" line in the desktop log carries
// the actual bound port (random when 3080 was occupied). Log rotates into
// .1/.2/.3 backups — newest first, so scan the base name then backups, and
// within a file take the LAST match.
function extractPortFromLogText(text) {
  if (typeof text !== "string" || !text) return null;
  const re = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/g;
  let match;
  let port = null;
  while ((match = re.exec(text)) !== null) {
    const candidate = Number(match[1]);
    if (Number.isInteger(candidate) && candidate > 0 && candidate <= 65535) port = candidate;
  }
  return port;
}

class DeepseekMonitor {
  constructor(callbacks = {}, options = {}) {
    this.onStateChange = typeof callbacks.onStateChange === "function" ? callbacks.onStateChange : () => {};
    this.onPermissionRequest = typeof callbacks.onPermissionRequest === "function" ? callbacks.onPermissionRequest : () => {};
    this.onPermissionResolved = typeof callbacks.onPermissionResolved === "function" ? callbacks.onPermissionResolved : () => {};
    this.onDisconnect = typeof callbacks.onDisconnect === "function" ? callbacks.onDisconnect : () => {};

    this.WebSocketImpl = options.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
    this.httpGet = options.httpGet || http.get;
    this.logDir = options.logDir || defaultLogDir();
    this.discoveryIntervalMs = options.discoveryIntervalMs || DISCOVERY_INTERVAL_MS;
    this.reconnectDelayMs = options.reconnectDelayMs || RECONNECT_DELAY_MS;
    this.logWarn = typeof options.logWarn === "function" ? options.logWarn : () => {};

    this.started = false;
    this.port = null;
    this.muxSocket = null;
    this.hostSocket = null;
    this.discoveryTimer = null;
    this.reconnectTimer = null;
    this.warnedNoWebSocket = false;
    // callId → { toolName, arguments } for correlating approval/requested
    // frames (which carry no arguments) with the earlier tool/call event.
    this.openCalls = new Map();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.discover();
    this.discoveryTimer = setInterval(() => this.discover(), this.discoveryIntervalMs);
    if (typeof this.discoveryTimer.unref === "function") this.discoveryTimer.unref();
  }

  stop() {
    this.started = false;
    if (this.discoveryTimer) { clearInterval(this.discoveryTimer); this.discoveryTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.teardownSockets(false);
    this.openCalls.clear();
  }

  // ── Discovery ──

  probePort(port, callback) {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      callback(ok);
    };
    let req;
    try {
      req = this.httpGet(
        { hostname: "127.0.0.1", port, path: MUX_PATH, timeout: PROBE_TIMEOUT_MS },
        (res) => {
          res.resume();
          // 426 Upgrade Required is the dsh fingerprint: a plain HTTP server
          // never answers that, and any other status means "not dsh".
          finish(res.statusCode === 426);
        }
      );
    } catch {
      finish(false);
      return;
    }
    req.on("error", () => finish(false));
    req.on("timeout", () => { req.destroy(); finish(false); });
  }

  readPortFromLogs() {
    const names = ["desktop.log", "desktop.log.1", "desktop.log.2", "desktop.log.3"];
    for (const name of names) {
      let text;
      try {
        text = fs.readFileSync(path.join(this.logDir, name), "utf8");
      } catch {
        continue;
      }
      const port = extractPortFromLogText(text);
      if (port) return port;
    }
    return null;
  }

  discover() {
    if (!this.started || this.muxSocket) return;
    this.probePort(DEFAULT_PORT, (ok) => {
      if (!this.started || this.muxSocket) return;
      if (ok) {
        this.connect(DEFAULT_PORT);
        return;
      }
      const logPort = this.readPortFromLogs();
      if (!logPort || logPort === DEFAULT_PORT) return;
      this.probePort(logPort, (logOk) => {
        if (!this.started || this.muxSocket) return;
        if (logOk) this.connect(logPort);
      });
    });
  }

  // ── Connection ──

  connect(port) {
    if (!this.WebSocketImpl) {
      if (!this.warnedNoWebSocket) {
        this.warnedNoWebSocket = true;
        this.logWarn("Clawd: DeepSeek monitor unavailable — no global WebSocket in this runtime");
      }
      return;
    }
    this.port = port;
    this.openCalls.clear();
    this.muxSocket = this.openSocket(port, MUX_PATH, (data, envelope) => this.handleMuxMessage(data, envelope));
    this.hostSocket = this.openSocket(port, HOST_PATH, (data) => this.handleHostMessage(data));
  }

  openSocket(port, urlPath, onMessage) {
    let socket;
    try {
      socket = new this.WebSocketImpl(`ws://127.0.0.1:${port}${urlPath}`);
    } catch {
      this.scheduleTeardown();
      return null;
    }
    socket.addEventListener("message", (event) => {
      let envelope;
      try {
        envelope = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        return;
      }
      onMessage(envelope && envelope.payload, envelope);
    });
    socket.addEventListener("close", () => this.scheduleTeardown());
    socket.addEventListener("error", () => this.scheduleTeardown());
    return socket;
  }

  scheduleTeardown() {
    if (!this.started) return;
    if (this.reconnectTimer) return; // teardown already scheduled
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const hadConnection = !!(this.muxSocket || this.hostSocket);
      this.teardownSockets(true);
      if (hadConnection) this.onDisconnect();
      if (this.started) this.discover();
    }, this.reconnectDelayMs);
    if (typeof this.reconnectTimer.unref === "function") this.reconnectTimer.unref();
  }

  teardownSockets(clearPort) {
    for (const key of ["muxSocket", "hostSocket"]) {
      const socket = this[key];
      this[key] = null;
      if (socket) {
        try { socket.close(); } catch {}
      }
    }
    if (clearPort) this.port = null;
  }

  // ── Frame handling ──

  rememberCall(callId, toolName, args) {
    if (!callId) return;
    if (this.openCalls.size >= CALL_ID_MAP_MAX) {
      const oldest = this.openCalls.keys().next().value;
      this.openCalls.delete(oldest);
    }
    this.openCalls.set(callId, { toolName, arguments: args });
  }

  handleMuxMessage(payload, envelope) {
    if (!payload || typeof payload !== "object") return;
    switch (payload.type) {
      case "session/subscribed": {
        this.onStateChange(prefixSessionId(payload.sessionId), "idle", "SessionStart", { agentId: AGENT_ID });
        return;
      }
      case "session/event": {
        this.handleSessionEvent(payload.sessionId, payload.event);
        return;
      }
      case "approval/requested": {
        const call = payload.callId ? this.openCalls.get(payload.callId) : null;
        this.onPermissionRequest({
          port: this.port,
          rpcId: envelope && typeof envelope.rpcId === "string" ? envelope.rpcId : null,
          sessionId: prefixSessionId(payload.sessionId),
          approvalId: payload.approvalId || null,
          toolName: payload.toolName || (call && call.toolName) || "Unknown",
          callId: payload.callId || null,
          reason: typeof payload.reason === "string" ? payload.reason : "",
          arguments: call ? call.arguments : null,
        });
        return;
      }
      case "approval/resolved": {
        this.onPermissionResolved({
          sessionId: prefixSessionId(payload.sessionId),
          approvalId: payload.approvalId || null,
        });
        return;
      }
      default:
        // question/*, session/queue, session/jobs, session/projection,
        // stream/error — not needed for pet state or approvals.
        return;
    }
  }

  handleSessionEvent(rawSessionId, event) {
    if (!event || typeof event !== "object") return;
    const sessionId = prefixSessionId(rawSessionId);
    const data = event.data && typeof event.data === "object" ? event.data : {};
    switch (event.type) {
      case "turn/start":
      case "user/message":
        this.onStateChange(sessionId, "thinking", "UserPromptSubmit", { agentId: AGENT_ID });
        return;
      case "tool/call": {
        this.rememberCall(data.callId, data.name, typeof data.arguments === "string" ? data.arguments : null);
        this.onStateChange(sessionId, "working", "PreToolUse", { agentId: AGENT_ID });
        return;
      }
      case "tool/result":
        this.onStateChange(sessionId, "working", "PostToolUse", { agentId: AGENT_ID });
        return;
      case "turn/end":
        this.onStateChange(sessionId, "attention", "Stop", { agentId: AGENT_ID });
        return;
      default:
        // assistant/chunk, step/*, todo/write, approval/* (session-log twins of
        // the dedicated mux frames), etc. — too noisy or covered elsewhere.
        return;
    }
  }

  handleHostMessage(payload) {
    if (!payload || typeof payload !== "object") return;
    switch (payload.type) {
      case "host/session-added":
        this.onStateChange(prefixSessionId(payload.sessionId), "idle", "SessionStart", {
          agentId: AGENT_ID,
          cwd: typeof payload.cwd === "string" ? payload.cwd : null,
        });
        return;
      case "host/session-removed":
        this.onStateChange(prefixSessionId(payload.sessionId), "sleeping", "SessionEnd", { agentId: AGENT_ID });
        return;
      case "host/agent-error":
        this.onStateChange(prefixSessionId(payload.sessionId), "error", "StopFailure", { agentId: AGENT_ID });
        return;
      default:
        return;
    }
  }
}

module.exports = DeepseekMonitor;
module.exports.AGENT_ID = AGENT_ID;
module.exports.DEFAULT_PORT = DEFAULT_PORT;
module.exports.MUX_PATH = MUX_PATH;
module.exports.HOST_PATH = HOST_PATH;
module.exports.prefixSessionId = prefixSessionId;
module.exports.extractPortFromLogText = extractPortFromLogText;
