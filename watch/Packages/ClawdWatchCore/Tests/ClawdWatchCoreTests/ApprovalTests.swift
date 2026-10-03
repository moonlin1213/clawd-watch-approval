import XCTest
@testable import ClawdWatchCore

final class ApprovalTests: XCTestCase {
    func testActualNodeSnapshotAndReceiptDecode() throws {
        struct Contract: Decodable { let approvals: [ApprovalCard]; let operation: OperationResult }
        let url = Bundle.module.url(forResource: "node-contract", withExtension: "json", subdirectory: "Fixtures")!
        let contract = try JSONDecoder().decode(Contract.self, from: Data(contentsOf: url))
        XCTAssertEqual(contract.approvals[0].agentId, "kimi-cli")
        XCTAssertEqual(contract.approvals[0].details, "{\n  \"command\": \"pwd\"\n}")
        XCTAssertEqual(contract.operation.status, .delivered)
        XCTAssertEqual(contract.operation.decision, .deny)
        XCTAssertEqual(contract.operation.requestId, contract.approvals[0].id)
    }
    func testMillisecondsAndRemoteExpiry() throws {
        let data = Data(#"{"id":"r","revision":"v","agentId":"kimi-cli","sessionLabel":"s","projectLabel":"p","toolName":"Bash","details":"pwd","createdAtMs":1000,"expiresAtMs":301000,"canDecide":true}"#.utf8)
        let card = try JSONDecoder().decode(ApprovalCard.self, from: data)
        XCTAssertEqual(card.createdAt.timeIntervalSince1970, 1)
        XCTAssertTrue(card.isActionable(at: Date(timeIntervalSince1970: 300)))
        XCTAssertFalse(card.isActionable(at: Date(timeIntervalSince1970: 301.001)))
    }
    func testLostResponsePreservesOperationAndRequiresLookup() {
        let id = UUID().uuidString
        var state = DecisionState(operationID: id)
        state.apply(.started)
        XCTAssertFalse(state.isDelivered)
        state.apply(.transportFailed)
        XCTAssertFalse(state.isDelivered)
        XCTAssertEqual(state.operationID, id)
        XCTAssertTrue(state.needsLookup)
        state.apply(.operationLookup(nil))
        XCTAssertFalse(state.isDelivered)
        XCTAssertTrue(state.needsLookup)
        state.apply(.response(OperationResult(operationId: id, requestId: "r", decision: .allow, status: .delivered)))
        XCTAssertTrue(state.isDelivered)
    }
    func testDifferentOperationReceiptNeverShowsSuccess() {
        var state = DecisionState(operationID: "original")
        state.apply(.response(OperationResult(operationId: "different", requestId: "r", decision: .allow, status: .delivered)))
        XCTAssertFalse(state.isDelivered)
    }
}
