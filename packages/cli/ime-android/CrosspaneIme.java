package dev.crosspane.ime;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.inputmethodservice.InputMethodService;
import android.os.Build;
import android.util.Base64;
import android.view.inputmethod.InputConnection;
import java.nio.charset.StandardCharsets;

/**
 * 무화면 IME — adb `input text`가 못 넣는 비ASCII(한글 등)를 브로드캐스트로 받아
 * 포커스된 입력창에 commit한다. 키보드 UI가 없어 미러링 화면을 가리지 않는다.
 *
 * 사용: adb shell am broadcast -a dev.crosspane.ime.INPUT --es b64 <base64(utf8)>
 * (adb shell 인자의 UTF-8 인코딩이 깨지기 쉬워 base64로 감싼다)
 */
public class CrosspaneIme extends InputMethodService {
  private BroadcastReceiver receiver;

  @Override
  public void onCreate() {
    super.onCreate();
    receiver =
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context context, Intent intent) {
            String b64 = intent.getStringExtra("b64");
            InputConnection ic = getCurrentInputConnection();
            if (b64 == null || ic == null) return;
            String text = new String(Base64.decode(b64, Base64.DEFAULT), StandardCharsets.UTF_8);
            ic.commitText(text, 1);
          }
        };
    IntentFilter filter = new IntentFilter("dev.crosspane.ime.INPUT");
    if (Build.VERSION.SDK_INT >= 33) {
      // API 33+: adb(외부)發 브로드캐스트 수신에는 EXPORTED 명시가 필수
      registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
    } else {
      registerReceiver(receiver, filter);
    }
  }

  @Override
  public void onDestroy() {
    unregisterReceiver(receiver);
    super.onDestroy();
  }

  /** 키보드 UI를 절대 띄우지 않는다 */
  @Override
  public boolean onEvaluateInputViewShown() {
    return false;
  }
}
