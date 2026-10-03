import SwiftUI

// MARK: - Design Tokens (watchOS)

enum Theme {
    enum Background {
        static let primary = Color(hex: "000000")
        static let capture = Color(hex: "1a2233")
        static let overlay = Color(hex: "1a1a1a")
    }

    enum Text {
        static let primary = Color(hex: "E87A35")
        static let secondary = Color(hex: "666666")
        static let dimmed = Color(hex: "555555")
    }

    enum Accent {
        static let success = Color(hex: "34C759")
        static let error = Color(hex: "FF3B30")
        static let approval = Color(hex: "E8A735")
    }

    enum DecisionButton {
        static let allow = Color(hex: "A15940") // 饱和度略高的陶土橙
        static let deny = Color(hex: "C4BBAE") // 米杏灰
        static let text = Color(hex: "2B2420")
        static let allowText = Color(hex: "F0EEEA") // 灰白
    }
}

// MARK: - App Entry Point

@main
struct ClaudeWatchWatchApp: App {
    @WKExtensionDelegateAdaptor(WatchExtensionDelegate.self) var delegate
    @StateObject private var state = WatchViewState.shared
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            Group {
                if state.isPaired { ApprovalInboxView() } else { OnboardingView() }
            }
            .environmentObject(state)
            .task { await WatchNotificationCoordinator.shared.activate(); if scenePhase == .active { state.start() } }
            .onChange(of: scenePhase) { phase in
                if phase == .active { state.start() } else { state.stop() }
            }
        }
        WKNotificationScene(controller: ApprovalNotificationController.self, category: "CLAWD_APPROVAL")
    }
}
