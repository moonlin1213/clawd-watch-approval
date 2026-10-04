import SwiftUI
import CoreText
import ClawdWatchCore
struct ApprovalView: View {
    let card: ApprovalCard
    var compactNotification = false
    @EnvironmentObject private var state: WatchViewState
    var body: some View {
        GeometryReader { geometry in
          ZStack(alignment: .bottom) {
            if compactNotification {
                VStack(spacing: 3) {
                    Text(card.agentName + " · " + card.toolName)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Text.primary)
                        .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    if let result = state.results[card.id] {
                        VStack(spacing: 2) {
                            Text(result.status.label).font(.caption2)
                            if let message = result.message { Text(message).font(.caption2).lineLimit(2) }
                            if let input = state.pending[card.id] {
                                Button("查询决定回执") { Task { await state.lookup(input) } }
                                    .font(.caption2)
                            }
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if !card.isActionable() {
                        Text(card.desktopReason == nil ? "请求已过期，请刷新。" : "请在桌面处理。")
                            .font(.caption2).frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        NotificationDetailReader(text: ApprovalDetailText.readable(card.details)
                            + "\n\n项目 / 会话\n" + (card.projectLabel.isEmpty ? card.sessionLabel : card.projectLabel))
                            .id(card.id + ":" + card.revision)
                    }
                }.frame(width: geometry.size.width, height: max(0, geometry.size.height - 48))
                 .frame(maxHeight: .infinity, alignment: .top)
            } else {
            ScrollView {
                VStack(alignment: .leading, spacing: compactNotification ? 4 : 10) {
                Text(card.agentName + " · " + card.toolName).font(.caption).bold().foregroundStyle(Theme.Text.primary)
                Text(card.projectLabel.isEmpty ? card.sessionLabel : card.projectLabel).font(.caption2).foregroundStyle(.secondary)
                Text(ApprovalDetailText.readable(card.details)).font(.system(.caption, design: .monospaced)).frame(maxWidth: .infinity, alignment: .leading)
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
            }
            HStack {
                decisionButton("允许", decision: .allow, color: Theme.DecisionButton.allow)
                Spacer(minLength: 8)
                decisionButton("拒绝", decision: .deny, color: Theme.DecisionButton.deny)
            }
            .padding(.horizontal, 3)
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


/// The system long-look already owns vertical scrolling. Large tap targets avoid
/// a second competing scroll view and keep the decision controls in place.
private struct NotificationDetailReader: View {
    let text: String
    @State private var page = 0
    private let font = CTFontCreateWithName("SFMono-Regular" as CFString, 11, nil)

    var body: some View {
        GeometryReader { geometry in
            let pages = ApprovalDetailText.pages(text, width: max(1, geometry.size.width - 24), linesPerPage: 3) {
                let attributes = [kCTFontAttributeName as NSAttributedString.Key: font]
                let line = CTLineCreateWithAttributedString(NSAttributedString(string: $0, attributes: attributes))
                return CTLineGetTypographicBounds(line, nil, nil, nil)
            }
            let current = min(page, pages.count - 1)
            ZStack {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(pages[current].enumerated()), id: \.offset) { _, line in
                        Text(line.isEmpty ? " " : line)
                            .font(.custom(CTFontCopyPostScriptName(font) as String, fixedSize: 11))
                            .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            .frame(height: 14)
                    }
                    Spacer(minLength: 0)
                }.padding(.horizontal, 12).allowsHitTesting(false)
                HStack(spacing: 0) {
                    pageButton(symbol: "chevron.left", label: "上一页", enabled: current > 0) {
                        page = max(0, current - 1)
                    }
                    pageButton(symbol: "chevron.right", label: "下一页", enabled: current + 1 < pages.count) {
                        page = min(pages.count - 1, current + 1)
                    }
                }
                Text("\(current + 1) / \(pages.count)")
                    .font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
                    .frame(maxHeight: .infinity, alignment: .bottom).allowsHitTesting(false)
            }.clipped()
        }.onChange(of: text) { _, _ in page = 0 }
    }
    private func pageButton(symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary).opacity(enabled ? 1 : 0.2)
                .frame(maxWidth: .infinity, maxHeight: .infinity,
                       alignment: symbol == "chevron.left" ? .leading : .trailing)
                .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(label)
         .accessibilityHint("点详情左半边返回，右半边继续")
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
        .frame(height: 116)
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
