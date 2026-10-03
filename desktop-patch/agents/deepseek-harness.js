// DeepSeek Harness agent configuration
// Outbound monitor integration: Clawd connects to the dsh web server
// (127.0.0.1, downlink-only WebSockets) — nothing is installed into the app.

module.exports = {
  id: "deepseek-harness",
  name: "DeepSeek Harness",
  processNames: { mac: ["DeepSeek Harness"], win: [], linux: [] },
  eventSource: "monitor",
  // dsh session events are translated by agents/deepseek-monitor.js into the
  // shared PascalCase event names below.
  eventMap: {
    SessionStart: "idle",
    SessionEnd: "sleeping",
    UserPromptSubmit: "thinking",
    PreToolUse: "working",
    PostToolUse: "working",
    Stop: "attention",
    StopFailure: "error",
  },
  capabilities: {
    httpHook: false,
    permissionApproval: true,
    interactiveBubble: false,
    notificationHook: false,
    sessionEnd: true,
    subagent: false,
  },
};
