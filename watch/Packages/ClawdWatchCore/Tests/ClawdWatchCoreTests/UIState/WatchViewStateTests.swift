import XCTest
import Foundation
@testable import ClawdWatchCore

// Compile the actual app state and bridge through local source links. Only
// Watch-only Keychain/haptics are replaced; HTTP uses the real bounded client.
enum WatchCredentials {
    static func load() -> WatchIdentity? { nil }
    static func save(_ identity: WatchIdentity) throws {}
    static func remove() {}
}
enum HapticManager { static func taskComplete() {} }

final class WatchViewStateTests: XCTestCase {
    let requestID = "12345678-1234-4234-8234-123456789abc"
    func body(_ request: URLRequest) -> Data {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while true { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
        return data
    }
    func card(_ revision: String = "original", id: String? = nil) throws -> ApprovalCard {
        try JSONDecoder().decode(ApprovalCard.self, from: Data("""
        {"id":"\(id ?? requestID)","revision":"\(revision)","agentId":"codex","sessionLabel":"s","projectLabel":"p","toolName":"Bash","details":"\(revision)","createdAtMs":1000,"expiresAtMs":9999999999999,"canDecide":true}
        """.utf8))
    }
    @MainActor func state() -> WatchViewState {
        let name = "clawd-watch-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        return WatchViewState(identity: WatchIdentity(id: "test", token: "test-token", baseURL: "https://mac.example/api/clawd-watch/v1"), defaults: defaults, session: URLSession(configuration: config), monitorNetwork: false)
    }
    @MainActor func testStaleDecisionRefreshesOriginalRequestAndAllowsNewExplicitDecision() async throws {
        let model = state(); var posts = 0, lookups = 0
        let fresh = try card("changed")
        StubProtocol.handler = { request in
            if request.httpMethod == "POST" {
                posts += 1
                if posts == 1 { return (409, Data(#"{"error":"stale-or-incomplete"}"#.utf8)) }
                let input = try JSONDecoder().decode(DecisionInput.self, from: self.body(request))
                XCTAssertEqual(input.revision, "changed"); XCTAssertEqual(input.decision, .deny)
                return (200, try JSONEncoder().encode(OperationResult(operationId: input.operationId, requestId: input.requestId, decision: input.decision, status: .delivered)))
            }
            if request.url!.path.contains("/operations/") { lookups += 1; return (404, Data()) }
            return (200, try JSONEncoder().encode(["approvals": [fresh]]))
        }
        await model.decide(try card(), .allow)
        XCTAssertNil(model.pending[requestID]); XCTAssertNil(model.results[requestID])
        XCTAssertEqual(model.approvals.first?.revision, "changed"); XCTAssertEqual(lookups, 0)
        await model.decide(fresh, .deny)
        XCTAssertEqual(posts, 2); XCTAssertEqual(model.results[requestID]?.status, .delivered)
    }
    @MainActor func testExpiredIsDefiniteRejectionWhileLostResponseOnlyQueriesSameOperation() async throws {
        let model = state(); var posts = 0; var queried: [String] = []
        StubProtocol.handler = { request in
            if request.httpMethod == "POST" { posts += 1; return (410, Data(#"{"error":"expired"}"#.utf8)) }
            return (200, Data(#"{"approvals":[]}"#.utf8))
        }
        await model.decide(try card(), .allow)
        XCTAssertTrue(model.pending.isEmpty); XCTAssertEqual(posts, 1)
        StubProtocol.handler = { request in
            if request.httpMethod == "POST" { posts += 1; throw URLError(.networkConnectionLost) }
            queried.append(request.url!.lastPathComponent); return (404, Data())
        }
        await model.decide(try card(), .deny)
        let operation = try XCTUnwrap(model.pending[requestID])
        await model.decide(try card("changed"), .allow)
        XCTAssertEqual(posts, 2); XCTAssertEqual(queried, [operation.operationId, operation.operationId])
        XCTAssertEqual(model.pending[requestID]?.operationId, operation.operationId)
    }
    @MainActor func testEveryPendingOperationGetsAQueryWhenMoreThanEightResponsesAreLost() async throws {
        let model = state(); var queried = Set<String>(); var posts = 0
        StubProtocol.handler = { request in
            if request.httpMethod == "POST" { posts += 1; throw URLError(.networkConnectionLost) }
            if request.url!.path.contains("/operations/") { queried.insert(request.url!.lastPathComponent); return (404, Data()) }
            return (200, Data(#"{"approvals":[]}"#.utf8))
        }
        for _ in 0..<9 { await model.decide(try card(id: UUID().uuidString.lowercased()), .deny) }
        XCTAssertEqual(model.pending.count, 9); queried = []
        for _ in 0..<3 { await model.refresh() }
        XCTAssertEqual(queried, Set(model.pending.values.map(\.operationId)))
        XCTAssertEqual(posts, 9, "recovery must never submit a decision again")
    }
    @MainActor func testInteractiveNotificationReadsFreshMatchingCardWithoutSubmittingADecision() async throws {
        let model = state(); var posts = 0, reads = 0
        let fresh = try card("latest")
        StubProtocol.handler = { request in
            if request.httpMethod == "POST" { posts += 1 }
            reads += 1
            return (200, try JSONEncoder().encode(["approvals": [fresh]]))
        }
        let loaded = try await model.loadNotificationCard(requestID: requestID)
        XCTAssertEqual(loaded.revision, "latest")
        XCTAssertEqual(model.approvals, [fresh], "notification and inbox must observe the same fresh snapshot")
        XCTAssertEqual(reads, 1); XCTAssertEqual(posts, 0)
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertNil(model.focusedRequestID, "notification must remain interactive without navigating into the app")
    }
    @MainActor func testInteractiveNotificationNeverFallsBackToCachedDetailsAfterNetworkFailure() async throws {
        let model = state()
        StubProtocol.handler = { _ in (200, try JSONEncoder().encode(["approvals": [self.card("cached")]])) }
        await model.refresh()
        XCTAssertEqual(model.approvals.count, 1)
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        do { _ = try await model.loadNotificationCard(requestID: requestID); XCTFail("must not authorize using cache") }
        catch { XCTAssertTrue(error is URLError) }
        XCTAssertTrue(model.pending.isEmpty)
    }
    @MainActor func testInteractiveNotificationRejectsMissingOtherAndExpiredRequests() async throws {
        let model = state(); var reads = 0
        StubProtocol.handler = { _ in reads += 1; return (200, Data(#"{"approvals":[]}"#.utf8)) }
        do { _ = try await model.loadNotificationCard(requestID: "malformed"); XCTFail("must validate notification ID") }
        catch NotificationCardError.invalidRequest {}
        XCTAssertEqual(reads, 0)
        let other = try card(id: UUID().uuidString.lowercased())
        let expired = try JSONDecoder().decode(ApprovalCard.self, from: Data("""
        {"id":"\(requestID)","revision":"expired","agentId":"codex","sessionLabel":"s","projectLabel":"p","toolName":"Bash","details":"expired","createdAtMs":0,"expiresAtMs":1,"canDecide":true}
        """.utf8))
        for cards in [[], [other], [expired]] {
            StubProtocol.handler = { _ in (200, try JSONEncoder().encode(["approvals": cards])) }
            do { _ = try await model.loadNotificationCard(requestID: requestID); XCTFail("must not offer actions") }
            catch NotificationCardError.unavailable {}
        }
        XCTAssertTrue(model.pending.isEmpty)
    }
}
