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

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "OfflineReceiptOcr")
public class OfflineReceiptOcrPlugin extends Plugin {
    private static final int MAX_DIMENSION = 2048;

    private final ExecutorService ocrExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        ocrExecutor.shutdownNow();
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
                decodedBitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.length, decodeOpts);

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
