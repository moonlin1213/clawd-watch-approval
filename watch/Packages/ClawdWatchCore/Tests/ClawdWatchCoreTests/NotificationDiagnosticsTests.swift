import XCTest
@testable import ClawdWatchCore

final class NotificationDiagnosticsTests: XCTestCase {
    final class Center: NotificationDiagnosticCenter {
        var settings = NotificationCapabilities(authorization: .authorized, alerts: .enabled, sounds: .enabled, notificationCenter: .enabled)
        var scheduled: [LocalNotificationTest] = []
        var schedulingError: Error?
        func capabilities() async throws -> NotificationCapabilities { settings }
        func schedule(_ request: LocalNotificationTest) async throws {
            if let schedulingError { throw schedulingError }
            scheduled.append(request)
        }
    }
    func testDeniedAuthorizationNeverSchedulesOrClaimsThatNotificationsWork() async throws {
        let center = Center(); center.settings.authorization = .denied
        do { _ = try await NotificationDiagnostics.scheduleLocalTest(using: center, id: "test"); XCTFail("must refuse a denied test") }
        catch NotificationDiagnosticError.authorizationRequired {}
        XCTAssertTrue(center.scheduled.isEmpty)
        let summary = NotificationDiagnostics.describe(center.settings)
        XCTAssertTrue(summary.contains("通知授权：未允许"))
        XCTAssertFalse(summary.contains("已送达"))
    }
    func testAuthorizedTestIsDelayedGenericLocalAlertWithoutAnApprovalCategory() async throws {
        let center = Center()
        let request = try await NotificationDiagnostics.scheduleLocalTest(using: center, id: "local-test")
        XCTAssertEqual(center.scheduled, [request])
        XCTAssertEqual(request.delay, 10)
        XCTAssertEqual(request.title, "Clawd Watch 本地通知测试")
        XCTAssertNil(request.category)
        XCTAssertFalse(request.body.contains("允许一次"))
        XCTAssertFalse(request.body.contains("token"))
    }
    func testUnsupportedSettingsAreUnknownRatherThanFalselyDisabled() {
        let settings = NotificationCapabilities(authorization: .authorized, alerts: .unsupported, sounds: .disabled, notificationCenter: .enabled)
        let summary = NotificationDiagnostics.describe(settings)
        XCTAssertTrue(summary.contains("提示：系统未提供"))
        XCTAssertTrue(summary.contains("声音：关闭"))
        XCTAssertTrue(summary.contains("通知中心：开启"))
    }
    func testSchedulingFailureIsNotReportedAsASuccessfulLocalTest() async throws {
        let center = Center(); center.schedulingError = NSError(domain: "test", code: 1)
        do { _ = try await NotificationDiagnostics.scheduleLocalTest(using: center, id: "test"); XCTFail("must propagate failure") }
        catch { XCTAssertEqual((error as NSError).domain, "test") }
        XCTAssertTrue(center.scheduled.isEmpty)
    }
}
