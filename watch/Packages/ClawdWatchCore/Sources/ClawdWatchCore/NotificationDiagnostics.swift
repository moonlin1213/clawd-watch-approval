import Foundation

public enum NotificationAuthorization: Sendable { case notDetermined, denied, authorized, provisional, unknown }
public enum NotificationOption: Sendable { case enabled, disabled, unsupported }
public struct NotificationCapabilities: Sendable {
    public var authorization: NotificationAuthorization
    public var alerts: NotificationOption
    public var sounds: NotificationOption
    public var notificationCenter: NotificationOption
    public init(authorization: NotificationAuthorization, alerts: NotificationOption, sounds: NotificationOption, notificationCenter: NotificationOption) {
        self.authorization = authorization; self.alerts = alerts; self.sounds = sounds; self.notificationCenter = notificationCenter
    }
}
public struct LocalNotificationTest: Equatable, Sendable {
    public let id: String
    public let delay: TimeInterval
    public let title: String
    public let body: String
    public let category: String?
}
public protocol NotificationDiagnosticCenter {
    func capabilities() async throws -> NotificationCapabilities
    func schedule(_ request: LocalNotificationTest) async throws
}
public enum NotificationDiagnosticError: LocalizedError {
    case authorizationRequired
    public var errorDescription: String? { "请先允许 Clawd Watch 的通知权限，再运行测试。" }
}
public enum NotificationDiagnostics {
    public static func describe(_ settings: NotificationCapabilities) -> String {
        let authorization: String
        switch settings.authorization {
        case .notDetermined: authorization = "尚未询问"
        case .denied: authorization = "未允许"
        case .authorized: authorization = "已允许"
        case .provisional: authorization = "临时授权（静默）"
        case .unknown: authorization = "系统未提供"
        }
        func describe(_ option: NotificationOption) -> String {
            switch option { case .enabled: return "开启"; case .disabled: return "关闭"; case .unsupported: return "系统未提供" }
        }
        return "通知授权：\(authorization)\n提示：\(describe(settings.alerts))\n声音：\(describe(settings.sounds))\n通知中心：\(describe(settings.notificationCenter))"
    }
    public static func scheduleLocalTest(using center: any NotificationDiagnosticCenter, id: String) async throws -> LocalNotificationTest {
        let settings = try await center.capabilities()
        guard settings.authorization == .authorized || settings.authorization == .provisional else { throw NotificationDiagnosticError.authorizationRequired }
        let request = LocalNotificationTest(id: id, delay: 10, title: "Clawd Watch 本地通知测试", body: "这是一条手表本地提醒，用于检查表盘上的通知显示。", category: nil)
        try await center.schedule(request)
        return request
    }
}
