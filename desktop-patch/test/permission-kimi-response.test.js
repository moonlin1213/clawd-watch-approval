"use strict";

const assert = require("node:assert");
const Module = require("node:module");
const { describe, it } = require("node:test");

const PERMISSION_MODULE_PATH = require.resolve("../src/permission");

function loadPermissionWithElectron(fakeElectron = null) {
  delete require.cache[PERMISSION_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      return fakeElectron || {
        BrowserWindow: Object.assign(class {}, { fromWebContents() { return null; } }),
        globalShortcut: {
          register() { return true; },
          unregister() {},
          isRegistered() { return false; },
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/permission");
  } finally {
    Module._load = originalLoad;
  }
}

function createKimiDecisionHarness() {
  const focusCalls = [];
  const fakeElectron = {
    BrowserWindow: Object.assign(class {}, {
      fromWebContents(sender) { return sender && sender.__window ? sender.__window : null; },
    }),
    globalShortcut: {
      register() { return true; },
      unregister() {},
      isRegistered() { return false; },
    },
  };
  const initPermission = loadPermissionWithElectron(fakeElectron);
  const api = initPermission({
    sessions: new Map(),
    hideBubbles: false,
    petHidden: false,
    win: null,
    lang: "en",
    getBubblePolicy: () => ({ enabled: true, autoCloseMs: null }),
    focusTerminalForSession: (sessionId) => focusCalls.push(sessionId),
    permDebugLog: null,
  });
  return { api, focusCalls };
}

function createFakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: "",
    writableEnded: false,
    writableFinished: false,
    destroyed: false,
    _listeners: new Map(),
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers || {};
    },
    end(data) {
      if (data) this.body += String(data);
      this.writableEnded = true;
      this.writableFinished = true;
    },
    on(event, handler) {
      this._listeners.set(event, handler);
      return this;
    },
    removeListener(event, handler) {
      if (this._listeners.get(event) === handler) this._listeners.delete(event);
      return this;
    },
    destroy() {
      this.destroyed = true;
      this.writableEnded = true;
      this.writableFinished = true;
      const handler = this._listeners.get("close");
      if (handler) handler();
    },
  };
  return res;
}

function createFakeBubble() {
  const bubble = {
    hidden: false,
    destroyed: false,
    webContents: {
      send(event) {
        if (event === "permission-hide") bubble.hidden = true;
      },
    },
    isDestroyed() { return this.destroyed; },
    destroy() { this.destroyed = true; },
  };
  return bubble;
}

function pushKimiEntry(api, res, bubble) {
  const permEntry = {
    res,
    abortHandler: () => {},
    suggestions: [],
    sessionId: "kimi-cli:s1",
    bubble,
    hideTimer: null,
    toolName: "shell",
    toolInput: { command: "npm test" },
    createdAt: Date.now(),
    agentId: "kimi-cli",
    isKimi: true,
  };
  api.pendingPermissions.push(permEntry);
  return permEntry;
}

describe("Kimi permission response body", () => {
  it("builds allow in the Kimi hook schema", () => {
    const permission = loadPermissionWithElectron();
    const body = permission.__test.buildKimiPermissionResponseBody("allow");
    const parsed = JSON.parse(body);

    assert.deepStrictEqual(parsed, { hookSpecificOutput: { permissionDecision: "allow" } });
  });

  it("keeps the deny reason as permissionDecisionReason", () => {
    const permission = loadPermissionWithElectron();
    const body = permission.__test.buildKimiPermissionResponseBody("deny", "Denied via hotkey");
    const parsed = JSON.parse(body);

    assert.deepStrictEqual(parsed, {
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "Denied via hotkey",
      },
    });
  });

  it("rejects invalid decisions so callers can answer no-decision", () => {
    const permission = loadPermissionWithElectron();
    assert.strictEqual(permission.__test.buildKimiPermissionResponseBody({ behavior: "ask" }), null);
    assert.strictEqual(permission.__test.buildKimiPermissionResponseBody(null), null);
  });
});

describe("Kimi interactive permission decisions", () => {
  it("responds 200 with permissionDecision on allow and deny", () => {
    for (const behavior of ["allow", "deny"]) {
      const { api } = createKimiDecisionHarness();
      const res = createFakeRes();
      const bubble = createFakeBubble();
      pushKimiEntry(api, res, bubble);

      api.handleDecide({ sender: { __window: bubble } }, behavior);

      assert.strictEqual(res.statusCode, 200);
      const parsed = JSON.parse(res.body);
      assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, behavior);
      assert.strictEqual(api.pendingPermissions.length, 0);
    }
  });

  it("treats Kimi deny-and-focus as immediate no-decision instead of hanging the socket", () => {
    const { api, focusCalls } = createKimiDecisionHarness();
    const res = createFakeRes();
    const bubble = createFakeBubble();
    pushKimiEntry(api, res, bubble);

    api.handleDecide({ sender: { __window: bubble } }, "deny-and-focus");

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.writableEnded, true);
    assert.strictEqual(res.body, "");
    assert.deepStrictEqual(focusCalls, ["kimi-cli:s1"]);
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("does not let Kimi take suggestion or opencode-only decision paths", () => {
    for (const behavior of ["suggestion:0", "opencode-always"]) {
      const { api } = createKimiDecisionHarness();
      const res = createFakeRes();
      const bubble = createFakeBubble();
      pushKimiEntry(api, res, bubble);

      api.handleDecide({ sender: { __window: bubble } }, behavior);

      assert.strictEqual(res.statusCode, 204);
      assert.strictEqual(res.body, "");
      assert.strictEqual(api.pendingPermissions.length, 0);
    }
  });

  it("dismisses Kimi entries on DND with no-decision instead of a deny", () => {
    const { api } = createKimiDecisionHarness();
    const res = createFakeRes();
    const bubble = createFakeBubble();
    pushKimiEntry(api, res, bubble);

    assert.strictEqual(api.dismissPermissionsForDnd(), 1);

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.body, "");
    assert.strictEqual(bubble.hidden, true);
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("kimi entries are actionable for hotkeys (not filtered like notify bubbles)", () => {
    const { api } = createKimiDecisionHarness();
    const res = createFakeRes();
    const bubble = createFakeBubble();
    pushKimiEntry(api, res, bubble);

    // handleDecide via hotkey path: resolvePermissionEntry("allow") resolves
    // the newest actionable entry — same call the global shortcut makes.
    const perm = api.pendingPermissions[api.pendingPermissions.length - 1];
    api.resolvePermissionEntry(perm, "allow");

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).hookSpecificOutput.permissionDecision, "allow");
  });
});
