package com.mafucai.futuresterminal;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import android.app.Activity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * WebView shell that loads a local HTML bundle from assets and exposes a
 * JavaScript bridge ({@code Android.*}) so the web page can perform direct
 * HTTP requests to third-party data providers (Sina / Eastmoney) without
 * being blocked by browser CORS policies.
 *
 * <p>The JS side wraps the synchronous {@code httpGet*} calls in a Promise,
 * e.g.:
 * <pre>
 *   const httpGet = (url) =&gt; new Promise((res, rej) =&gt; {
 *       try { res(Android.httpGet(url)); } catch (e) { rej(e); }
 *   });
 * </pre>
 *
 * <p><strong>Note:</strong> {@code @JavascriptInterface} methods are invoked on
 * the WebView's private JS thread (not the UI thread), so network I/O performed
 * here does NOT block the UI. The {@code url} is loaded from the main thread
 * via {@code loadUrl} with "javascript:" which runs on the UI thread, but the
 * interface invocation itself is off the main thread.
 */
public class MainActivity extends Activity {

    /** Default browser-ish User-Agent; many finance endpoints reject unknown UAs. */
    private static final String DEFAULT_UA =
            "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    private static final String DEFAULT_REFERER = "https://finance.sina.com.cn/";

    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 15000;

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Expose the native bridge as window.Android.*
        webView.addJavascriptInterface(new HttpBridge(), "Android");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        // Load the placeholder page bundled in assets/.
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /**
     * JavaScript bridge exposed as {@code window.Android}.
     *
     * <p>All methods are synchronous and return the response body as a String
     * (never throw into JS): on failure they return a JSON-ish error string so
     * the Promise wrapper can detect and reject it.
     */
    public class HttpBridge {

        /**
         * GET a URL and return the body decoded as UTF-8.
         *
         * @param url     fully-qualified http(s) URL
         * @param ua      User-Agent header (null / empty -&gt; default)
         * @param referer Referer header (null / empty -&gt; default)
         * @return response body, or a string prefixed with {@code __ERR__} on failure
         */
        @JavascriptInterface
        public String httpGet(String url, String ua, String referer) {
            return request(url, ua, referer, StandardCharsets.UTF_8);
        }

        /** Backward-compatible single-argument overload. */
        @JavascriptInterface
        public String httpGet(String url) {
            return request(url, null, null, StandardCharsets.UTF_8);
        }

        /**
         * GET a URL and return the body decoded as GBK (Sina / some Eastmoney
         * endpoints emit GBK-encoded text). The caller may override UA / Referer.
         *
         * @param url     fully-qualified http(s) URL
         * @param ua      User-Agent header (null / empty -&gt; default)
         * @param referer Referer header (null / empty -&gt; default)
         * @return response body, or a string prefixed with {@code __ERR__} on failure
         */
        @JavascriptInterface
        public String httpGetGbk(String url, String ua, String referer) {
            return request(url, ua, referer, Charset.forName("GBK"));
        }

        /** Backward-compatible single-argument overload. */
        @JavascriptInterface
        public String httpGetGbk(String url) {
            return request(url, null, null, Charset.forName("GBK"));
        }

        /**
         * Full-control variant allowing the caller to supply the User-Agent and
         * Referer headers plus a response charset. Kept for flexibility even
         * though the convenience methods above cover the common cases.
         *
         * @param url      fully-qualified http(s) URL
         * @param userAgent User-Agent header (null / empty -&gt; default)
         * @param referer   Referer header (null / empty -&gt; default)
         * @param charsetName response charset, e.g. "UTF-8" or "GBK"
         */
        @JavascriptInterface
        public String httpGetWithHeaders(String url, String userAgent,
                                         String referer, String charsetName) {
            Charset cs;
            try {
                cs = (charsetName == null || charsetName.isEmpty())
                        ? StandardCharsets.UTF_8
                        : Charset.forName(charsetName);
            } catch (Exception e) {
                cs = StandardCharsets.UTF_8;
            }
            return request(url, userAgent, referer, cs);
        }

        /**
         * Shared synchronous HTTP GET implementation using HttpURLConnection.
         * Returns the body on success, or a string prefixed with {@code __ERR__}
         * on failure so the JS side can detect and reject cleanly.
         */
        private String request(String url, String userAgent, String referer, Charset charset) {
            if (url == null || url.isEmpty()) {
                return "__ERR__empty url";
            }
            String ua = (userAgent == null || userAgent.isEmpty()) ? DEFAULT_UA : userAgent;
            String ref = (referer == null || referer.isEmpty()) ? DEFAULT_REFERER : referer;
            HttpURLConnection conn = null;
            try {
                URL u = new URL(url);
                conn = (HttpURLConnection) u.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", ua);
                conn.setRequestProperty("Referer", ref);
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("Accept-Encoding", "identity"); // no gzip -> easy decode

                int code = conn.getResponseCode();
                InputStream in = (code >= 200 && code < 400)
                        ? conn.getInputStream()
                        : conn.getErrorStream();

                if (in == null) {
                    return "__ERR__no response body (http " + code + ")";
                }

                String body = readFully(in, charset);
                in.close();

                if (code < 200 || code >= 400) {
                    return "__ERR__http " + code;
                }
                return body;

            } catch (Exception e) {
                String msg = e.getMessage();
                return "__ERR__" + (msg == null ? e.getClass().getSimpleName() : msg);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }

        private String readFully(InputStream in, Charset charset) throws Exception {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), charset);
        }
    }
}
