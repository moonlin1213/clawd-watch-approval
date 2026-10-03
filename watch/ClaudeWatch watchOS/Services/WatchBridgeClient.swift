import Foundation
import ClawdWatchCore

// Direct Watch HTTPS transport; no iPhone relay or background SSE dependency.
final class WatchBridgeClient {
    let identity: WatchIdentity
    let api: ApprovalAPI
    init(identity: WatchIdentity, session: URLSession = .shared) throws {
        guard let url = URL(string: identity.baseURL) else { throw ApprovalAPIError.invalidURL }
        self.identity = identity
        self.api = try ApprovalAPI(baseURL: url, session: session)
    }
    func snapshot() async throws -> [ApprovalCard] { try await api.fetchApprovals(credentials: identity) }
    func submit(_ input: DecisionInput) async throws -> OperationResult { try await api.submit(input: input, credentials: identity) }
    func operation(_ id: String) async throws -> OperationResult? { try await api.operation(id: id, credentials: identity) }
}
