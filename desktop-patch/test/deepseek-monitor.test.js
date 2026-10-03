"use strict";

const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const DeepseekMonitor = require("../agents/deepseek-monitor");

function makeCallbacks() {
  const calls = { state: [], permReq: [], permRes: [], disconnect: 0 };
  return {
    calls,
    onStateChange: (sid, state, event, extra) => calls.state.push([sid, state, event, extra]),
    onPermissionRequest: (info) => calls.permReq.push(info),
    onPermissionResolved: (info) => calls.permRes.push(info),
    onDisconnect: () => { calls.disconnect += 1; },
  };
}

function makeFakeHttp(probeResults) {
  // probeResults: Map<port, boolean> — true means "answers 426 like dsh".
  const probes = [];
  return {
    probes,
    httpGet: (options, onResponse) => {
      probes.push(options.port);
      const ok = probeResults.get(options.port) === true;
      const req = {
        on(event, handler) {
          if (event === "error" && !ok) setImmediate(() => handler(new Error("ECONNREFUSED")));
          return req;
        },
        destroy() {},
      };
      if (ok) {
        setImmediate(() => onResponse({ statusCode: 426, resume() {} }));
      }
      return req;
    },
  };
}

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }
  close() { this.closed = true; }
  emitMessage(frame) {
    const data = JSON.stringify(frame);
    for (const handler of this.listeners.get("message") || []) handler({ data });
  }
  emitClose() {
    for (const handler of this.listeners.get("close") || []) handler({});
  }
}

