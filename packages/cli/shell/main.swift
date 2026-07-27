// CrosspaneShell — 진짜 WKWebView 컴포넌트로 대상 URL을 로드하는 최소 셸.
// 브라우저(Safari)가 아니라 앱에 임베드된 웹뷰 그 자체를 재현한다:
// SW 미지원, window.open 무반응, 앱 웹뷰 UA 등 컴포넌트 레벨 동작이 그대로 나온다.
//
// 통신 (시뮬레이터의 localhost == 호스트 맥):
// - 명령: GET  {CONTROL}/commands 를 폴링 → click/scroll/navigate/... 실행
// - 이벤트: POST {CONTROL}/event ← 콘솔/에러/내비게이션 릴레이
import UIKit
import WebKit

let env = ProcessInfo.processInfo.environment
let targetURL = env["CROSSPANE_URL"] ?? "about:blank"
let controlBase = env["CROSSPANE_CONTROL"] ?? ""

final class ShellViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
  var webView: WKWebView!

  override func viewDidLoad() {
    super.viewDidLoad()
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true

    // console.*과 window.onerror를 네이티브로 릴레이하는 유저 스크립트
    let consoleRelay = """
      (function () {
        const send = (level, parts) => {
          try {
            const text = parts.map((p) => {
              try { return typeof p === 'string' ? p : JSON.stringify(p); }
              catch (e) { return String(p); }
            }).join(' ');
            window.webkit.messageHandlers.crosspane.postMessage({ kind: 'console', level, text });
          } catch (e) {}
        };
        for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
          const original = console[level];
          console[level] = function (...args) { send(level, args); original.apply(console, args); };
        }
        window.addEventListener('error', (e) => {
          try {
            const detail = (e.error && (e.error.stack || e.error.message)) || e.message;
            window.webkit.messageHandlers.crosspane.postMessage({
              kind: 'pageerror', text: detail + ' (' + e.filename + ':' + e.lineno + ')'
            });
          } catch (err) {}
        });
        window.addEventListener('unhandledrejection', (e) => {
          try {
            const reason = e.reason && (e.reason.stack || e.reason.message) || String(e.reason);
            window.webkit.messageHandlers.crosspane.postMessage({
              kind: 'pageerror', text: 'Unhandled rejection: ' + reason
            });
          } catch (err) {}
        });
      })();
      """
    let controller = WKUserContentController()
    controller.addUserScript(
      WKUserScript(source: consoleRelay, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    controller.add(self, name: "crosspane")
    config.userContentController = controller

    webView = WKWebView(frame: view.bounds, configuration: config)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = self
    view.addSubview(webView)

    if let url = URL(string: targetURL) {
      webView.load(URLRequest(url: url))
    }
    pollCommands()
  }

  // MARK: 이벤트 릴레이 (앱 → 호스트)

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    postEvent(message.body)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    if let url = webView.url?.absoluteString {
      postEvent(["kind": "navigation", "url": url])
    }
  }

  private func postEvent(_ payload: Any) {
    guard let url = URL(string: controlBase + "/event"),
      let body = try? JSONSerialization.data(withJSONObject: payload)
    else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    URLSession.shared.dataTask(with: request).resume()
  }

  // MARK: 명령 폴링 (호스트 → 앱)

  private func pollCommands() {
    guard let url = URL(string: controlBase + "/commands") else { return }
    URLSession.shared.dataTask(with: url) { data, _, _ in
      if let data,
        let commands = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
      {
        DispatchQueue.main.async { for command in commands { self.execute(command) } }
      }
      // 서버가 롱폴로 응답을 잡아두므로(명령 발생 시 즉시 응답) 곧바로 재폴링한다
      DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { self.pollCommands() }
    }.resume()
  }

  private func execute(_ command: [String: Any]) {
    switch command["type"] as? String ?? "" {
    case "click":
      let x = command["x"] as? Double ?? 0
      let y = command["y"] as? Double ?? 0
      // 정규화 좌표 → 뷰포트 좌표. focus+click으로 입력 필드/버튼 모두 대응.
      // 결과/에러를 debug 콘솔로 릴레이해 무반응 클릭을 진단 가능하게 한다
      let js = """
        (function () {
          // 대시보드 좌표는 스크린샷(=디바이스 스크린) 기준 정규화 —
          // clientHeight는 iOS 100vh 문제로 어긋나므로 screen 크기로 매핑한다
          const px = \(x) * screen.width, py = \(y) * screen.height;
          const el = document.elementFromPoint(px, py);
          if (!el) return 'no element @' + px.toFixed(0) + ',' + py.toFixed(0);
          if (el.focus) el.focus();
          if (el.click) el.click();
          return el.tagName + ' @' + px.toFixed(0) + ',' + py.toFixed(0);
        })();
        """
      webView.evaluateJavaScript(js) { result, error in
        let summary = error.map { "ERR \($0.localizedDescription)" } ?? (result as? String ?? "?")
        self.postEvent(["kind": "console", "level": "debug", "text": "[shell] click → " + summary])
      }
    case "scroll":
      let deltaY = command["deltaY"] as? Double ?? 0
      webView.evaluateJavaScript("window.scrollBy(0, \(deltaY));")
    case "drag":
      // 합성 터치는 WKWebView 네이티브 스크롤을 움직이지 못한다 —
      // 세로 위주 드래그는 scrollBy로 재현하고, 그 외(캐러셀 등)는 pointer 시퀀스로 전달
      let fromX = command["fromX"] as? Double ?? 0
      let fromY = command["fromY"] as? Double ?? 0
      let toX = command["toX"] as? Double ?? 0
      let toY = command["toY"] as? Double ?? 0
      let js = """
        (function () {
          const fx = \(fromX) * screen.width, fy = \(fromY) * screen.height;
          const tx = \(toX) * screen.width, ty = \(toY) * screen.height;
          const dx = tx - fx, dy = ty - fy;
          if (Math.abs(dy) > Math.abs(dx) * 1.5) {
            window.scrollBy(0, -dy);
            return;
          }
          const el = document.elementFromPoint(fx, fy) || document.body;
          const opts = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
          el.dispatchEvent(new PointerEvent('pointerdown', opts(fx, fy)));
          for (let i = 1; i <= 5; i++) {
            el.dispatchEvent(new PointerEvent('pointermove', opts(fx + (dx * i) / 5, fy + (dy * i) / 5)));
          }
          el.dispatchEvent(new PointerEvent('pointerup', opts(tx, ty)));
        })();
        """
      webView.evaluateJavaScript(js)
    case "type":
      if let text = command["text"] as? String,
        let encoded = try? JSONSerialization.data(withJSONObject: [text]),
        let json = String(data: encoded, encoding: .utf8)
      {
        webView.evaluateJavaScript("document.execCommand('insertText', false, (\(json))[0]);")
      }
    case "keypress":
      if let key = command["key"] as? String {
        if key == "Backspace" {
          webView.evaluateJavaScript("document.execCommand('delete');")
        } else if let encoded = try? JSONSerialization.data(withJSONObject: [key]),
          let json = String(data: encoded, encoding: .utf8)
        {
          // 특수키는 keydown/keyup 이벤트로 전달하고, Enter는 폼 제출까지 재현한다
          let js = """
            (function () {
              const key = (\(json))[0];
              const el = document.activeElement || document.body;
              const opts = { key, code: key, bubbles: true, cancelable: true };
              el.dispatchEvent(new KeyboardEvent('keydown', opts));
              el.dispatchEvent(new KeyboardEvent('keyup', opts));
              if (key === 'Enter' && el.form && el.form.requestSubmit) el.form.requestSubmit();
            })();
            """
          webView.evaluateJavaScript(js)
        }
      }
    case "navigate":
      if let raw = command["url"] as? String, let url = URL(string: raw) {
        webView.load(URLRequest(url: url))
      }
    case "reload": webView.reload()
    case "back": webView.goBack()
    case "forward": webView.goForward()
    default: break
    }
  }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = ShellViewController()
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}

_ = UIApplicationMain(
  CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
