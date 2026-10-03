import Foundation

public struct ApprovalCard: Codable, Identifiable, Equatable {
    public let id: String
    public let revision: String
    public let agentId: String
    public let sessionLabel: String
    public let projectLabel: String
    public let toolName: String
    public let details: String
    public let createdAtMs: Double
    public let expiresAtMs: Double
    public let canDecide: Bool
    public let desktopReason: String?
    public var createdAt: Date { Date(timeIntervalSince1970: createdAtMs / 1000) }
    public func isActionable(at date: Date = Date()) -> Bool { canDecide && date.timeIntervalSince1970 * 1000 < expiresAtMs }
    public var agentName: String { ["codex":"Codex", "claude-code":"Claude Code", "deepseek-harness":"DSH", "kimi-cli":"Kimi"][agentId] ?? agentId }
}
public enum Decision: String, Codable { case allow, deny }
public struct DecisionInput: Codable, Equatable {
    public let operationId: String
    public let requestId: String
    public let revision: String
    public let decision: Decision
    public init(operationId: String = UUID().uuidString.lowercased(), requestId: String, revision: String, decision: Decision) {
        self.operationId = operationId; self.requestId = requestId; self.revision = revision; self.decision = decision
    }
}
public enum OperationStatus: String, Codable { case claimed, delivered, handledElsewhere, expired, unknown }
public struct OperationResult: Codable, Equatable {
    public let operationId: String
    public let requestId: String
    public let decision: Decision
    public let status: OperationStatus
    public let message: String?
    public init(operationId: String, requestId: String, decision: Decision, status: OperationStatus, message: String? = nil) {
        self.operationId = operationId; self.requestId = requestId; self.decision = decision; self.status = status; self.message = message
    }
}
public struct WatchIdentity: Codable, Equatable {
    public let id: String
    public let token: String
    public let baseURL: String
    public init(id: String, token: String, baseURL: String) { self.id = id; self.token = token; self.baseURL = baseURL }
}
