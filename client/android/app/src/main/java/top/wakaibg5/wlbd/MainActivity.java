package top.wakaibg5.wlbd;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

/**
 * 深链入口（三路）：
 * 1) App Links 直链：https://{iot.,}wakaibg5.top/exams/:id（autoVerify，跳板也可用）
 * 2) 跳板 https 直连：https://jump.wakaibg5.top/exam/:id 或 /share/:token
 *    （intent-filter 声明了 jump 整域；用户把 jump 设为默认打开时直接进 APP）
 * 3) 跳板 scheme 唤起：wlbd://exam/:id 或 wlbd://share/:token
 *    （跳板页 jump.html 在 Chrome 里走 intent://…scheme=wlbd 发起）
 * 统一换算成 APP 内路由（/exams/:id、/share/:token、/m/:key）后写入 localStorage，
 * React 路由就绪后读取并跳转（见 App.jsx 的 DeepLinkRedirect）。
 */
public class MainActivity extends BridgeActivity {
  private static final String TAG = "WLBDDeepLink";
  public static final String PENDING_KEY = "wlbd_pending_deeplink";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleDeepLink(getIntent());
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    handleDeepLink(intent);
  }

  private void handleDeepLink(Intent intent) {
    if (intent == null || intent.getData() == null) return;
    Uri data = intent.getData();
    String scheme = data.getScheme() == null ? "" : data.getScheme();
    String host = data.getHost() == null ? "" : data.getHost();
    String path = data.getPath() == null ? "" : data.getPath();

    // 跳转目标换算（只接受自有域 + 白名单路径，防外部链接误导入）：
    //   wlbd://exam/:id 或 jump /exams/:id /exam/:id → /exams/:id
    //   wlbd://share/:token 或 jump /share/:token  → /share/:token
    String target = null;
    if (scheme.equals("wlbd") && (host.equals("exam") || host.equals("share") || host.equals("m"))) {
      // wlbd://exam/:id 里 :id 在 path 上（host 固定为 exam/share）
      String param = (!path.isEmpty() && !path.equals("/")) ? path.replaceFirst("^/", "").split("/")[0] : "";
      if (param.isEmpty()) param = data.getLastPathSegment() == null ? "" : data.getLastPathSegment();
      if (host.equals("m") && isSafeAdminKey(param)) target = "/m/" + param;
      else if (isSafeParam(param)) target = host.equals("exam") ? "/exams/" + param : "/share/" + param;
    } else if (scheme.equals("https") &&
        (host.equals("iot.wakaibg5.top") || host.equals("wakaibg5.top") || host.equals("jump.wakaibg5.top"))) {
      if (path.startsWith("/exams/") || path.startsWith("/exam/") || path.startsWith("/share/") || path.startsWith("/m/")) {
        String[] seg = path.split("/");
        // seg[0]="" seg[1]=exam(s)/share seg[2]=param
        if (seg.length >= 3 && ((seg[1].equals("m") && isSafeAdminKey(seg[2])) || (!seg[1].equals("m") && isSafeParam(seg[2])))) {
          target = seg[1].equals("m") ? "/m/" + seg[2] : (seg[1].startsWith("exam") ? "/exams/" + seg[2] : "/share/" + seg[2]);
          if (data.getQuery() != null) target += "?" + data.getQuery();
        }
      }
    }
    if (target == null) return;
    // super.onCreate 返回后 Capacitor bridge/WebView 已建好；post 到 WebView 线程写 localStorage
    final String finalTarget = target;
    final String jsonSafe = finalTarget
        .replace("\\", "\\\\").replace("'", "\\'").replace("\"", "\\\"")
        .replace("\n", "\\n").replace("\r", "\\r");
    getBridge().getWebView().post(() -> {
      String js = "try{localStorage.setItem('" + PENDING_KEY + "','" + jsonSafe + "');}catch(e){}";
      getBridge().getWebView().evaluateJavascript(js, null);
      Log.i(TAG, "deep link queued: " + finalTarget);
    });
  }

  /** 路径参数白名单：考试 id（ObjectId）/ 分享码（字母数字-_），防 ../ 注入 */
  private static boolean isSafeParam(String p) {
    return p != null && p.matches("[A-Za-z0-9_-]{6,64}");
  }

  private static boolean isSafeAdminKey(String p) {
    return p != null && p.matches("[A-Za-z0-9_-]{24,128}");
  }
}
