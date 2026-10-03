"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");

const kimiHook = require("../hooks/kimi-hook");

describe("kimi-hook permission intercept", () => {
  it("intercepts PreToolUse for permission-gated tools only", () => {
    const shellPayload = { tool_name: "shell", tool_input: { command: "ls" } };
    assert.strictEqual(kimiHook.shouldInterceptPermission("PreToolUse", shellPayload), true);
    assert.strictEqual(kimiHook.shouldInterceptPermission("PreToolUse", { tool_name: "write_file" }), true);
    assert.strictEqual(kimiHook.shouldInterceptPermission("PreToolUse", { tool_name: "read_file" }), false);
    assert.strictEqual(kimiHook.shouldInterceptPermission("PostToolUse", shellPayload), false);
    assert.strictEqual(kimiHook.shouldInterceptPermission("UserPromptSubmit", shellPayload), false);
  });

  it("honors the intercept kill switch", () => {
    process.env.CLAWD_KIMI_DISABLE_PERMISSION_INTERCEPT = "1";
    try {
      assert.strictEqual(
        kimiHook.shouldInterceptPermission("PreToolUse", { tool_name: "shell" }),
        false
      );
    } finally {
      delete process.env.CLAWD_KIMI_DISABLE_PERMISSION_INTERCEPT;
    }
  });

  it("builds a permission body with kimi-cli agent id and prefixed session", () => {
    const body = kimiHook.buildKimiPermissionBody({
      session_id: "abc123",
      tool_name: "shell",
      tool_input: { command: "npm test" },
      cwd: "/tmp/project",
    });

    assert.strictEqual(body.agent_id, "kimi-cli");
    assert.strictEqual(body.session_id, "kimi-cli:abc123");
    assert.strictEqual(body.tool_name, "shell");
    assert.deepStrictEqual(body.tool_input, { command: "npm test" });
    assert.strictEqual(body.cwd, "/tmp/project");
  });

  it("keeps an already-prefixed session id and defaults missing fields", () => {
    const body = kimiHook.buildKimiPermissionBody({ tool_name: "write_file" });

    assert.strictEqual(body.session_id, "kimi-cli:default");
    assert.deepStrictEqual(body.tool_input, {});

    const prefixed = kimiHook.buildKimiPermissionBody({ session_id: "kimi-cli:x", tool_name: "shell" });
    assert.strictEqual(prefixed.session_id, "kimi-cli:x");
  });

  it("sanitizes server responses down to the Kimi hook schema", () => {
    const allow = kimiHook.sanitizeKimiPermissionOutput(
      JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } })
    );
    assert.deepStrictEqual(JSON.parse(allow), { hookSpecificOutput: { permissionDecision: "allow" } });

    const deny = kimiHook.sanitizeKimiPermissionOutput(
      JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "Denied via hotkey",
          extra: "dropped",
        },
      })
    );
    assert.deepStrictEqual(JSON.parse(deny), {
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "Denied via hotkey",
      },
    });
  });

  it("fails open (null) on missing/invalid responses", () => {
    assert.strictEqual(kimiHook.sanitizeKimiPermissionOutput(""), null);
    assert.strictEqual(kimiHook.sanitizeKimiPermissionOutput("not json"), null);
    assert.strictEqual(kimiHook.sanitizeKimiPermissionOutput("{}"), null);
    assert.strictEqual(
      kimiHook.sanitizeKimiPermissionOutput(
        JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } })
      ),
      null
    );
    assert.strictEqual(kimiHook.sanitizeKimiPermissionOutput(null), null);
  });

  it("caps the permission timeout at 590s", () => {
    assert.strictEqual(kimiHook.getKimiPermissionTimeoutMs(), 590000);
    process.env.CLAWD_KIMI_PERMISSION_TIMEOUT_MS = "5000";
    try {
      assert.strictEqual(kimiHook.getKimiPermissionTimeoutMs(), 5000);
    } finally {
      delete process.env.CLAWD_KIMI_PERMISSION_TIMEOUT_MS;
    }
    process.env.CLAWD_KIMI_PERMISSION_TIMEOUT_MS = "999999999";
    try {
      assert.strictEqual(kimiHook.getKimiPermissionTimeoutMs(), 590000);
    } finally {
      delete process.env.CLAWD_KIMI_PERMISSION_TIMEOUT_MS;
    }
  });
});
