import Foundation
import WebKit
import UserNotifications
import CoreLocation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// The page's `PocketNative` handler. Only the Pocket Box origin's main frame may use it.
final class Bridge: NSObject, WKScriptMessageHandler, CLLocationManagerDelegate {
    var onDone: (() -> Void)?
    private let location = CLLocationManager()
    private var locationWaiters: [(CLLocation?) -> Void] = []

    static func makeWebView(bridge: Bridge) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(bridge, name: "PocketNative")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .clear
        return web
    }

    override init() {
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == Config.baseURL.host,
              let m = message.body as? [String: Any], let type = m["type"] as? String else { return }
        let id = m["id"] as? Int ?? 0
        let web = message.webView
        switch type {
        case "notify":
            Notifications.show(title: m["title"] as? String ?? "", body: m["body"] as? String ?? "", tag: m["tag"] as? String ?? UUID().uuidString)
        case "schedule":
            Schedule.apply(items: m["items"] as? [[String: Any]] ?? [])
        case "done":
            onDone?()
        case "location":
            currentLocation { loc in
                let value: Any = loc.map { ["lat": $0.coordinate.latitude, "lon": $0.coordinate.longitude] } ?? NSNull()
                Bridge.reply(web, id: id, ok: loc != nil, value: value)
            }
        case "model":
            let prompt = m["prompt"] as? String ?? ""
            let words = m["maxWords"] as? Int ?? 150
            Task {
                let text = await OnDeviceModel.generate(prompt: prompt, maxWords: words)
                await MainActor.run { Bridge.reply(web, id: id, ok: text != nil, value: text ?? NSNull()) }
            }
        default: break
        }
    }

    static func reply(_ web: WKWebView?, id: Int, ok: Bool, value: Any) {
        guard let web, id > 0 else { return }
        let json = (try? JSONSerialization.data(withJSONObject: ["v": value], options: [.fragmentsAllowed]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{\"v\":null}"
        web.evaluateJavaScript("window.__pocketReply && window.__pocketReply(\(id), \(ok), (\(json)).v)")
    }

    // MARK: location, only while the app is in use and only when allowed
    private func currentLocation(_ done: @escaping (CLLocation?) -> Void) {
        switch location.authorizationStatus {
        case .notDetermined:
            locationWaiters.append(done)
            location.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            locationWaiters.append(done)
            location.requestLocation()
        default:
            done(nil)
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !locationWaiters.isEmpty else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        case .notDetermined: break
        default: flush(nil)
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) { flush(locations.last) }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { flush(nil) }
    private func flush(_ loc: CLLocation?) { let w = locationWaiters; locationWaiters = []; w.forEach { $0(loc) } }
}

/// Apple's on-device model (iOS 26+, Apple Intelligence on). Returns nil when it isn't there,
/// so the page falls back to a hand-off to the owner's Studio.
enum OnDeviceModel {
    static func generate(prompt: String, maxWords: Int) async -> String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else { return nil }
            do {
                let session = LanguageModelSession()
                let answer = try await session.respond(to: "\(prompt)\n\nAnswer in at most \(maxWords) words.")
                return answer.content
            } catch { return nil }
        }
        #endif
        return nil
    }
}

enum Notifications {
    static func show(title: String, body: String, tag: String, hash: String = "feed") {
        let c = UNMutableNotificationContent()
        c.title = String(title.prefix(120))
        c.body = String(body.prefix(1200))
        c.sound = .default
        c.userInfo = ["hash": hash]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: tag, content: c, trigger: nil))
    }
}

/// iPhones don't run apps on a timer. At each scheduled time Pocket shows a
/// "time to run" notification (opening it runs the agent), and asks iOS for
/// background refresh time, which runs whatever is due when iOS grants it.
enum Schedule {
    private static let key = "pocket.schedule"
    private static let prefix = "pocket.due."

    static func apply(items: [[String: Any]]) {
        UserDefaults.standard.set(items.compactMap { $0["at"] as? Double }, forKey: key)
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) })
            let now = Date().timeIntervalSince1970 * 1000
            for item in items where (item["kind"] as? String) == "schedule" {
                guard let at = item["at"] as? Double, at > now, let agentId = item["agentId"] as? String else { continue }
                let c = UNMutableNotificationContent()
                c.title = "\(item["icon"] as? String ?? "") \(item["title"] as? String ?? "Agent")".trimmingCharacters(in: .whitespaces)
                c.body = "Time to run. Tap to run it now."
                c.userInfo = ["hash": "run=\(agentId)"]
                let date = Date(timeIntervalSince1970: at / 1000)
                let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                center.add(UNNotificationRequest(identifier: "\(prefix)\(agentId).\(Int(at))", content: c,
                                                 trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
            }
        }
        Background.scheduleRefresh()
    }

    /// The soonest upcoming scheduled time, for the background refresh request.
    static var nextDue: Date? {
        let now = Date().timeIntervalSince1970 * 1000
        return (UserDefaults.standard.array(forKey: key) as? [Double])?.filter { $0 > now }.min().map { Date(timeIntervalSince1970: $0 / 1000) }
    }
}
