import Foundation

public enum ApprovalAPIError: Error, Equatable { case invalidURL, unauthorized, responseTooLarge, http(Int), invalidResponse, notAccepted(String) }
public final class ApprovalAPI {
    public let baseURL: URL
    private let session: URLSession
    public init(baseURL: URL, session: URLSession = .shared) throws {
        guard Self.validBase(baseURL) else { throw ApprovalAPIError.invalidURL }
        self.baseURL = baseURL; self.session = session
    }
    private static func validBase(_ url: URL) -> Bool {
        url.scheme == "https" && url.host != nil && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil && url.path == "/api/clawd-watch/v1" && !url.absoluteString.contains("%") && !url.absoluteString.contains("\\")
    }
    // All redirects are declined at transport level, so credentials never follow one.
    public func isAllowedRedirect(from: URL, to: URL) -> Bool { false }
    private func request(_ path: String, method: String = "GET", data: Data? = nil, credentials: WatchIdentity? = nil) async throws -> Data {
        guard !path.contains("%"), !path.contains(".."), !path.contains("?"), !path.contains("#"), !path.contains("\\"), !path.contains("//") else { throw ApprovalAPIError.invalidURL }
        var request = URLRequest(url: baseURL.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.httpMethod = method; request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if data != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let credentials {
            guard credentials.baseURL == baseURL.absoluteString else { throw ApprovalAPIError.invalidURL }
            request.setValue("Bearer " + credentials.token, forHTTPHeaderField: "Authorization")
        }
        let (body, response) = try await BoundedRequest(configuration: session.configuration).perform(request)
        if response.statusCode == 401 { throw ApprovalAPIError.unauthorized }
        // These exact gateway errors precede durable claim and delivery. An
        // operation conflict or an unrecognized response remains uncertain.
        if method == "POST", path.hasSuffix("/decision"), [409, 410, 429].contains(response.statusCode) {
            struct Rejection: Decodable { let error: String }
            if let rejection = try? JSONDecoder().decode(Rejection.self, from: body),
               ["stale-or-incomplete", "unavailable", "handled-elsewhere", "expired", "rate limit"].contains(rejection.error) {
                throw ApprovalAPIError.notAccepted(rejection.error)
            }
        }
        guard response.statusCode == 200 else { throw ApprovalAPIError.http(response.statusCode) }
        return body
    }
    public func pair(code: String) async throws -> WatchIdentity {
        struct PairReply: Decodable { let id: String; let token: String }
        let reply = try JSONDecoder().decode(PairReply.self, from: await request("pair", method: "POST", data: JSONEncoder().encode(["code":code])))
        return WatchIdentity(id: reply.id, token: reply.token, baseURL: baseURL.absoluteString)
    }
    public func fetchApprovals(credentials: WatchIdentity) async throws -> [ApprovalCard] {
        struct Snapshot: Decodable { let approvals: [ApprovalCard] }
        return try JSONDecoder().decode(Snapshot.self, from: await request("approvals", credentials: credentials)).approvals
    }
    public func submit(input: DecisionInput, credentials: WatchIdentity) async throws -> OperationResult {
        guard UUID(uuidString: input.operationId) != nil, UUID(uuidString: input.requestId) != nil else { throw ApprovalAPIError.invalidURL }
        return try JSONDecoder().decode(OperationResult.self, from: await request("approvals/\(input.requestId)/decision", method: "POST", data: JSONEncoder().encode(input), credentials: credentials))
    }
    public func operation(id: String, credentials: WatchIdentity) async throws -> OperationResult? {
        guard UUID(uuidString: id) != nil else { throw ApprovalAPIError.invalidURL }
        do { return try JSONDecoder().decode(OperationResult.self, from: await request("operations/\(id)", credentials: credentials)) }
        catch ApprovalAPIError.http(404) { return nil }
    }
    public func registerPush(token: String, environment: String, credentials: WatchIdentity) async throws {
        _ = try await request("device/push", method: "POST", data: JSONEncoder().encode(["token":token, "environment":environment]), credentials: credentials)
    }
}

private final class BoundedRequest: NSObject, URLSessionDataDelegate {
    private let configuration: URLSessionConfiguration
    private var session: URLSession?
    private var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var data = Data()
    private var response: HTTPURLResponse?
    init(configuration: URLSessionConfiguration) { self.configuration = configuration }
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            configuration.timeoutIntervalForRequest = 12; configuration.timeoutIntervalForResource = 15
            session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            session?.dataTask(with: request).resume()
        }
    }
    private func finish(_ result: Result<(Data, HTTPURLResponse), Error>) {
        guard let continuation else { return }; self.continuation = nil
        continuation.resume(with: result); session?.invalidateAndCancel(); session = nil
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else { finish(.failure(ApprovalAPIError.invalidResponse)); completionHandler(.cancel); return }
        self.response = http
        guard response.expectedContentLength <= 131072 else { finish(.failure(ApprovalAPIError.responseTooLarge)); completionHandler(.cancel); return }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard self.data.count + data.count <= 131072 else { finish(.failure(ApprovalAPIError.responseTooLarge)); return }; self.data.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(error)) } else if let response { finish(.success((data,response))) } else { finish(.failure(ApprovalAPIError.invalidResponse)) }
    }
}
