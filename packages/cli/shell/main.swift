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
  // 프레임 스트리밍: 변화 없으면 idle로 느려지고, 명령이 오면 즉시 fast로 복귀
  private let frameIntervalFast: TimeInterval = 1.0 / 25.0
  private let frameIntervalIdle: TimeInterval = 0.5
  private var frameInterval: TimeInterval = 1.0 / 15.0
  private var framesPaused = false
  private var inflightSnapshots = 0
  private var lastFrameHash = 0
  private var unchangedFrames = 0
  // 스트림 프레임의 px/pt 비율 — 대시보드 스크롤 델타(프레임 px)를 pt로 환산한다
  private var lastPixelsPerPoint: CGFloat = 1


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
    streamFrames()
  }

  // MARK: 프레임 스트리밍 (앱 → 호스트) — simctl 스크린샷 폴링 대체
  // takeSnapshot은 공개 API이며 인프로세스라 왕복이 없다 (simctl은 회당 수백 ms)

  private func streamFrames() {
    // 고정 케이던스 + 동시 2장 파이프라이닝 — takeSnapshot 왕복 지연을 숨겨 fps를 올린다
    DispatchQueue.main.asyncAfter(deadline: .now() + frameInterval) { self.streamFrames() }
    if framesPaused || inflightSnapshots >= 2 { return }
    inflightSnapshots += 1
    let scheduleNext = { (_: TimeInterval) in } // 완료 콜백은 더 이상 스케줄하지 않는다
    // drawHierarchy는 WK 컴포지터의 비동기 서피스를 찍어 스크롤 중에도 80%가
    // 동일 프레임(실측) — WebKit이 직접 렌더하는 takeSnapshot을 저해상도로 쓴다
    let config = WKSnapshotConfiguration()
    // 헤드리스 시뮬레이터는 컴포지터가 게을러 false면 캐시 서피스를 반환한다(실측) —
    // true로 대기 중인 변경을 강제 렌더시켜야 스크롤 중간 프레임이 잡힌다
    config.afterScreenUpdates = true
    config.snapshotWidth = NSNumber(value: Double(webView.bounds.width) / 2)
    webView.takeSnapshot(with: config) { image, _ in
      defer { self.inflightSnapshots -= 1 }
      guard let image else { return scheduleNext(self.frameInterval) }
      // 스크롤 위치를 프레임 픽셀 단위로 환산해 동봉한다 (대시보드 로컬 에코용)
      let pixelsPerPoint = (image.size.width * image.scale) / max(1, self.webView.bounds.width)
      self.lastPixelsPerPoint = max(0.1, pixelsPerPoint)
      let scrollY = Int(self.webView.scrollView.contentOffset.y * pixelsPerPoint)
      DispatchQueue.global(qos: .userInitiated).async {
        autoreleasepool {
        guard let jpeg = image.jpegData(compressionQuality: 0.5) else {
          return scheduleNext(self.frameInterval)
        }
        let hash = jpeg.hashValue
        DispatchQueue.main.async {
          if hash == self.lastFrameHash {
            // 변화 없음 — 연속되면 idle 간격으로 CPU를 아낀다
            self.unchangedFrames += 1
            if self.unchangedFrames > 10 { self.frameInterval = self.frameIntervalIdle }
            return scheduleNext(self.frameInterval)
          }
          self.lastFrameHash = hash
          self.unchangedFrames = 0
          self.frameInterval = self.frameIntervalFast
          self.postFrame(jpeg, scrollY: scrollY)
          scheduleNext(self.frameInterval)
          }
        }
      }
    }
  }

  private func postFrame(_ jpeg: Data, scrollY: Int) {
    guard let url = URL(string: controlBase + "/frame?scrollY=\(scrollY)") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = jpeg
    request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
    URLSession.shared.dataTask(with: request).resume()
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
    // 입력이 오면 스트리밍을 즉시 fast로 (반응 지연 방지)
    frameInterval = frameIntervalFast
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
      // 델타는 프레임 px → pt 환산. 좌표가 있으면 그 지점의 내부 스크롤 컨테이너 우선
      let deltaY = CGFloat(command["deltaY"] as? Double ?? 0) / lastPixelsPerPoint
      if let nx = command["x"] as? Double, let ny = command["y"] as? Double {
        let js = """
          (function () {
            let el = document.elementFromPoint(\(nx) * screen.width, \(ny) * screen.height);
            while (el && el !== document.scrollingElement) {
              const s = getComputedStyle(el);
              if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
                el.scrollTop += \(deltaY);
                return true;
              }
              el = el.parentElement;
            }
            return false;
          })();
          """
        webView.evaluateJavaScript(js) { result, _ in
          if (result as? Bool) != true {
            self.setNativeScroll(y: self.webView.scrollView.contentOffset.y + deltaY, animated: false)
          }
        }
      } else {
        setNativeScroll(y: webView.scrollView.contentOffset.y + deltaY, animated: false)
      }
    case "drag":
      // 합성 터치는 WKWebView 네이티브 스크롤을 움직이지 못한다 —
      // 세로 위주 드래그는 scrollBy로 재현하고, 그 외(캐러셀 등)는 pointer 시퀀스로 전달
      let fromX = command["fromX"] as? Double ?? 0
      let fromY = command["fromY"] as? Double ?? 0
      let toX = command["toX"] as? Double ?? 0
      let toY = command["toY"] as? Double ?? 0
      let deltaXPt = CGFloat(toX - fromX) * webView.bounds.width
      let deltaYPt = CGFloat(toY - fromY) * webView.bounds.height
      if abs(deltaYPt) > abs(deltaXPt) * 1.5 {
        // 세로 드래그 = 네이티브 스크롤 감속 재현. UIView.animate는 모델값을 즉시
        // 최종으로 바꿔 스트림에 1프레임만 잡힌다(실측) — 모델값을 직접 스텝한다
        let durationMs = command["durationMs"] as? Double ?? 200
        animateNativeScroll(
          to: webView.scrollView.contentOffset.y - deltaYPt,
          duration: min(0.5, max(0.2, durationMs / 1000 + 0.15)))
        return
      }
      let js = """
        (function () {
          const fx = \(fromX) * screen.width, fy = \(fromY) * screen.height;
          const tx = \(toX) * screen.width, ty = \(toY) * screen.height;
          const dx = tx - fx, dy = ty - fy;
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
    case "pauseFrames": framesPaused = true
    case "reload": webView.reload()
    case "back": webView.goBack()
    case "forward": webView.goForward()
    default: break
    }
  }

  private var scrollAnimationTimer: Timer?

  /** ease-out 스텝 애니메이션 — 매 스텝이 모델 변경이라 프레임 스트림에 그대로 잡힌다 */
  private func animateNativeScroll(to targetY: CGFloat, duration: TimeInterval) {
    scrollAnimationTimer?.invalidate()
    let startY = webView.scrollView.contentOffset.y
    let startTime = Date()
    scrollAnimationTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) {
      timer in
      let progress = min(1, Date().timeIntervalSince(startTime) / duration)
      let eased = 1 - pow(1 - progress, 2)
      self.setNativeScroll(y: startY + (targetY - startY) * CGFloat(eased), animated: false)
      if progress >= 1 { timer.invalidate() }
    }
  }

  /** contentOffset 클램프 + 적용 — 상하 바운스 범위를 넘지 않게 */
  private func setNativeScroll(y: CGFloat, animated: Bool) {
    let sv = webView.scrollView
    let minY = -sv.adjustedContentInset.top
    let maxY = max(minY, sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom)
    let clamped = max(minY, min(maxY, y))
    sv.setContentOffset(CGPoint(x: sv.contentOffset.x, y: clamped), animated: animated)
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
