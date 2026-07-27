// CrosspaneShell(Android) — 진짜 Android WebView 컴포넌트로 대상 URL을 로드하는 최소 셸.
// Chrome 브라우저가 아니라 앱 임베드 웹뷰를 재현한다 (wv UA, 브라우저 UI 없음).
// 통신: 명령 롱폴 GET {control}/commands, 이벤트 POST {control}/event
// 입력(터치/키)은 시스템 레벨(motionevent/input)로 이미 들어오므로 셸은 관여하지 않는다.
package dev.crosspane.shell;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
  private WebView webView;
  private String controlBase;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    String url = getIntent().getStringExtra("url");
    controlBase = getIntent().getStringExtra("control");
    if (url == null) url = "about:blank";

    webView = new WebView(this);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    // 앱 웹뷰 기본 UA 그대로 (";  wv)" 토큰 포함) — 재현이 목적이므로 건드리지 않는다

    webView.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onConsoleMessage(ConsoleMessage message) {
        String level = message.messageLevel().name().toLowerCase();
        postEvent(json("kind", "console", "level",
            level.equals("warning") ? "warning" : level, "text", message.message()));
        return true;
      }
    });
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
        postEvent(json("kind", "navigation", "url", url));
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
          postEvent(json("kind", "pageerror", "text",
              "load error: " + error.getDescription() + " (" + request.getUrl() + ")"));
        }
      }
    });
    setContentView(webView);
    webView.loadUrl(url);
    startCommandLoop();
  }

  private void startCommandLoop() {
    new Thread(() -> {
      while (!isFinishing()) {
        try {
          HttpURLConnection conn =
              (HttpURLConnection) new URL(controlBase + "/commands").openConnection();
          conn.setReadTimeout(15000);
          String body = new Scanner(conn.getInputStream(), "UTF-8").useDelimiter("\\A").next();
          JSONArray commands = new JSONArray(body);
          for (int i = 0; i < commands.length(); i++) {
            JSONObject command = commands.getJSONObject(i);
            mainHandler.post(() -> execute(command));
          }
        } catch (Exception e) {
          try { Thread.sleep(500); } catch (InterruptedException ignored) {}
        }
      }
    }).start();
  }

  private void execute(JSONObject command) {
    switch (command.optString("type")) {
      case "navigate": webView.loadUrl(command.optString("url")); break;
      case "reload": webView.reload(); break;
      case "back": if (webView.canGoBack()) webView.goBack(); break;
      case "forward": if (webView.canGoForward()) webView.goForward(); break;
    }
  }

  private JSONObject json(String... pairs) {
    JSONObject object = new JSONObject();
    try {
      for (int i = 0; i + 1 < pairs.length; i += 2) object.put(pairs[i], pairs[i + 1]);
    } catch (Exception ignored) {}
    return object;
  }

  private void postEvent(JSONObject payload) {
    new Thread(() -> {
      try {
        HttpURLConnection conn =
            (HttpURLConnection) new URL(controlBase + "/event").openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = conn.getOutputStream()) {
          out.write(payload.toString().getBytes(StandardCharsets.UTF_8));
        }
        conn.getResponseCode();
      } catch (Exception ignored) {}
    }).start();
  }
}
