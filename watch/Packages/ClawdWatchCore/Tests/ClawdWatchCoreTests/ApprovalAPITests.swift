import XCTest
import Foundation
@testable import ClawdWatchCore

final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do { let (code, body) = try Self.handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
final class ApprovalAPITests: XCTestCase {
    let base = URL(string: "https://mac.example/api/clawd-watch/v1")!
    let credentials = WatchIdentity(id: "device", token: "token", baseURL: "https://mac.example/api/clawd-watch/v1")
    func api() throws -> ApprovalAPI {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        return try ApprovalAPI(baseURL: base, session: URLSession(configuration: config))
    }
    func testUnsafeBaseURLsAreRejected() {
        for address in ["http://mac.example/api/clawd-watch/v1", "https://user:pass@mac.example/api/clawd-watch/v1", "https://mac.example/api/clawd-watch/v1?x=1", "https://mac.example/api/clawd-watch/v1#fragment", "https://mac.example/other"] {
            XCTAssertThrowsError(try ApprovalAPI(baseURL: URL(string: address)!))
        }
    }
    func testSnapshotRequestUsesBearerAndExactHTTPSPrefix() async throws {
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://mac.example/api/clawd-watch/v1/approvals")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
            return (200, Data(#"{"approvals":[]}"#.utf8))
        }
        let client = try api(); let cards = try await client.fetchApprovals(credentials: credentials)
        XCTAssertTrue(cards.isEmpty)
    }
    func test401DiffersFromOfflineAndLargeResponseFails() async throws {
        let client = try api()
        StubProtocol.handler = { _ in (401, Data()) }
        do { _ = try await client.fetchApprovals(credentials: credentials); XCTFail() } catch { XCTAssertEqual(error as? ApprovalAPIError, .unauthorized) }
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        do { _ = try await client.fetchApprovals(credentials: credentials); XCTFail() } catch { XCTAssertTrue(error is URLError) }
        StubProtocol.handler = { _ in (200, Data(repeating: 32, count: 131073)) }
        do { _ = try await client.fetchApprovals(credentials: credentials); XCTFail() } catch { XCTAssertEqual(error as? ApprovalAPIError, .responseTooLarge) }
    }
    func testMissingOperationOnlyQueriesAndDoesNotResubmit() async throws {
        StubProtocol.handler = { request in XCTAssertEqual(request.httpMethod, "GET"); XCTAssertEqual(request.url?.lastPathComponent, "12345678-1234-4234-8234-123456789abc"); return (404, Data()) }
        let result = try await api().operation(id: "12345678-1234-4234-8234-123456789abc", credentials: credentials)
        XCTAssertNil(result)
    }
    func testRedirectCannotSendCredentialsToDifferentOrigin() throws {
        let client = try api()
        XCTAssertFalse(client.isAllowedRedirect(from: base, to: URL(string: "https://attacker.example/api/clawd-watch/v1/approvals")!))
        XCTAssertFalse(client.isAllowedRedirect(from: base, to: URL(string: "https://mac.example/permission")!))
    }
}
