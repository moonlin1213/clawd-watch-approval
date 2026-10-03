import Foundation
import UserNotifications
import WatchKit
import ClawdWatchCore
import SwiftUI

@MainActor
final class WatchNotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    static let shared = WatchNotificationCoordinator()
    func activate() async {
        let center = UNUserNotificationCenter.current(); center.delegate = self
        let action = UNNotificationAction(identifier: "OPEN_APPROVAL", title: "查看审批", options: [.foreground])
        center.setNotificationCategories([UNNotificationCategory(identifier: "CLAWD_APPROVAL", actions: [action], intentIdentifiers: [], options: [])])
        if (try? await center.requestAuthorization(options: [.alert, .sound])) == true { WKExtension.shared().registerForRemoteNotifications() }
    }
    func receive(_ token: Data) async {
        let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").flatMap { try? Data(contentsOf: $0) }
        guard let environment = APNsEnvironment.fromProfile(profile) else { return }
        await WatchViewState.shared.setPush(token: token.map { String(format: "%02x", $0) }.joined(), environment: environment)
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in await WatchViewState.shared.refresh() }
        completionHandler([.banner, .sound])
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let requestID = response.notification.request.content.userInfo["requestId"] as? String
        Task { @MainActor in await WatchViewState.shared.openNotification(requestID: requestID); completionHandler() }
    }
}
final class WatchExtensionDelegate: NSObject, WKExtensionDelegate {
    func applicationDidFinishLaunching() { Task { @MainActor in await WatchNotificationCoordinator.shared.activate() } }
    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) { Task { @MainActor in await WatchNotificationCoordinator.shared.receive(deviceToken) } }
}

struct SystemNotificationDiagnosticCenter: NotificationDiagnosticCenter {
    func capabilities() async throws -> NotificationCapabilities {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let authorization: NotificationAuthorization
        switch settings.authorizationStatus {
        case .notDetermined: authorization = .notDetermined
        case .denied: authorization = .denied
        case .authorized: authorization = .authorized
        case .provisional: authorization = .provisional
        default: authorization = .unknown
        }
        func option(_ setting: UNNotificationSetting) -> NotificationOption {
            switch setting { case .enabled: return .enabled; case .disabled: return .disabled; default: return .unsupported }
        }
        return NotificationCapabilities(authorization: authorization, alerts: option(settings.alertSetting), sounds: option(settings.soundSetting), notificationCenter: option(settings.notificationCenterSetting))
    }
    func schedule(_ request: LocalNotificationTest) async throws {
        let content = UNMutableNotificationContent()
        content.title = request.title; content.body = request.body; content.sound = .default
        if let category = request.category { content.categoryIdentifier = category }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: request.delay, repeats: false)
        try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: request.id, content: content, trigger: trigger))
    }
}

final class ApprovalNotificationController: WKUserNotificationHostingController<ApprovalNotificationView> {
    private var requestID: String?
    override class var isInteractive: Bool { true }
    override func didReceive(_ notification: UNNotification) {
        requestID = notification.request.content.userInfo["requestId"] as? String
    }
    override var body: ApprovalNotificationView { ApprovalNotificationView(requestID: requestID) }
}
