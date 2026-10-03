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

function createHarness() {
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
    focusTerminalForSession: () => {},
    permDebugLog: null,
  });
  return { api };
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

function pushDeepseekEntry(api, bubble) {
  const permEntry = {
    res: null,
    abortHandler: null,
    suggestions: [],
    sessionId: "dsh:s1",
    bubble,
    hideTimer: null,
    toolName: "bash",
    toolInput: { command: "npm test" },
    resolvedSuggestion: null,
    createdAt: Date.now(),
    agentId: "deepseek-harness",
    isDeepseek: true,
    deepseek: { port: 3080, rpcId: "rpc-1", approvalId: "ap-1" },
  };
  api.pendingPermissions.push(permEntry);
  return permEntry;
}

describe("DeepSeek approval reply (POST /api/respond)", () => {
  it("sends allowed-once / rejected with the pending identifiers", async () => {
    const permission = loadPermissionWithElectron();
    const requests = [];
    const fakeRequest = (options, onResponse) => {
      const chunks = [];
      const req = {
        on() { return req; },
        write(data) { chunks.push(data); },
        end() {
          requests.push({ options, body: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") });
          setImmediate(() => {
            const res = new (require("node:events").EventEmitter)();
            res.statusCode = 200;
            res.setEncoding = () => {};
            onResponse(res);
            res.emit("end");
          });
        },
        destroy() {},
      };
      return req;
    };

    // We need an initialized module for replyDeepseekApproval — it is returned
    // from the factory, so spin up a minimal ctx.
    const api = permission({
      sessions: new Map(),
      hideBubbles: false,
      petHidden: true,
      win: null,
      lang: "en",
      permDebugLog: null,
    });

    api.replyDeepseekApproval({
      port: 3080,
      rpcId: "rpc-1",
      sessionId: "s1",
      approvalId: "ap-1",
      outcome: "allowed-once",
      toolName: "bash",
    }, { httpRequest: fakeRequest });

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].options.port, 3080);
    assert.strictEqual(requests[0].options.path, "/api/respond");
    assert.deepStrictEqual(JSON.parse(requests[0].body), {
      type: "client-response",
      rpcId: "rpc-1",
      result: { ok: true, value: { sessionId: "s1", approvalId: "ap-1", outcome: "allowed-once" } },
    });
  });

  it("skips the reply when identifiers are missing", () => {
    const permission = loadPermissionWithElectron();
    const api = permission({
      sessions: new Map(),
      hideBubbles: false,
      petHidden: true,
      win: null,
      lang: "en",
      permDebugLog: null,
    });
    let called = 0;
    api.replyDeepseekApproval({ port: 3080, rpcId: null }, {
      httpRequest: () => { called += 1; throw new Error("must not be called"); },
    });
    assert.strictEqual(called, 0);
  });
});

describe("DeepSeek interactive permission decisions", () => {
  it("allow resolves the entry without touching any socket", () => {
    const { api } = createHarness();
    const bubble = createFakeBubble();
    const entry = pushDeepseekEntry(api, bubble);

    api.handleDecide({ sender: { __window: bubble } }, "allow");

    assert.strictEqual(api.pendingPermissions.length, 0);
    assert.strictEqual(bubble.hidden, true);
    assert.strictEqual(entry.res, null);
  });

  it("deny-and-focus is a silent no-decision (WebUI panel keeps ownership)", () => {
    const { api } = createHarness();
    const bubble = createFakeBubble();
    pushDeepseekEntry(api, bubble);

    api.handleDecide({ sender: { __window: bubble } }, "deny-and-focus");

    assert.strictEqual(api.pendingPermissions.length, 0);
    assert.strictEqual(bubble.hidden, true);
  });

  it("DND dismissal drops deepseek entries silently", () => {
    const { api } = createHarness();
    const bubble = createFakeBubble();
    pushDeepseekEntry(api, bubble);

    assert.strictEqual(api.dismissPermissionsForDnd(), 1);
    assert.strictEqual(api.pendingPermissions.length, 0);
    assert.strictEqual(bubble.hidden, true);
  });

  it("cleanup on quit resolves deepseek entries without denying", () => {
    const { api } = createHarness();
    const bubble = createFakeBubble();
    pushDeepseekEntry(api, bubble);

    api.cleanup();
    assert.strictEqual(api.pendingPermissions.length, 0);
  });
});
