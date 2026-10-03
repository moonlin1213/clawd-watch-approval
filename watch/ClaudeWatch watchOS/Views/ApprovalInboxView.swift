import SwiftUI
import ClawdWatchCore
struct ApprovalInboxView: View {
    @EnvironmentObject private var state: WatchViewState
    @State private var path: [String] = []
    @State private var showSettings = false
    @State private var showNotificationDiagnostics = false
    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Text(state.message).font(.caption2).foregroundStyle(.secondary)
                    if state.approvals.isEmpty { Text("暂无待审批操作").font(.caption) }
                    ForEach(state.approvals) { card in
                        NavigationLink(value: card.id) {
                            VStack(alignment: .leading) {
                                Text(card.agentName + " · " + card.toolName).font(.headline)
                                Text(card.projectLabel.isEmpty ? card.sessionLabel : card.projectLabel).font(.caption2).lineLimit(2).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: { Text("待审批 \(state.approvals.count)") }
                if !state.results.isEmpty {
                    Section("最近回执") {
                        ForEach(Array(state.results.keys.sorted().suffix(8)), id: \.self) { id in
                            if let result = state.results[id] {
                                VStack(alignment: .leading) {
                                    Text(result.decision == .allow ? "允许一次" : "拒绝").font(.caption)
                                    Text(result.status.label).font(.caption2).foregroundStyle(.secondary)
                                    if let input = state.pending[id] { Button("查询回执") { Task { await state.lookup(input) } } }
                                }
                            }
                        }
                    }
                }
                Button("刷新") { Task { await state.refresh() } }.disabled(state.refreshing)
                Button("配对设置") { showSettings = true }
            }
            .navigationTitle("Clawd Watch")
            .navigationDestination(for: String.self) { id in
                if let card = state.approvals.first(where: { $0.id == id }) { ApprovalView(card: card) }
                else if let result = state.results[id] { Text(result.status.label).padding() }
                else { Text("请求已处理或过期。请刷新列表。").padding() }
            }
            .onChange(of: state.focusedRequestID) { id in if let id { path = [id]; state.focusedRequestID = nil } }
            .sheet(isPresented: $showSettings) {
                ScrollView { VStack(spacing: 12) {
                    Text("已与 Mac 配对").font(.headline)
                    Text(state.identity?.baseURL ?? "").font(.caption2)
                    Button("请求通知权限") { Task { await WatchNotificationCoordinator.shared.activate() } }
                    Button("通知诊断") { showNotificationDiagnostics = true }
                    Button("解除配对", role: .destructive) { state.forgetPairing(); showSettings = false }
                }.padding() }
                .sheet(isPresented: $showNotificationDiagnostics) { NotificationDiagnosticsView() }
            }
        }
    }
}

private struct NotificationDiagnosticsView: View {
    @State private var settingsText = "正在读取系统通知设置…"
    @State private var resultText = ""
    @State private var scheduling = false
    private let center = SystemNotificationDiagnosticCenter()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("通知诊断").font(.headline)
                Text(settingsText).font(.caption)
                Button("刷新通知设置") { Task { await refresh() } }
                Button("10秒后本地测试通知") {
                    Task {
                        scheduling = true
                        defer { scheduling = false }
                        do {
                            _ = try await NotificationDiagnostics.scheduleLocalTest(using: center, id: "clawd-local-test-" + UUID().uuidString)
                            resultText = "已安排。请按数码表冠返回表盘，等待 10 秒，再检查通知中心。"
                        } catch { resultText = error.localizedDescription }
                    }
                }.disabled(scheduling)
                if !resultText.isEmpty { Text(resultText).font(.caption2) }
                Text("本地测试不经过 Mac 或网络，不执行审批。专注模式和手表锁定也可能影响显示。").font(.caption2).foregroundStyle(.secondary)
            }.padding()
        }.task { await refresh() }
    }
    @MainActor private func refresh() async {
        do { settingsText = NotificationDiagnostics.describe(try await center.capabilities()) }
        catch { settingsText = "读取失败：" + error.localizedDescription }
    }
}
