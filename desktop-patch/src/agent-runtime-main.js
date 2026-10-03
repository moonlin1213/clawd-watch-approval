"use strict";

const DefaultCodexSubagentClassifier = require("../agents/codex-subagent-classifier");
const {
  buildCodexMonitorUpdateOptions,
  isCodexMonitorPermissionEvent,
} = require("./codex-monitor-callback");

const CODEX_OFFICIAL_LOG_SUPPRESS_TTL_MS = 10 * 60 * 1000;
const CODEX_LOG_EVENTS_COVERED_BY_OFFICIAL_HOOKS = new Set([
  "session_meta",
  "event_msg:task_started",
  "event_msg:user_message",
  "event_msg:guardian_assessment",
  "response_item:function_call",
  "response_item:custom_tool_call",
  "event_msg:exec_command_end",
  "event_msg:patch_apply_end",
  "event_msg:custom_tool_call_output",
  "event_msg:task_complete",
]);

function createAgentRuntimeMain(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const logWarn = typeof options.logWarn === "function" ? options.logWarn : console.warn;
  const loadCodexLogMonitor = options.loadCodexLogMonitor || (() => require("../agents/codex-log-monitor"));
  const loadCodexAgent = options.loadCodexAgent || (() => require("../agents/codex"));
  const loadDeepseekMonitor = options.loadDeepseekMonitor || (() => require("../agents/deepseek-monitor"));
  const codexSubagentClassifier = options.codexSubagentClassifier || new DefaultCodexSubagentClassifier();
  const getServer = options.getServer || (() => null);
  const getStateRuntime = options.getStateRuntime || (() => null);
  const getPermissionRuntime = options.getPermissionRuntime || (() => null);
  const isAgentEnabled = options.isAgentEnabled || (() => true);
  const isDeepseekApprovalSuppressed = options.isDeepseekApprovalSuppressed || (() => false);
  const updateSession = options.updateSession || (() => {});
  const showCodexNotifyBubble = options.showCodexNotifyBubble || (() => {});
  const clearCodexNotifyBubbles = options.clearCodexNotifyBubbles || (() => {});

  let codexMonitor = null;
  let deepseekMonitor = null;
  const codexOfficialHookSessions = new Map();

  function markCodexOfficialHookSession(sessionId) {
    if (!sessionId) return;
    codexOfficialHookSessions.set(String(sessionId), now());
  }

  function hasRecentCodexOfficialHookSession(sessionId) {
    const lastHookAt = codexOfficialHookSessions.get(String(sessionId));
    if (!lastHookAt) return false;
    if (now() - lastHookAt > CODEX_OFFICIAL_LOG_SUPPRESS_TTL_MS) {
      codexOfficialHookSessions.delete(String(sessionId));
      return false;
    }
    return true;
  }

  function shouldSuppressCodexLogEvent(sessionId, state, event) {
    if (state === "codex-permission") return hasRecentCodexOfficialHookSession(sessionId);
    if (!CODEX_LOG_EVENTS_COVERED_BY_OFFICIAL_HOOKS.has(event)) return false;
    return hasRecentCodexOfficialHookSession(sessionId);
  }

  function updateSessionFromServer(sessionId, state, event, opts = {}) {
    if (opts && opts.agentId === "codex" && opts.hookSource === "codex-official") {
      markCodexOfficialHookSession(sessionId);
    }
    return updateSession(sessionId, state, event, opts);
  }

  function startMonitorForAgent(agentId) {
    if (agentId === "codex" && codexMonitor) codexMonitor.start();
    if (agentId === "deepseek-harness" && deepseekMonitor) deepseekMonitor.start();
  }

  function stopMonitorForAgent(agentId) {
    if (agentId === "codex" && codexMonitor) codexMonitor.stop();
    if (agentId === "deepseek-harness" && deepseekMonitor) deepseekMonitor.stop();
  }

  function callServer(method, ...args) {
    const server = getServer();
    return server && typeof server[method] === "function" ? server[method](...args) : false;
  }

  function syncIntegrationForAgent(agentId) {
    return callServer("syncIntegrationForAgent", agentId);
  }

  function repairIntegrationForAgent(agentId, optionsArg) {
    return callServer("repairIntegrationForAgent", agentId, optionsArg);
  }

  function stopIntegrationForAgent(agentId) {
    return callServer("stopIntegrationForAgent", agentId);
  }

  function clearSessionsByAgent(agentId) {
    const state = getStateRuntime();
    return state && typeof state.clearSessionsByAgent === "function"
      ? state.clearSessionsByAgent(agentId)
      : 0;
  }

  function dismissPermissionsByAgent(agentId) {
    const perm = getPermissionRuntime();
    const state = getStateRuntime();
    const removed = perm && typeof perm.dismissPermissionsByAgent === "function"
      ? perm.dismissPermissionsByAgent(agentId)
      : 0;
    // Kimi keeps a state-side permission hold for passive notifications; when
    // an agent is disabled, dismissing the bubble must release that hold too.
    if (agentId === "kimi-cli" && state && typeof state.disposeAllKimiPermissionState === "function") {
      const disposed = state.disposeAllKimiPermissionState();
      if (disposed && typeof state.resolveDisplayState === "function" && typeof state.setState === "function") {
        const resolved = state.resolveDisplayState();
        state.setState(resolved, state.getSvgOverride ? state.getSvgOverride(resolved) : undefined);
      }
    }
    return removed;
  }

  function startCodexLogMonitor() {
    if (codexMonitor) {
      if (isAgentEnabled("codex")) codexMonitor.start();
      return codexMonitor;
    }
    try {
      const CodexLogMonitor = loadCodexLogMonitor();
      const codexAgent = loadCodexAgent();
      codexMonitor = new CodexLogMonitor(codexAgent, (sid, state, event, extra) => {
        if (shouldSuppressCodexLogEvent(sid, state, event)) return;
        if (isCodexMonitorPermissionEvent(state)) {
          updateSession(sid, "notification", event, buildCodexMonitorUpdateOptions(extra, {
            includeHeadless: false,
          }));
          showCodexNotifyBubble({
            sessionId: sid,
            command: (extra && extra.permissionDetail && extra.permissionDetail.command) || "",
          });
          return;
        }
        clearCodexNotifyBubbles(sid, `codex-state-transition:${state}`);
        updateSession(sid, state, event, buildCodexMonitorUpdateOptions(extra, {
          includeHeadless: true,
        }));
      }, { classifier: codexSubagentClassifier });
      if (isAgentEnabled("codex")) {
        codexMonitor.start();
      }
    } catch (err) {
      logWarn("Clawd: Codex log monitor not started:", err && err.message);
    }
    return codexMonitor;
  }

  // dsh approval frames carry no tool arguments; the monitor correlates the
  // earlier tool/call event and passes its arguments JSON string along.
  function buildDeepseekToolInput(info) {
    const toolInput = {};
    if (typeof info.arguments === "string" && info.arguments) {
      let parsed = null;
      try { parsed = JSON.parse(info.arguments); } catch {}
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.command === "string") toolInput.command = parsed.command;
        else if (typeof parsed.path === "string") toolInput.command = parsed.path;
        else if (typeof parsed.file_path === "string") toolInput.command = parsed.file_path;
        else toolInput.command = info.arguments.length > 500 ? `${info.arguments.slice(0, 500)}…` : info.arguments;
      } else {
        toolInput.command = info.arguments.length > 500 ? `${info.arguments.slice(0, 500)}…` : info.arguments;
      }
    }
    if (!toolInput.command) toolInput.command = "(no details)";
    if (info.reason) toolInput.reason = info.reason;
    return toolInput;
  }

  function buildDeepseekWatchInput(info) {
    if (typeof info.arguments !== "string" || !info.arguments) return null;
    try {
      const parameters = JSON.parse(info.arguments);
      if (!parameters || typeof parameters !== "object") return null;
      return { parameters, reason: info.reason || "" };
    } catch { return null; }
  }

  function handleDeepseekPermissionRequest(info) {
    const perm = getPermissionRuntime();
    if (!perm || !info || !info.rpcId || !info.approvalId) return;
    // Suppressed (DND / bubbles off / per-agent permissions off): leave the
    // request entirely alone — the WebUI ApprovalPanel stays the answer path.
    if (isDeepseekApprovalSuppressed()) return;

    const watchToolInput = buildDeepseekWatchInput(info);
    const permEntry = {
      res: null,
      abortHandler: null,
      suggestions: [],
      sessionId: info.sessionId,
      bubble: null,
      hideTimer: null,
      toolName: info.toolName || "Unknown",
      toolInput: buildDeepseekToolInput(info),
      watchToolInput,
      watchDetailsUnavailable: !watchToolInput,
      resolvedSuggestion: null,
      createdAt: now(),
      agentId: "deepseek-harness",
      isDeepseek: true,
      deepseek: {
        port: info.port,
        rpcId: info.rpcId,
        approvalId: info.approvalId,
      },
    };
    perm.pendingPermissions.push(permEntry);
    updateSession(info.sessionId, "notification", "PermissionRequest", { agentId: "deepseek-harness" });
    try {
      perm.showPermissionBubble(permEntry);
    } catch (err) {
      const idx = perm.pendingPermissions.indexOf(permEntry);
      if (idx !== -1) perm.pendingPermissions.splice(idx, 1);
      logWarn("Clawd: DeepSeek permission bubble failed:", err && err.message);
    }
  }

  function handleDeepseekPermissionResolved(info) {
    const perm = getPermissionRuntime();
    if (!perm || !info) return;
    const entry = perm.pendingPermissions.find(
      (p) => p && p.isDeepseek && p.deepseek
        && p.deepseek.approvalId === info.approvalId
        && p.sessionId === info.sessionId
    );
    // Answered in the WebUI (or cancelled by harness shutdown) — just take the
    // bubble down; isDeepseek no-decision never replies to dsh.
    if (entry) perm.resolvePermissionEntry(entry, "no-decision", "Answered outside Clawd");
  }

  function startDeepseekMonitor() {
    if (deepseekMonitor) {
      if (isAgentEnabled("deepseek-harness")) deepseekMonitor.start();
      return deepseekMonitor;
    }
    try {
      const DeepseekMonitor = loadDeepseekMonitor();
      deepseekMonitor = new DeepseekMonitor({
        onStateChange: (sid, state, event, extra) => updateSession(sid, state, event, extra),
        onPermissionRequest: handleDeepseekPermissionRequest,
        onPermissionResolved: handleDeepseekPermissionResolved,
        onDisconnect: () => dismissPermissionsByAgent("deepseek-harness"),
      }, { logWarn });
      if (isAgentEnabled("deepseek-harness")) {
        deepseekMonitor.start();
      }
    } catch (err) {
      logWarn("Clawd: DeepSeek monitor not started:", err && err.message);
    }
    return deepseekMonitor;
  }

  function cleanup() {
    if (codexMonitor && typeof codexMonitor.stop === "function") codexMonitor.stop();
    if (deepseekMonitor && typeof deepseekMonitor.stop === "function") deepseekMonitor.stop();
    codexOfficialHookSessions.clear();
  }

  return {
    getCodexSubagentClassifier: () => codexSubagentClassifier,
    startCodexLogMonitor,
    startDeepseekMonitor,
    startMonitorForAgent,
    stopMonitorForAgent,
    syncIntegrationForAgent,
    repairIntegrationForAgent,
    stopIntegrationForAgent,
    clearSessionsByAgent,
    dismissPermissionsByAgent,
    updateSessionFromServer,
    markCodexOfficialHookSession,
    shouldSuppressCodexLogEvent,
    cleanup,
  };
}

createAgentRuntimeMain.CODEX_LOG_EVENTS_COVERED_BY_OFFICIAL_HOOKS = CODEX_LOG_EVENTS_COVERED_BY_OFFICIAL_HOOKS;
createAgentRuntimeMain.CODEX_OFFICIAL_LOG_SUPPRESS_TTL_MS = CODEX_OFFICIAL_LOG_SUPPRESS_TTL_MS;

module.exports = createAgentRuntimeMain;
