import BackgroundTasks
import WebKit

/// When iOS grants background time, load the Runtime off-screen with `?bg=1`;
/// the page runs whatever is due and says "done".
enum Background {
    static let id = "com.cashflowus.pocket.refresh"
    private static var running: (web: WKWebView, bridge: Bridge)?

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            scheduleRefresh()
            DispatchQueue.main.async { run(task) }
        }
    }

    static func scheduleRefresh() {
        let req = BGAppRefreshTaskRequest(identifier: id)
        // iOS decides the real time; ask for the next scheduled run, or in 15 minutes.
        req.earliestBeginDate = Schedule.nextDue.map { max($0, Date(timeIntervalSinceNow: 60)) } ?? Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }

    private static func run(_ task: BGAppRefreshTask) {
        let bridge = Bridge()
        let web = Bridge.makeWebView(bridge: bridge)
        var finished = false
        let finish: (Bool) -> Void = { ok in
            guard !finished else { return }
            finished = true
            running = nil
            task.setTaskCompleted(success: ok)
        }
        bridge.onDone = { finish(true) }
        task.expirationHandler = { DispatchQueue.main.async { web.stopLoading(); finish(false) } }
        running = (web, bridge)
        var c = URLComponents(url: Config.baseURL.appendingPathComponent("runtime"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "bg", value: "1")]
        web.load(URLRequest(url: c.url!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 27) { finish(false) }
    }
}
