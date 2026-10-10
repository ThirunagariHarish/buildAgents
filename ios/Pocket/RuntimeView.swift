import SwiftUI
import UIKit
import WebKit

/// The Runtime page, full screen. Pocket Box pages stay in the app; other links open in Safari.
struct RuntimeView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let web = Bridge.makeWebView(bridge: context.coordinator.bridge)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        context.coordinator.web = web
        web.load(URLRequest(url: Config.baseURL.appendingPathComponent("runtime")))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let bridge = Bridge()
        weak var web: WKWebView?
        private var observer: NSObjectProtocol?

        override init() {
            super.init()
            observer = NotificationCenter.default.addObserver(forName: .pocketOpen, object: nil, queue: .main) { [weak self] note in
                let hash = note.object as? String ?? "feed"
                var c = URLComponents(url: Config.baseURL.appendingPathComponent("runtime"), resolvingAgainstBaseURL: false)!
                c.fragment = hash
                self?.web?.load(URLRequest(url: c.url!))
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            if url.host == Config.baseURL.host || url.scheme == "about" { return .allow }
            await MainActor.run { UIApplication.shared.open(url) }
            return .cancel
        }
    }
}
