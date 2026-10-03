import SwiftUI
import ClawdWatchCore
struct ApprovalView: View {
    let card: ApprovalCard
    var compactNotification = false
    @EnvironmentObject private var state: WatchViewState
    var body: some View {
        GeometryReader { geometry in
          ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: compactNotification ? 4 : 10) {
                Text(card.agentName + " · " + card.toolName).font(.caption).bold().foregroundStyle(Theme.Text.primary)
                Text(card.projectLabel.isEmpty ? card.sessionLabel : card.projectLabel).font(.caption2).foregroundStyle(.secondary)
                Text(card.details).font(.system(.caption, design: .monospaced)).frame(maxWidth: .infinity, alignment: .leading)
                if let result = state.results[card.id] {
                    Text(result.status.label).foregroundStyle(result.status == .delivered ? Theme.Accent.success : Theme.Text.primary)
                    if let message = result.message { Text(message).font(.caption2) }
                    if let input = state.pending[card.id] {
                        Button("查询决定回执") { Task { await state.lookup(input) } }
                    }
                } else {
                    if !card.isActionable() { Text(card.desktopReason == nil ? "请求已过期，请刷新。" : "请在桌面处理。").font(.caption) }
                }
                }.padding(.horizontal, 3)
            }.frame(width: geometry.size.width, height: max(0, geometry.size.height - 54))
             .clipped()
             .frame(maxHeight: .infinity, alignment: .top)
            HStack(spacing: 24) {
                decisionButton("允许", decision: .allow, color: Theme.DecisionButton.allow)
                decisionButton("拒绝", decision: .deny, color: Theme.DecisionButton.deny)
            }
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity)
            .background(.black)
          }.frame(width: geometry.size.width, height: geometry.size.height)
        }.navigationTitle(compactNotification ? "" : "审批详情")
    }
    private func decisionButton(_ title: String, decision: Decision, color: Color) -> some View {
        Button(role: decision == .deny ? .destructive : nil) {
            Task { await state.decide(card, decision) }
        } label: {
            Text(title).font(.system(size: 12, weight: .semibold))
                .frame(width: 44, height: 44)
                .foregroundStyle(decision == .allow ? Theme.DecisionButton.allowText : Theme.DecisionButton.text)
                .background(color, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(decision == .allow ? "允许一次" : "拒绝")
        .disabled(!card.isActionable() || state.results[card.id] != nil)
        .opacity(card.isActionable() && state.results[card.id] == nil ? 1 : 0.4)
    }
}

struct ApprovalNotificationView: View {
    let requestID: String?
    @ObservedObject private var state = WatchViewState.shared
    @State private var verified = false
    @State private var loading = false
    @State private var message = "正在读取审批详情…"
    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { _ in
          Group {
            if verified, let card = state.approvals.first(where: { $0.id == requestID }) {
                    ApprovalView(card: card, compactNotification: true).environmentObject(state)
            } else if verified, let requestID, let result = state.results[requestID] {
                VStack(spacing: 8) {
                    Text(result.status.label).font(.caption)
                    if let message = result.message { Text(message).font(.caption2) }
                    if let input = state.pending[requestID] {
                        Button("查询决定回执") { Task { await state.lookup(input) } }
                    }
                }
            } else {
                VStack(spacing: 8) {
                    Text(message).font(.caption)
                    Button("重新读取") { Task { await load() } }.disabled(loading)
                }
            }
          }
        }
        .frame(height: 110)
        .task(id: requestID) { await load() }
    }
    @MainActor private func load() async {
        guard !loading else { return }
        loading = true; verified = false; message = "正在读取审批详情…"
        defer { loading = false }
        do {
            _ = try await state.loadNotificationCard(requestID: requestID)
            verified = true; message = "请求已处理或过期，请重新读取。"
        }
        catch let error as NotificationCardError { message = error.localizedDescription }
        catch { message = "暂时无法向 Mac 核实请求，请联网后重新读取。" }
    }
}
extension OperationStatus {
    var label: String {
        switch self {
        case .claimed: return "发送中…"
        case .delivered: return "决定已交付"
        case .handledElsewhere: return "已由其他入口处理"
        case .expired: return "请求已过期"
        case .unknown: return "交付结果未知，请在桌面核对"
        }
    }
}
