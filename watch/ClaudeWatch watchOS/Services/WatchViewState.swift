import SwiftUI
import Foundation
import Network
import ClawdWatchCore

@MainActor
final class WatchViewState: ObservableObject {
    static let shared = WatchViewState()
    @Published private(set) var identity: WatchIdentity?
    @Published private(set) var approvals: [ApprovalCard] = []
    @Published private(set) var results: [String: OperationResult] = [:]
    @Published private(set) var pending: [String: DecisionInput] = [:]
    @Published var message = ""
    @Published var focusedRequestID: String?
    @Published private(set) var refreshing = false
    private var polling: Task<Void,Never>?
    private var active = false
    private let monitor = NWPathMonitor()
    private let operationKey = "clawdWatchPendingOperations"
    private let defaults: UserDefaults
    private let session: URLSession
    private var pushToken: String?
    private var pushEnvironment: String?
    private var registeredPush: String?
    private var lookupOffset = 0
    var isPaired: Bool { identity != nil }
    private var bridge: WatchBridgeClient? { identity.flatMap { try? WatchBridgeClient(identity: $0, session: session) } }

    init(identity: WatchIdentity? = WatchCredentials.load(), defaults: UserDefaults = .standard, session: URLSession = .shared, monitorNetwork: Bool = true) {
        self.identity = identity; self.defaults = defaults; self.session = session
        if let data = defaults.data(forKey: operationKey),
           let operations = try? JSONDecoder().decode([String: DecisionInput].self, from: data) { pending = operations }
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in if self?.active == true { await self?.refresh() } }
        }
        if monitorNetwork { monitor.start(queue: DispatchQueue(label: "clawd-watch-network")) }
    }
    func pair(address: String, code: String) async {
        do {
            guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw ApprovalAPIError.invalidURL }
            let api = try ApprovalAPI(baseURL: url)
            let paired = try await api.pair(code: code)
            try WatchCredentials.save(paired); identity = paired
            message = "已配对"; start(); await registerPush()
        } catch { message = "配对失败，请检查地址、代码和网络。" }
    }
    func start() {
        active = true; guard polling == nil else { return }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { break }
            }
        }
    }
    func stop() { active = false; polling?.cancel(); polling = nil }
    func forgetPairing() { stop(); WatchCredentials.remove(); identity = nil; approvals = []; pending = [:]; persistPending(); results = [:] }
    func refresh() async {
        guard !refreshing, let bridge else { return }; refreshing = true
        defer { refreshing = false }
        do {
            approvals = try await bridge.snapshot(); message = "已连接 Mac"
            let inputs = pending.keys.sorted().compactMap { pending[$0] }
            if !inputs.isEmpty {
                let count = min(8, inputs.count), offset = lookupOffset % inputs.count
                lookupOffset = (offset + count) % inputs.count
                for index in 0..<count { await lookup(inputs[(offset + index) % inputs.count]) }
            }
            await registerPush()
        } catch { handle(error) }
    }
    func decide(_ card: ApprovalCard, _ decision: Decision) async {
        if let previous = pending[card.id] { await lookup(previous); return }
        guard card.isActionable(), let bridge else { message = "请求已过期，请刷新。"; return }
        let input = DecisionInput(requestId: card.id, revision: card.revision, decision: decision)
        pending[card.id] = input; persistPending()
        results[card.id] = OperationResult(operationId: input.operationId, requestId: card.id, decision: decision, status: .claimed)
        do { accept(try await bridge.submit(input), for: input) }
        catch {
            if case ApprovalAPIError.notAccepted(let reason) = error {
                pending.removeValue(forKey: card.id); results.removeValue(forKey: card.id); persistPending()
                await refresh()
                message = reason == "expired" ? "请求已过期。" : reason == "rate limit" ? "请求过于频繁，请稍后重新查看并决定。" : "请求已变更或已处理，请重新查看详情后决定。"
                return
            }
            results[card.id] = OperationResult(operationId: input.operationId, requestId: card.id, decision: decision, status: .unknown)
            handle(error); await lookup(input)
        }
    }
    func lookup(_ input: DecisionInput) async {
        guard let bridge else { return }
        do {
            if let receipt = try await bridge.operation(input.operationId) { accept(receipt, for: input) }
            else { results[input.requestId] = OperationResult(operationId: input.operationId, requestId: input.requestId, decision: input.decision, status: .unknown, message: "未找到回执，请在桌面核对；不会重发决定。") }
        } catch { handle(error) }
    }
    private func accept(_ receipt: OperationResult, for input: DecisionInput) {
        guard receipt.operationId == input.operationId, receipt.requestId == input.requestId, receipt.decision == input.decision else { message = "回执不匹配，请在桌面核对。"; return }
        let wasDelivered = results[input.requestId]?.status == .delivered
        results[input.requestId] = receipt
        if receipt.status != .claimed {
            pending.removeValue(forKey: input.requestId); persistPending()
            approvals.removeAll { $0.id == input.requestId }
        }
        if receipt.status == .delivered && !wasDelivered { HapticManager.taskComplete() }
    }
    private func persistPending() {
        if let data = try? JSONEncoder().encode(pending) { defaults.set(data, forKey: operationKey) }
    }
    private func handle(_ error: Error) {
        if (error as? ApprovalAPIError) == .unauthorized { message = "配对已失效，请在 Mac 重新配对。" }
        else if case ApprovalAPIError.http(409) = error { message = "请求已变更或已处理，请刷新。" }
        else if case ApprovalAPIError.http(410) = error { message = "请求已过期。" }
        else { message = "暂时无法连接，配对已保留。" }
    }
    func openNotification(requestID: String?) async {
        await refresh()
        if let requestID, approvals.contains(where: { $0.id == requestID }) { focusedRequestID = requestID }
        else { message = "该请求已处理或过期。" }
    }
    func loadNotificationCard(requestID: String?) async throws -> ApprovalCard {
        guard let requestID, UUID(uuidString: requestID) != nil else { throw NotificationCardError.invalidRequest }
        guard let bridge else { throw NotificationCardError.unpaired }
        let cards = try await bridge.snapshot()
        approvals = cards
        guard let card = cards.first(where: { $0.id == requestID }), card.isActionable() else { throw NotificationCardError.unavailable }
        return card
    }
    func setPush(token: String, environment: String) async { pushToken = token; pushEnvironment = environment; await registerPush() }
    private func registerPush() async {
        guard let identity, let token = pushToken, let environment = pushEnvironment, let bridge else { return }
        let registration = identity.id + ":" + token + ":" + environment
        guard registeredPush != registration else { return }
        do { try await bridge.api.registerPush(token: token, environment: environment, credentials: identity); registeredPush = registration } catch {}
    }
}

enum NotificationCardError: LocalizedError {
    case invalidRequest, unpaired, unavailable
    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "通知不包含有效的审批请求。"
        case .unpaired: return "请先在 Clawd Watch 中与 Mac 配对。"
        case .unavailable: return "请求已处理、过期或需要在桌面处理。"
        }
    }
}
