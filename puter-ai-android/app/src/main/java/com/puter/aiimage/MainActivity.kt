package com.puter.aiimage

import android.app.Dialog
import android.content.ContentValues
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.io.OutputStream
import java.util.Base64

class MainActivity : AppCompatActivity() {
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var assetLoader: WebViewAssetLoader

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val webView = WebView(this)
        setContentView(
            webView,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        webView.settings.javaScriptCanOpenWindowsAutomatically = true
        webView.settings.setSupportMultipleWindows(true)
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ) = assetLoader.shouldInterceptRequest(request.url)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                return try {
                    startActivityForResult(fileChooserParams.createIntent(), REQUEST_FILE_CHOOSER)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback = null
                    false
                }
            }

            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message
            ): Boolean {
                val popupWebView = WebView(this@MainActivity)

                val dialog = Dialog(this@MainActivity)
                dialog.setContentView(
                    popupWebView,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
                dialog.setOnDismissListener { popupWebView.destroy() }
                dialog.show()

                configureWebView(popupWebView)
                popupWebView.webChromeClient = PopupWebChromeClient(dialog)

                (resultMsg.obj as WebView.WebViewTransport).webView = popupWebView
                resultMsg.sendToTarget()
                return true
            }

            override fun onCloseWindow(window: WebView) {
                (window.parent as? ViewGroup)?.removeView(window)
                window.destroy()
            }
        }

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    private fun configureWebView(webView: WebView) {
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        webView.settings.javaScriptCanOpenWindowsAutomatically = true
        webView.settings.setSupportMultipleWindows(true)
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ) = assetLoader.shouldInterceptRequest(request.url)
        }
    }

    private inner class PopupWebChromeClient(private val dialog: Dialog) : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams
        ): Boolean {
            this@MainActivity.filePathCallback?.onReceiveValue(null)
            this@MainActivity.filePathCallback = filePathCallback
            return try {
                startActivityForResult(fileChooserParams.createIntent(), REQUEST_FILE_CHOOSER)
                true
            } catch (_: Exception) {
                this@MainActivity.filePathCallback = null
                false
            }
        }

        override fun onCloseWindow(window: WebView) {
            dialog.dismiss()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode != REQUEST_FILE_CHOOSER) return

        val callback = filePathCallback ?: return
        filePathCallback = null

        val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        callback.onReceiveValue(result)
    }

    private inner class AndroidBridge {
        @JavascriptInterface
        fun saveImage(fileName: String, dataUrlOrBase64: String) {
            val (mimeType, base64) = parseDataUrl(dataUrlOrBase64)
            val safeName = fileName.ifBlank { "image.png" }

            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.RELATIVE_PATH, "Download/PuterAI")
            }

            val resolver = contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return

            var out: OutputStream? = null
            try {
                out = resolver.openOutputStream(uri)
                if (out != null) {
                    val bytes = Base64.getDecoder().decode(base64)
                    out.write(bytes)
                    out.flush()
                }
            } catch (_: Exception) {
                resolver.delete(uri, null, null)
            } finally {
                try {
                    out?.close()
                } catch (_: Exception) {
                }
            }
        }
    }

    private fun parseDataUrl(dataUrlOrBase64: String): Pair<String, String> {
        val trimmed = dataUrlOrBase64.trim()
        if (!trimmed.startsWith("data:", ignoreCase = true)) {
            return Pair("image/png", trimmed)
        }

        val commaIdx = trimmed.indexOf(',')
        if (commaIdx < 0) return Pair("image/png", trimmed)

        val meta = trimmed.substring(5, commaIdx)
        val mimeType = meta.substringBefore(';').ifBlank { "image/png" }
        val base64 = trimmed.substring(commaIdx + 1)
        return Pair(mimeType, base64)
    }

    companion object {
        private const val REQUEST_FILE_CHOOSER = 1001
    }
}
