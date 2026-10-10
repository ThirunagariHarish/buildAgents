import SwiftUI
import UIKit
import UserNotifications

/// Pocket for iPhone: the Pocket Box Runtime page with a native bridge for
/// background runs, local notifications, location and Apple's on-device model.
@main
struct PocketApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RuntimeView()
                .ignoresSafeArea(.container, edges: .bottom)
                .background(Color(red: 0.965, green: 0.957, blue: 0.941))
        }
        .onChange(of: phase) { now in
            if now == .background { Background.scheduleRefresh() }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        Background.register()
        return true
    }

    // Show agents' notifications even while Pocket is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    // A tap on a "time to run" or agent notification opens the Runtime, which runs what is due.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let hash = response.notification.request.content.userInfo["hash"] as? String ?? "feed"
        await MainActor.run { NotificationCenter.default.post(name: .pocketOpen, object: hash) }
    }
}

extension Notification.Name { static let pocketOpen = Notification.Name("pocketOpen") }

enum Config {
    static let baseURL: URL = {
        let s = Bundle.main.object(forInfoDictionaryKey: "PocketBaseURL") as? String
        return URL(string: (s?.isEmpty == false ? s! : "https://agents.cashflowus.com"))!
    }()
}