function muxFrame(payload, rpcId = "rpc-1") {
  return { type: "server-request", rpcId, method: payload.type, payload };
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe("DeepseekMonitor discovery", () => {
  it("extracts the last dsh port from desktop log text", () => {
    const text = [
      "[desktop] Starting Harness 0.1.0-rc.6 (bundled) on port 3080",
      "[harness:stdout] dsh web: http://127.0.0.1:3080",
      "[harness:stdout] dsh web: http://127.0.0.1:51234",
    ].join("\n");
    assert.strictEqual(DeepseekMonitor.extractPortFromLogText(text), 51234);
    assert.strictEqual(DeepseekMonitor.extractPortFromLogText("nothing here"), null);
    assert.strictEqual(DeepseekMonitor.extractPortFromLogText(null), null);
  });

  it("connects to 3080 when the fingerprint probe succeeds", async () => {
    const { calls } = makeCallbacks();
    const monitor = new DeepseekMonitor(makeCallbacks(), {
      WebSocketImpl: FakeWebSocket,
      httpGet: makeFakeHttp(new Map([[3080, true]])).httpGet,
      reconnectDelayMs: 10,
    });
    monitor.start();
    await flush();

    assert.strictEqual(monitor.port, 3080);
    assert.strictEqual(FakeWebSocket.instances.length, 2);
    assert.ok(FakeWebSocket.instances[0].url.includes("/api/events.mux"));
    assert.ok(FakeWebSocket.instances[1].url.includes("/api/events.host"));
    assert.strictEqual(calls.disconnect, 0);
    monitor.stop();
  });

  it("falls back to the desktop.log port when 3080 is not dsh", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-dsh-log-"));
    fs.writeFileSync(path.join(logDir, "desktop.log"), "[harness:stdout] dsh web: http://127.0.0.1:54321\n");
    const { httpGet, probes } = makeFakeHttp(new Map([[54321, true]]));

    const monitor = new DeepseekMonitor(makeCallbacks(), {
      WebSocketImpl: FakeWebSocket,
      httpGet,
      logDir,
      reconnectDelayMs: 10,
    });
    monitor.start();
    await flush();

    assert.deepStrictEqual(probes, [3080, 54321]);
    assert.strictEqual(monitor.port, 54321);
    monitor.stop();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it("stays disconnected when nothing answers", async () => {
    const monitor = new DeepseekMonitor(makeCallbacks(), {
      WebSocketImpl: FakeWebSocket,
      httpGet: makeFakeHttp(new Map()).httpGet,
      logDir: path.join(os.tmpdir(), "clawd-dsh-no-such-dir"),
      reconnectDelayMs: 10,
    });
    monitor.start();
    await flush();
    assert.strictEqual(monitor.port, null);
    assert.strictEqual(monitor.muxSocket, null);
    monitor.stop();
  });
});

describe("DeepseekMonitor frame handling", () => {
  function connectedMonitor(callbacks) {
    const monitor = new DeepseekMonitor(callbacks, {
      WebSocketImpl: FakeWebSocket,
      httpGet: makeFakeHttp(new Map([[3080, true]])).httpGet,
      reconnectDelayMs: 10,
    });
    monitor.start();
    return monitor;
  }

  function muxSocket() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 2];
  }

  it("maps session events to clawd states with dsh: prefixed ids", async () => {
    const cb = makeCallbacks();
    const monitor = connectedMonitor(cb);
    await flush();
    const mux = muxSocket();

    mux.emitMessage(muxFrame({ type: "session/subscribed", sessionId: "s1", lastSeq: 41 }));
    mux.emitMessage(muxFrame({
      type: "session/event",
      sessionId: "s1",
      event: { type: "turn/start", seq: 42, time: 1, data: { turn: 1 } },
    }));
    mux.emitMessage(muxFrame({
      type: "session/event",
      sessionId: "s1",
      event: { type: "tool/call", seq: 43, time: 2, data: { turn: 1, step: 1, callId: "call_1", name: "bash", arguments: "{\"command\":\"ls\"}" } },
    }));
    mux.emitMessage(muxFrame({
      type: "session/event",
      sessionId: "s1",
      event: { type: "turn/end", seq: 44, time: 3, data: { turn: 1, reason: { kind: "completed" } } },
    }));

    assert.deepStrictEqual(
      cb.calls.state.map(([sid, state, event]) => [sid, state, event]),
      [
        ["dsh:s1", "idle", "SessionStart"],
        ["dsh:s1", "thinking", "UserPromptSubmit"],
        ["dsh:s1", "working", "PreToolUse"],
        ["dsh:s1", "attention", "Stop"],
      ]
    );
    monitor.stop();
  });

  it("correlates approval/requested with the earlier tool/call arguments", async () => {
    const cb = makeCallbacks();
    const monitor = connectedMonitor(cb);
    await flush();
    const mux = muxSocket();

    mux.emitMessage(muxFrame({
      type: "session/event",
      sessionId: "s1",
      event: { type: "tool/call", seq: 1, time: 1, data: { callId: "call_9", name: "bash", arguments: "{\"command\":\"rm -rf /tmp/x\"}" } },
    }));
    mux.emitMessage(muxFrame(
      { type: "approval/requested", sessionId: "s1", approvalId: "ap-1", toolName: "bash", callId: "call_9" },
      "rpc-abc"
    ));

    assert.strictEqual(cb.calls.permReq.length, 1);
    const req = cb.calls.permReq[0];
    assert.strictEqual(req.rpcId, "rpc-abc");
    assert.strictEqual(req.sessionId, "dsh:s1");
    assert.strictEqual(req.approvalId, "ap-1");
    assert.strictEqual(req.toolName, "bash");
    assert.strictEqual(req.arguments, "{\"command\":\"rm -rf /tmp/x\"}");
    assert.strictEqual(req.port, 3080);
    monitor.stop();
  });

  it("forwards approval/resolved with the prefixed session id", async () => {
    const cb = makeCallbacks();
    const monitor = connectedMonitor(cb);
    await flush();
    muxSocket().emitMessage(muxFrame({
      type: "approval/resolved", sessionId: "s1", approvalId: "ap-1", outcome: "allowed-once",
    }));

    assert.deepStrictEqual(cb.calls.permRes, [{ sessionId: "dsh:s1", approvalId: "ap-1" }]);
    monitor.stop();
  });

  it("handles host stream session lifecycle", async () => {
    const cb = makeCallbacks();
    const monitor = connectedMonitor(cb);
    await flush();
    const host = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

    host.emitMessage({ type: "server-request", rpcId: "h1", method: "host/session-added", payload: { type: "host/session-added", sessionId: "s2", cwd: "/tmp/proj" } });
    host.emitMessage({ type: "server-request", rpcId: "h2", method: "host/agent-error", payload: { type: "host/agent-error", sessionId: "s2", message: "boom" } });
    host.emitMessage({ type: "server-request", rpcId: "h3", method: "host/session-removed", payload: { type: "host/session-removed", sessionId: "s2" } });

    assert.deepStrictEqual(
      cb.calls.state.map(([sid, state, event]) => [sid, state, event]),
      [
        ["dsh:s2", "idle", "SessionStart"],
        ["dsh:s2", "error", "StopFailure"],
        ["dsh:s2", "sleeping", "SessionEnd"],
      ]
    );
    assert.strictEqual(cb.calls.state[0][3].cwd, "/tmp/proj");
    monitor.stop();
  });

  it("tears down and notifies on socket close, then rediscovers", async () => {
    const cb = makeCallbacks();
    const monitor = connectedMonitor(cb);
    await flush();
    assert.strictEqual(monitor.port, 3080);

    muxSocket().emitClose();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();

    assert.strictEqual(cb.calls.disconnect, 1);
    // Reconnected (discovery ran again after teardown).
    assert.strictEqual(monitor.port, 3080);
    monitor.stop();
  });
});
