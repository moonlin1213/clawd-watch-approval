#!/usr/bin/env python3
"""Render the actual ApprovalView with long offline content in a separate simulator app.

No live identity, notification registration, polling, or permission request is used.
The generated copy lives in ignored build/; production app sources stay untouched.
"""
import json
import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / "build" / "watch-layout-fixture" / "watch"
shutil.copytree(root / "watch", target, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns(".build", "xcuserdata", ".DS_Store", "UIState"))
app = target / "ClaudeWatch watchOS/App/ClaudeWatchWatchApp.swift"
card = {
    "id": "12345678-1234-4234-8234-123456789abc", "revision": "layout-fixture",
    "agentId": "codex", "sessionLabel": "布局验证", "projectLabel": "长内容测试",
    "toolName": "Bash", "createdAtMs": 1000, "expiresAtMs": 9999999999999,
    "canDecide": True, "details": "\n".join(
        [f"第 {i:02} 行：审批内容可以独立滚动。" for i in range(1, 41)] + ["内容末尾：固定按钮仍应可见"])
}
literal = json.dumps(json.dumps(card, ensure_ascii=False), ensure_ascii=False)
entry = '''@main
struct ClaudeWatchWatchApp: App {
    @StateObject private var state = WatchViewState(identity: nil, defaults: UserDefaults(suiteName: "clawd-watch-layout-fixture")!, monitorNetwork: false)
    private let card = try! JSONDecoder().decode(ApprovalCard.self, from: Data(CARD.utf8))
    var body: some Scene {
        WindowGroup {
            NavigationStack { ApprovalView(card: card) }.environmentObject(state)
        }
    }
}
'''.replace("CARD", literal)
app.write_text("import ClawdWatchCore\n" + app.read_text().split("@main", 1)[0] + entry)
if "--notification" in sys.argv:
    notification_entry = '''
enum FixtureTransport {
    static let snapshot = Data(CARD.utf8)
    static func response(method: String, data: Data?) throws -> Data {
        if method == "POST", let data {
            let input = try JSONDecoder().decode(DecisionInput.self, from: data)
            return try JSONEncoder().encode(OperationResult(operationId: input.operationId, requestId: input.requestId, decision: input.decision, status: .delivered))
        }
        return snapshot
    }
}
@main
struct ClaudeWatchWatchApp: App {
    var body: some Scene {
        WindowGroup {
            Text("离线通知布局验证").task { await WatchNotificationCoordinator.shared.activate() }
        }
        WKNotificationScene(controller: ApprovalNotificationController.self, category: "CLAWD_APPROVAL")
    }
}
'''.replace("CARD", json.dumps(json.dumps({"approvals": [card]}, ensure_ascii=False), ensure_ascii=False))
    app.write_text("import ClawdWatchCore\n" + app.read_text().split("@main", 1)[0] + notification_entry)
    payload = {"aps": {"alert": {"title": "Codex 等待审批", "body": "离线通知布局测试"}, "sound": "default", "category": "CLAWD_APPROVAL"}, "requestId": card["id"], "revision": card["revision"]}
    (target.parent / "notification.apns").write_text(json.dumps(payload, ensure_ascii=False))
    state = target / "ClaudeWatch watchOS/Services/WatchViewState.swift"
    state.write_text(state.read_text().replace("static let shared = WatchViewState()", 'static let shared = WatchViewState(identity: WatchIdentity(id: "layout-test", token: "offline-fixture", baseURL: "https://layout.invalid/api/clawd-watch/v1"), monitorNetwork: false)'))
    # watchOS delegates URLSession traffic to a daemon, bypassing URLProtocol.
    # Replace only the network boundary in this generated test copy.
    fixture_response = root / "build/watch-layout-fixture/watch/Packages/ClawdWatchCore/Sources/ClawdWatchCore/LayoutFixtureResponse.swift"
    fixture_response.write_text("import Foundation\n" + notification_entry.split("@main", 1)[0])
    # The fixture transport belongs to the package, not the app module.
    app.write_text("import ClawdWatchCore\n" + app.read_text().split("enum FixtureTransport", 1)[0].replace("import ClawdWatchCore\n", "", 1) + notification_entry[notification_entry.index("@main"):])
    api = target / "Packages/ClawdWatchCore/Sources/ClawdWatchCore/ApprovalAPI.swift"
    api.write_text(api.read_text().replace('        guard !path.contains', '        if baseURL.host == "layout.invalid" { return try FixtureTransport.response(method: method, data: data) }\n        guard !path.contains', 1))
project = target / "ClaudeWatch.xcodeproj/project.pbxproj"
project.write_text(project.read_text().replace("org.example.clawdwatch.watchapp", "org.example.clawdwatch.layoutfixture"))
print(target)
