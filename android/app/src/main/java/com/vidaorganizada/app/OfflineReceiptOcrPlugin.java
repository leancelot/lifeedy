package com.vidaorganizada.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "OfflineReceiptOcr")
public class OfflineReceiptOcrPlugin extends Plugin {
    private static final int MAX_DIMENSION = 2048;
    private static final int SEFAZ_MAX_BYTES = 600 * 1024;
    private static final int SEFAZ_TIMEOUT_MS = 8500;
    private static final int SEFAZ_MAX_REDIRECTS = 3;

    private static final Pattern ALLOWED_GOV_FISCAL_HOST = Pattern.compile(
            "^(?:[a-z0-9-]+\\.)+(?:fazenda|sefaz|sefa|sefin|sef|economia|receita|nfce|nfe|satsp|svrs|svr)[a-z0-9.-]*\\.gov\\.br$",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern GENERIC_GOV_BR_HOST = Pattern.compile(
            "^[a-z0-9.-]+\\.gov\\.br$",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern FISCAL_KEYWORDS_PATTERN = Pattern.compile(
            "nfce|nfe|sefaz|fazenda|sat",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern CHARSET_PATTERN = Pattern.compile(
            "charset\\s*=\\s*[\"']?\\s*([a-zA-Z0-9_-]+)",
            Pattern.CASE_INSENSITIVE
    );

    private final ExecutorService ocrExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService networkExecutor = Executors.newFixedThreadPool(2);

    @Override
    protected void handleOnDestroy() {
        ocrExecutor.shutdownNow();
        networkExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        final String rawBase64 = call.getString("imageBase64", "");
        if (rawBase64 == null || rawBase64.trim().isEmpty()) {
            call.reject("Nenhuma imagem recebida para OCR offline.");
            return;
        }

        ocrExecutor.execute(() -> {
            Bitmap decodedBitmap = null;
            TextRecognizer recognizer = null;
            BarcodeScanner barcodeScanner = null;
            try {
                decodedBitmap = decodeScaledBitmap(rawBase64);
                if (decodedBitmap == null) {
                    call.reject("Não foi possível decodificar a imagem da nota fiscal.");
                    return;
                }

                final Bitmap bitmap = decodedBitmap;
                final InputImage image = InputImage.fromBitmap(bitmap, 0);
                recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                barcodeScanner = BarcodeScanning.getClient(
                        new BarcodeScannerOptions.Builder()
                                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                                .build()
                );

                final TextRecognizer activeRecognizer = recognizer;
                final BarcodeScanner activeScanner = barcodeScanner;

                final Task<Text> textTask = activeRecognizer.process(image);
                final Task<List<Barcode>> barcodeTask = activeScanner.process(image);

                Tasks.whenAllComplete(textTask, barcodeTask)
                        .addOnCompleteListener(allTask -> {
                            try {
                                String recognizedText = "";
                                int blockCount = 0;
                                if (textTask.isSuccessful() && textTask.getResult() != null) {
                                    Text visionText = textTask.getResult();
                                    recognizedText = visionText.getText() != null ? visionText.getText() : "";
                                    blockCount = visionText.getTextBlocks().size();
                                }

                                JSArray qrCodesArray = extractQrArray(barcodeTask);

                                if (!textTask.isSuccessful() && qrCodesArray.length() == 0) {
                                    Exception err = textTask.getException();
                                    call.reject(
                                            "Falha no reconhecimento offline: "
                                                    + (err != null ? err.getMessage() : "erro desconhecido"),
                                            err
                                    );
                                    return;
                                }

                                JSObject result = new JSObject();
                                result.put("text", recognizedText);
                                result.put("blockCount", blockCount);
                                result.put("qrCodes", qrCodesArray);
                                call.resolve(result);
                            } finally {
                                cleanupOcrResources(bitmap, activeRecognizer, activeScanner);
                            }
                        });
            } catch (OutOfMemoryError oom) {
                cleanupOcrResources(decodedBitmap, recognizer, barcodeScanner);
                call.reject("Memória insuficiente ao processar imagem para OCR offline.");
            } catch (Exception e) {
                cleanupOcrResources(decodedBitmap, recognizer, barcodeScanner);
                call.reject("Erro ao preparar imagem para OCR offline: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void recognizeQrCode(PluginCall call) {
        final String rawBase64 = call.getString("imageBase64", "");
        if (rawBase64 == null || rawBase64.trim().isEmpty()) {
            call.reject("Nenhuma imagem recebida para leitura de QR Code.");
            return;
        }

        ocrExecutor.execute(() -> {
            Bitmap decodedBitmap = null;
            BarcodeScanner barcodeScanner = null;
            try {
                decodedBitmap = decodeScaledBitmap(rawBase64);
                if (decodedBitmap == null) {
                    call.reject("Não foi possível decodificar a imagem selecionada.");
                    return;
                }

                final Bitmap bitmap = decodedBitmap;
                final InputImage image = InputImage.fromBitmap(bitmap, 0);
                barcodeScanner = BarcodeScanning.getClient(
                        new BarcodeScannerOptions.Builder()
                                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                                .build()
                );

                final BarcodeScanner activeScanner = barcodeScanner;
                final Task<List<Barcode>> barcodeTask = activeScanner.process(image);
                barcodeTask.addOnCompleteListener(task -> {
                    try {
                        JSArray qrCodesArray = extractQrArray(task);
                        JSObject result = new JSObject();
                        result.put("qrCodes", qrCodesArray);
                        call.resolve(result);
                    } finally {
                        cleanupOcrResources(bitmap, null, activeScanner);
                    }
                });
            } catch (OutOfMemoryError oom) {
                cleanupOcrResources(decodedBitmap, null, barcodeScanner);
                call.reject("Memória insuficiente ao decodificar o QR Code.");
            } catch (Exception e) {
                cleanupOcrResources(decodedBitmap, null, barcodeScanner);
                call.reject("Erro ao decodificar QR Code: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void fetchSefazQrPage(PluginCall call) {
        final String rawUrl = call.getString("url", "");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("URL do QR Code da nota fiscal vazia.");
            return;
        }

        networkExecutor.execute(() -> {
            String trimmedUrl = rawUrl.trim();
            try {
                JSObject result = executeSefazHttpGet(trimmedUrl);
                call.resolve(result);
            } catch (Exception primaryErr) {
                if (trimmedUrl.toLowerCase(Locale.ROOT).startsWith("http://")) {
                    String httpsUrl = "https://" + trimmedUrl.substring(7);
                    if (isAllowedSefazUrl(httpsUrl)) {
                        try {
                            JSObject fallbackResult = executeSefazHttpGet(httpsUrl);
                            call.resolve(fallbackResult);
                            return;
                        } catch (Exception ignored) {
                            // Report primary error below
                        }
                    }
                }
                call.reject("Falha ao consultar portal da SEFAZ: " + primaryErr.getMessage(), primaryErr);
            }
        });
    }

    private JSObject executeSefazHttpGet(String initialUrl) throws Exception {
        HttpURLConnection conn = null;
        String currentUrl = initialUrl;
        java.util.Map<String, String> cookies = new java.util.LinkedHashMap<>();

        try {
            for (int hop = 0; hop <= SEFAZ_MAX_REDIRECTS; hop++) {
                if (!isAllowedSefazUrl(currentUrl)) {
                    throw new IllegalArgumentException(
                            "Apenas URLs oficiais dos portais da Fazenda / SEFAZ (.gov.br) são permitidas."
                    );
                }

                URL url = new URL(currentUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(SEFAZ_TIMEOUT_MS);
                conn.setReadTimeout(SEFAZ_TIMEOUT_MS);
                conn.setRequestMethod("GET");
                conn.setRequestProperty(
                        "User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
                );
                conn.setRequestProperty(
                        "Accept",
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                );
                conn.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9");
                if (!cookies.isEmpty()) {
                    StringBuilder cookieHeader = new StringBuilder();
                    for (java.util.Map.Entry<String, String> entry : cookies.entrySet()) {
                        if (cookieHeader.length() > 0) cookieHeader.append("; ");
                        cookieHeader.append(entry.getKey()).append("=").append(entry.getValue());
                    }
                    conn.setRequestProperty("Cookie", cookieHeader.toString());
                }

                int statusCode = conn.getResponseCode();
                java.util.Map<String, List<String>> headerFields = conn.getHeaderFields();
                if (headerFields != null) {
                    for (java.util.Map.Entry<String, List<String>> entry : headerFields.entrySet()) {
                        if (entry.getKey() != null && "set-cookie".equalsIgnoreCase(entry.getKey()) && entry.getValue() != null) {
                            for (String rawCookie : entry.getValue()) {
                                String pair = rawCookie.split(";", 2)[0];
                                int eq = pair.indexOf('=');
                                if (eq > 0) {
                                    cookies.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
                                }
                            }
                        }
                    }
                }

                if (statusCode >= 300 && statusCode < 400) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.trim().isEmpty() || hop == SEFAZ_MAX_REDIRECTS) {
                        throw new IllegalStateException("Redirecionamento excessivo ou inválido no portal da SEFAZ.");
                    }
                    currentUrl = new URL(url, location).toString();
                    continue;
                }

                String contentType = conn.getContentType();
                InputStream stream = statusCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] bodyBytes = readCappedBytes(stream, SEFAZ_MAX_BYTES);
                String html = decodeHtmlBytes(bodyBytes, contentType);

                JSObject result = new JSObject();
                result.put("statusCode", statusCode);
                result.put("finalUrl", currentUrl);
                result.put("html", html);
                return result;
            }
            throw new IllegalStateException("Não foi possível concluir a consulta no portal da SEFAZ.");
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static boolean isAllowedSefazUrl(String rawUrl) {
        try {
            URL parsed = new URL(rawUrl);
            String protocol = parsed.getProtocol() != null ? parsed.getProtocol().toLowerCase(Locale.ROOT) : "";
            if (!"https".equals(protocol) && !"http".equals(protocol)) {
                return false;
            }
            if (parsed.getUserInfo() != null && !parsed.getUserInfo().isEmpty()) {
                return false;
            }
            int port = parsed.getPort();
            if (port != -1 && port != 80 && port != 443) {
                return false;
            }
            String host = parsed.getHost() != null ? parsed.getHost().toLowerCase(Locale.ROOT) : "";
            if (host.isEmpty()
                    || "localhost".equals(host)
                    || host.endsWith(".local")
                    || host.endsWith(".internal")
                    || host.matches("^\\d{1,3}(?:\\.\\d{1,3}){3}$")
                    || host.contains(":")) {
                return false;
            }
            return ALLOWED_GOV_FISCAL_HOST.matcher(host).matches()
                    || (GENERIC_GOV_BR_HOST.matcher(host).matches()
                    && FISCAL_KEYWORDS_PATTERN.matcher(rawUrl).find());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static byte[] readCappedBytes(InputStream stream, int maxBytes) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while (total < maxBytes && (read = in.read(buffer, 0, Math.min(buffer.length, maxBytes - total))) != -1) {
                out.write(buffer, 0, read);
                total += read;
            }
            return out.toByteArray();
        }
    }

    private static String decodeHtmlBytes(byte[] bytes, String contentType) {
        if (bytes == null || bytes.length == 0) return "";
        String charsetName = "";
        if (contentType != null) {
            Matcher m = CHARSET_PATTERN.matcher(contentType);
            if (m.find()) {
                charsetName = m.group(1);
            }
        }
        if (charsetName == null || charsetName.isEmpty()) {
            int headLen = Math.min(bytes.length, 2048);
            String head = new String(bytes, 0, headLen, StandardCharsets.ISO_8859_1);
            Matcher metaMatcher = CHARSET_PATTERN.matcher(head);
            if (metaMatcher.find()) {
                charsetName = metaMatcher.group(1);
            }
        }

        Charset targetCharset = StandardCharsets.UTF_8;
        if (charsetName != null && !charsetName.isEmpty()) {
            String lower = charsetName.toLowerCase(Locale.ROOT);
            if ("iso-8859-1".equals(lower) || "latin1".equals(lower)) {
                targetCharset = StandardCharsets.ISO_8859_1;
            } else if ("windows-1252".equals(lower)) {
                try {
                    targetCharset = Charset.forName("windows-1252");
                } catch (Exception ignored) {
                    targetCharset = StandardCharsets.ISO_8859_1;
                }
            } else {
                try {
                    targetCharset = Charset.forName(charsetName);
                } catch (Exception ignored) {
                    targetCharset = StandardCharsets.UTF_8;
                }
            }
        }
        return new String(bytes, targetCharset);
    }

    private static Bitmap decodeScaledBitmap(String rawBase64) {
        int commaIdx = rawBase64.indexOf(',');
        String cleanBase64 = commaIdx != -1 ? rawBase64.substring(commaIdx + 1) : rawBase64;
        byte[] decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT);

        BitmapFactory.Options boundsOpts = new BitmapFactory.Options();
        boundsOpts.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.length, boundsOpts);

        int sampleSize = 1;
        int width = boundsOpts.outWidth;
        int height = boundsOpts.outHeight;
        while ((width / sampleSize) > MAX_DIMENSION || (height / sampleSize) > MAX_DIMENSION) {
            sampleSize *= 2;
        }

        BitmapFactory.Options decodeOpts = new BitmapFactory.Options();
        decodeOpts.inSampleSize = sampleSize;
        return BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.length, decodeOpts);
    }

    private static JSArray extractQrArray(Task<List<Barcode>> barcodeTask) {
        Set<String> uniqueQr = new LinkedHashSet<>();
        if (barcodeTask.isSuccessful() && barcodeTask.getResult() != null) {
            for (Barcode barcode : barcodeTask.getResult()) {
                if (barcode == null) continue;
                String rawValue = barcode.getRawValue();
                if (rawValue != null && !rawValue.trim().isEmpty()) {
                    uniqueQr.add(rawValue.trim());
                }
            }
        }
        JSArray qrCodesArray = new JSArray();
        for (String qr : uniqueQr) {
            qrCodesArray.put(qr);
        }
        return qrCodesArray;
    }

    private static void cleanupOcrResources(
            Bitmap bitmap,
            TextRecognizer recognizer,
            BarcodeScanner barcodeScanner
    ) {
        if (bitmap != null && !bitmap.isRecycled()) {
            bitmap.recycle();
        }
        if (recognizer != null) {
            try {
                recognizer.close();
            } catch (Exception ignored) {
                // Safe close guard
            }
        }
        if (barcodeScanner != null) {
            try {
                barcodeScanner.close();
            } catch (Exception ignored) {
                // Safe close guard
            }
        }
    }
}
