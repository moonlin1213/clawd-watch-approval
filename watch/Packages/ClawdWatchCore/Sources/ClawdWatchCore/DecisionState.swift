import Foundation
public struct DecisionState {
    public enum Event { case started, response(OperationResult), transportFailed, operationLookup(OperationResult?) }
    public let operationID: String
    public private(set) var status: OperationStatus = .unknown
    public private(set) var needsLookup = false
    public var isDelivered: Bool { status == .delivered }
    public init(operationID: String) { self.operationID = operationID }
    public mutating func apply(_ event: Event) {
        switch event {
        case .started: status = .claimed; needsLookup = true
        case .transportFailed: status = .unknown; needsLookup = true
        case .response(let result): accept(result)
        case .operationLookup(let result):
            if let result { accept(result) } else { status = .unknown; needsLookup = true }
        }
    }
    private mutating func accept(_ result: OperationResult) {
        guard result.operationId == operationID else { status = .unknown; needsLookup = true; return }
        status = result.status; needsLookup = status == .claimed || status == .unknown
    }
}
