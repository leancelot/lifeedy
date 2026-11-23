package com.vidaorganizada.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(
    name = "AppHealth",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS }
        ),
        @Permission(
            alias = "camera",
            strings = { Manifest.permission.CAMERA }
        )
    }
)
public class AppHealthPlugin extends Plugin {

    private static final String VAULT_DIR = "vault";
    private static final String VAULT_FILE = "lifeedy_vault.json";
    private static final String VAULT_BAK_FILE = "lifeedy_vault.bak";
    private static final String VAULT_TMP_FILE = "lifeedy_vault.tmp";
    private static final String VAULT_KEYSTORE_ALIAS = "LifeedyVaultAesKey";
    private static final String VAULT_CIPHER_ALG = "AES-256-GCM";
    private static final int GCM_TAG_BITS = 128;
    private static final int MAX_VAULT_BYTES = 16 * 1024 * 1024; // 16 MB safety guard

    private static final String AUTO_BACKUP_PREFS = "lifeedy_auto_backup_prefs";
    private static final String PREF_TREE_URI = "tree_uri";
    private static final String PREF_FOLDER_NAME = "folder_name";
    private static final String PREF_ENC_PASSPHRASE = "encrypted_passphrase";
    private static final String PREF_LAST_SYNCED_AT = "last_synced_at";
    private static final String PREF_LAST_FILE_NAME = "last_file_name";
    private static final String EXPORTS_CACHE_DIR = "exports";
    private static final long EXPORT_CACHE_TTL_MS = 60L * 60L * 1000L; // 1 hour

    private static WeakReference<AppHealthPlugin> sActiveInstance = new WeakReference<>(null);
    private static volatile JSObject sPendingIncomingFile = null;
    private static final ExecutorService sIntentExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        super.load();
        sActiveInstance = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        AppHealthPlugin current = sActiveInstance.get();
        if (current == this) {
            sActiveInstance = new WeakReference<>(null);
        }
        ioExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    public static void handleIncomingIntent(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        Uri uri = null;

        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
            if (uri != null && "com.vidaorganizada.app".equalsIgnoreCase(uri.getScheme())) {
                return;
            }
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = getStreamUriCompat(intent);
        }

        if (uri == null) return;

        final Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;
        final Uri targetUri = uri;

        sIntentExecutor.execute(() -> {
            try {
                ContentResolver resolver = appContext.getContentResolver();
                String mimeType = resolver.getType(targetUri);
                if (mimeType == null) mimeType = "";

                String fileName = "arquivo_recebido";
                long reportedSize = -1L;

                try (Cursor cursor = resolver.query(
                        targetUri,
                        new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
                        null,
                        null,
                        null
                )) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                            String queried = cursor.getString(nameIdx);
                            if (queried != null && !queried.trim().isEmpty()) {
                                fileName = queried.trim();
                            }
                        }
                        if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                            reportedSize = cursor.getLong(sizeIdx);
                        }
                    }
                } catch (Exception ignored) {
                    // fallback to URI last path segment
                    String lastSeg = targetUri.getLastPathSegment();
                    if (lastSeg != null && !lastSeg.trim().isEmpty()) {
                        fileName = lastSeg.trim();
                    }
                }

                if (reportedSize > MAX_VAULT_BYTES) {
                    return;
                }

                String content;
                int totalBytes = 0;
                try (
                    InputStream is = resolver.openInputStream(targetUri);
                    ByteArrayOutputStream baos = new ByteArrayOutputStream()
                ) {
                    if (is == null) return;
                    byte[] buf = new byte[16 * 1024];
                    int read;
                    while ((read = is.read(buf)) != -1) {
                        totalBytes += read;
                        if (totalBytes > MAX_VAULT_BYTES) {
                            return;
                        }
                        baos.write(buf, 0, read);
                    }
                    content = baos.toString(StandardCharsets.UTF_8.name());
                }

                if (content == null || content.trim().isEmpty()) return;

                JSObject payload = new JSObject();
                payload.put("name", fileName);
                payload.put("mimeType", mimeType);
                payload.put("size", totalBytes);
                payload.put("content", content);
                payload.put("receivedAt", System.currentTimeMillis());

                sPendingIncomingFile = payload;
                AppHealthPlugin instance = sActiveInstance.get();
                if (instance != null) {
                    instance.notifyListeners("incomingFileOpened", payload, true);
                }
            } catch (Exception ignored) {
                // Safe ignore malformed external URI
            }
        });
    }

    @SuppressWarnings("deprecation")
    private static Uri getStreamUriCompat(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @PluginMethod
    public void saveVaultBackup(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        final String payloadJson = call.getString("payloadJson", "");
        if (payloadJson == null || payloadJson.trim().isEmpty()) {
            call.reject("Payload vazio para gravação no cofre.");
            return;
        }

        final byte[] plainBytes = payloadJson.getBytes(StandardCharsets.UTF_8);
        if (plainBytes.length > MAX_VAULT_BYTES) {
            call.reject("Tamanho do cofre excedeu o limite seguro.");
            return;
        }

        final Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        ioExecutor.execute(() -> {
            try {
                // Validate JSON integrity before encrypting and writing to disk
                new JSONObject(payloadJson);

                String serializedEnvelope = encryptVaultEnvelope(payloadJson);
                byte[] dataBytes = serializedEnvelope.getBytes(StandardCharsets.UTF_8);

                File vaultDir = new File(appContext.getFilesDir(), VAULT_DIR);
                if (!vaultDir.exists() && !vaultDir.mkdirs()) {
                    throw new IOException("Não foi possível criar diretório do cofre.");
                }

                File tmpFile = new File(vaultDir, VAULT_TMP_FILE);
                File primaryFile = new File(vaultDir, VAULT_FILE);
                File backupFile = new File(vaultDir, VAULT_BAK_FILE);

                try (FileOutputStream fos = new FileOutputStream(tmpFile, false)) {
                    fos.write(dataBytes);
                    fos.getFD().sync();
                }

                if (primaryFile.exists() && primaryFile.length() > 2) {
                    if (backupFile.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        backupFile.delete();
                    }
                    //noinspection ResultOfMethodCallIgnored
                    primaryFile.renameTo(backupFile);
                }

                if (!tmpFile.renameTo(primaryFile)) {
                    throw new IOException("Falha ao concluir gravação atômica do cofre.");
                }

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("bytes", dataBytes.length);
                res.put("encrypted", true);
                res.put("updatedAt", System.currentTimeMillis());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Erro ao salvar cofre nativo: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void loadVaultBackup(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        final Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        ioExecutor.execute(() -> {
            File vaultDir = new File(appContext.getFilesDir(), VAULT_DIR);
            File primaryFile = new File(vaultDir, VAULT_FILE);
            File backupFile = new File(vaultDir, VAULT_BAK_FILE);

            VaultReadResult primaryContent = readValidVaultFile(primaryFile);
            if (primaryContent != null) {
                JSObject res = new JSObject();
                res.put("found", true);
                res.put("source", "primary");
                res.put("bytes", primaryFile.length());
                res.put("encrypted", primaryContent.encrypted);
                res.put("payloadJson", primaryContent.payloadJson);
                call.resolve(res);
                return;
            }

            VaultReadResult backupContent = readValidVaultFile(backupFile);
            if (backupContent != null) {
                JSObject res = new JSObject();
                res.put("found", true);
                res.put("source", "backup");
                res.put("bytes", backupFile.length());
                res.put("encrypted", backupContent.encrypted);
                res.put("payloadJson", backupContent.payloadJson);
                call.resolve(res);
                return;
            }

            JSObject res = new JSObject();
            res.put("found", false);
            res.put("source", "none");
            res.put("bytes", 0);
            res.put("encrypted", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void clearVaultBackup(PluginCall call) {
        Context context = getContext();
        final Context appContext = context != null && context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        ioExecutor.execute(() -> {
            if (appContext != null) {
                File vaultDir = new File(appContext.getFilesDir(), VAULT_DIR);
                deleteQuietly(new File(vaultDir, VAULT_TMP_FILE));
                deleteQuietly(new File(vaultDir, VAULT_FILE));
                deleteQuietly(new File(vaultDir, VAULT_BAK_FILE));
            }
            JSObject res = new JSObject();
            res.put("cleared", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void consumePendingIncomingFile(PluginCall call) {
        JSObject pending = sPendingIncomingFile;
        sPendingIncomingFile = null;
        if (pending == null) {
            JSObject empty = new JSObject();
            empty.put("found", false);
            call.resolve(empty);
            return;
        }
        JSObject res = new JSObject();
        res.put("found", true);
        res.put("name", pending.getString("name", "arquivo"));
        res.put("mimeType", pending.getString("mimeType", ""));
        res.put("size", pending.optLong("size", 0L));
        res.put("content", pending.getString("content", ""));
        res.put("receivedAt", pending.optLong("receivedAt", System.currentTimeMillis()));
        call.resolve(res);
    }

    @PluginMethod
    public void shareTextFile(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        final String rawName = call.getString("fileName", "Lifeedy_Backup.lifeedy");
        final String content = call.getString("content", "");
        final String mimeType = call.getString("mimeType", "application/octet-stream");
        final String chooserTitle = call.getString("chooserTitle", "Compartilhar arquivo");

        if (content == null || content.isEmpty()) {
            call.reject("Conteúdo vazio para compartilhamento.");
            return;
        }

        final String safeName = sanitizeExportFileName(rawName);
        final Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        ioExecutor.execute(() -> {
            try {
                File exportDir = new File(appContext.getCacheDir(), EXPORTS_CACHE_DIR);
                if (!exportDir.exists() && !exportDir.mkdirs()) {
                    throw new IOException("Não foi possível criar diretório temporário de exportação.");
                }
                pruneExpiredExports(exportDir, safeName);

                File outFile = new File(exportDir, safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile, false)) {
                    fos.write(content.getBytes(StandardCharsets.UTF_8));
                    fos.getFD().sync();
                }

                Uri shareUri = FileProvider.getUriForFile(
                        appContext,
                        appContext.getPackageName() + ".fileprovider",
                        outFile
                );

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.setClipData(ClipData.newUri(appContext.getContentResolver(), safeName, shareUri));
                shareIntent.putExtra(Intent.EXTRA_STREAM, shareUri);
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, safeName);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, chooserTitle);
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Activity activity = getActivity();
                if (activity != null && !activity.isFinishing()) {
                    activity.runOnUiThread(() -> activity.startActivity(chooser));
                } else {
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    appContext.startActivity(chooser);
                }

                JSObject res = new JSObject();
                res.put("shared", true);
                res.put("fileName", safeName);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Erro ao compartilhar arquivo: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void pickAutoBackupFolder(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "onPickAutoBackupFolderResult");
    }

    @ActivityCallback
    private void onPickAutoBackupFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject canceled = new JSObject();
            canceled.put("selected", false);
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        Uri treeUri = data.getData();
        int takeFlags = data.getFlags()
                & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (takeFlags == 0) {
            takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        }

        try {
            ContentResolver resolver = context.getContentResolver();
            SharedPreferences prefs = context.getSharedPreferences(AUTO_BACKUP_PREFS, Context.MODE_PRIVATE);
            String previousUriStr = prefs.getString(PREF_TREE_URI, null);
            if (previousUriStr != null && !previousUriStr.equals(treeUri.toString())) {
                releaseSafPermissionQuietly(resolver, Uri.parse(previousUriStr));
            }

            resolver.takePersistableUriPermission(treeUri, takeFlags);
            String folderName = extractReadableTreeFolderName(treeUri);

            prefs.edit()
                    .putString(PREF_TREE_URI, treeUri.toString())
                    .putString(PREF_FOLDER_NAME, folderName)
                    .apply();

            JSObject res = new JSObject();
            res.put("selected", true);
            res.put("folderName", folderName);
            res.put("accessible", hasPersistedWritePermission(resolver, treeUri));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Não foi possível obter permissão persistente na pasta: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getAutoBackupFolderStatus(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(AUTO_BACKUP_PREFS, Context.MODE_PRIVATE);
        String treeUriStr = prefs.getString(PREF_TREE_URI, null);
        String folderName = prefs.getString(PREF_FOLDER_NAME, null);
        String encPass = prefs.getString(PREF_ENC_PASSPHRASE, null);
        long lastSyncedAt = prefs.getLong(PREF_LAST_SYNCED_AT, 0L);
        String lastFileName = prefs.getString(PREF_LAST_FILE_NAME, null);

        boolean configured = treeUriStr != null && !treeUriStr.trim().isEmpty();
        boolean accessible = false;
        if (configured) {
            try {
                accessible = hasPersistedWritePermission(
                        context.getContentResolver(),
                        Uri.parse(treeUriStr)
                );
            } catch (Exception ignored) {
                accessible = false;
            }
        }

        JSObject res = new JSObject();
        res.put("configured", configured);
        res.put("accessible", accessible);
        res.put("folderName", folderName != null ? folderName : "");
        res.put("hasPassphrase", encPass != null && !encPass.trim().isEmpty());
        res.put("lastSyncedAt", lastSyncedAt > 0L ? lastSyncedAt : 0L);
        res.put("lastFileName", lastFileName != null ? lastFileName : "");
        call.resolve(res);
    }

    @PluginMethod
    public void clearAutoBackupFolder(PluginCall call) {
        Context context = getContext();
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(AUTO_BACKUP_PREFS, Context.MODE_PRIVATE);
            String treeUriStr = prefs.getString(PREF_TREE_URI, null);
            if (treeUriStr != null && !treeUriStr.trim().isEmpty()) {
                releaseSafPermissionQuietly(context.getContentResolver(), Uri.parse(treeUriStr));
            }
            boolean clearPassphrase = Boolean.TRUE.equals(call.getBoolean("clearPassphrase", false));
            SharedPreferences.Editor editor = prefs.edit()
                    .remove(PREF_TREE_URI)
                    .remove(PREF_FOLDER_NAME)
                    .remove(PREF_LAST_SYNCED_AT)
                    .remove(PREF_LAST_FILE_NAME);
            if (clearPassphrase) {
                editor.remove(PREF_ENC_PASSPHRASE);
            }
            editor.apply();
        }
        JSObject res = new JSObject();
        res.put("cleared", true);
        call.resolve(res);
    }

    @PluginMethod
    public void saveAutoBackupPassphrase(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        final String passphrase = call.getString("passphrase", "");
        if (passphrase == null || passphrase.trim().length() < 4) {
            call.reject("A senha do backup automático deve ter pelo menos 4 caracteres.");
            return;
        }

        final Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        ioExecutor.execute(() -> {
            try {
                String encrypted = encryptVaultEnvelope(passphrase.trim());
                appContext.getSharedPreferences(AUTO_BACKUP_PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putString(PREF_ENC_PASSPHRASE, encrypted)
                        .apply();

                JSObject res = new JSObject();
                res.put("saved", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Falha ao proteger senha no Keystore Android: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getAutoBackupPassphrase(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        final Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        ioExecutor.execute(() -> {
            SharedPreferences prefs = appContext.getSharedPreferences(AUTO_BACKUP_PREFS, Context.MODE_PRIVATE);
            String encrypted = prefs.getString(PREF_ENC_PASSPHRASE, null);
            if (encrypted == null || encrypted.trim().isEmpty()) {
                JSObject empty = new JSObject();
                empty.put("found", false);
                call.resolve(empty);
                return;
            }

            try {
                String plain = decryptVaultEnvelopeString(encrypted);
                JSObject res = new JSObject();
                res.put("found", true);
                res.put("passphrase", plain);
                call.resolve(res);
            } catch (Exception e) {
                JSObject empty = new JSObject();
                empty.put("found", false);
                call.resolve(empty);
            }
        });
    }

    @PluginMethod
    public void writeAutoBackupFile(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        final String fileName = sanitizeExportFileName(call.getString("fileName", "Lifeedy_AutoBackup.lifeedy"));
        final String content = call.getString("content", "");
        final String mimeType = call.getString("mimeType", "application/octet-stream");
        if (content == null || content.isEmpty()) {
            call.reject("Conteúdo vazio para backup automático.");
            return;
        }

        final byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_VAULT_BYTES) {
            call.reject("Arquivo de backup excedeu o limite seguro.");
            return;
        }

        final Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        ioExecutor.execute(() -> {
            SharedPreferences prefs = appContext.getSharedPreferences(AUTO_BACKUP_PREFS, Context.MODE_PRIVATE);
            String treeUriStr = prefs.getString(PREF_TREE_URI, null);
            if (treeUriStr == null || treeUriStr.trim().isEmpty()) {
                call.reject("Nenhuma pasta configurada para backup automático.");
                return;
            }

            Uri treeUri = Uri.parse(treeUriStr);
            ContentResolver resolver = appContext.getContentResolver();
            if (!hasPersistedWritePermission(resolver, treeUri)) {
                call.reject("Permissão da pasta foi revogada. Selecione a pasta novamente.");
                return;
            }

            try {
                String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
                Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
                Uri existingDocUri = findChildDocumentByName(resolver, treeUri, treeDocId, fileName);

                Uri targetDocUri = existingDocUri;
                boolean wrote = false;

                if (targetDocUri != null) {
                    try (OutputStream os = openTruncatingOutputStream(resolver, targetDocUri)) {
                        if (os != null) {
                            os.write(bytes);
                            os.flush();
                            wrote = true;
                        }
                    } catch (Exception ignored) {
                        // Fallback: delete and recreate if provider rejects truncating mode
                        try {
                            DocumentsContract.deleteDocument(resolver, targetDocUri);
                        } catch (Exception ignoredDelete) {
                            // ignore
                        }
                        targetDocUri = null;
                    }
                }

                if (!wrote) {
                    targetDocUri = DocumentsContract.createDocument(resolver, parentDocUri, mimeType, fileName);
                    if (targetDocUri == null) {
                        throw new IOException("Não foi possível criar o arquivo na pasta selecionada.");
                    }
                    try (OutputStream os = resolver.openOutputStream(targetDocUri, "w")) {
                        if (os == null) {
                            throw new IOException("Fluxo de escrita indisponível para o arquivo.");
                        }
                        os.write(bytes);
                        os.flush();
                    }
                }

                long updatedAt = System.currentTimeMillis();
                prefs.edit()
                        .putLong(PREF_LAST_SYNCED_AT, updatedAt)
                        .putString(PREF_LAST_FILE_NAME, fileName)
                        .apply();

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("fileName", fileName);
                res.put("bytes", bytes.length);
                res.put("updatedAt", updatedAt);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Falha ao gravar backup na pasta: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getAndroidPermissionsStatus(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        boolean notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled();

        boolean exactAlarmsAllowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                exactAlarmsAllowed = alarmManager != null && alarmManager.canScheduleExactAlarms();
            } catch (Exception ignored) {
                exactAlarmsAllowed = false;
            }
        }

        boolean bankListenerEnabled = NotificationManagerCompat.getEnabledListenerPackages(context)
                .contains(context.getPackageName());

        String channel = "githubApk";
        boolean supportsSelfUpdate = true;

        boolean installPackagesAllowed = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                installPackagesAllowed = context.getPackageManager().canRequestPackageInstalls();
            } catch (Exception ignored) {
                installPackagesAllowed = false;
            }
        } else {
            installPackagesAllowed = true;
        }

        String versionName = "1.1.0";
        long versionCode = 1L;
        try {
            PackageInfo info = getPackageInfoCompat(context, context.getPackageName());
            if (info.versionName != null) versionName = info.versionName;
            versionCode = PackageInfoCompat.getLongVersionCode(info);
        } catch (Exception ignored) {
            // keep defaults
        }

        boolean microphoneAllowed = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED;

        boolean cameraAllowed = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED;

        JSObject res = new JSObject();
        res.put("notifications", notificationsEnabled);
        res.put("exactAlarms", exactAlarmsAllowed);
        res.put("microphone", microphoneAllowed);
        res.put("camera", cameraAllowed);
        res.put("bankListener", bankListenerEnabled);
        res.put("installPackages", installPackagesAllowed);
        res.put("supportsSelfUpdate", supportsSelfUpdate);
        res.put("distributionChannel", channel);
        res.put("sdkInt", Build.VERSION.SDK_INT);
        res.put("versionName", versionName);
        res.put("versionCode", versionCode);
        call.resolve(res);
    }

    @PluginMethod
    public void requestAndroidPermission(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        String target = call.getString("target", "");
        if (!"microphone".equals(target) && !"camera".equals(target)) {
            call.reject("Permissão alvo inválida.");
            return;
        }

        String manifestPerm = "microphone".equals(target)
                ? Manifest.permission.RECORD_AUDIO
                : Manifest.permission.CAMERA;

        if (ContextCompat.checkSelfPermission(context, manifestPerm) == PackageManager.PERMISSION_GRANTED
                || getPermissionState(target) == PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("granted", true);
            res.put("state", "granted");
            call.resolve(res);
            return;
        }

        requestPermissionForAlias(target, call, "onMediaPermissionResult");
    }

    @PermissionCallback
    private void onMediaPermissionResult(PluginCall call) {
        Context context = getContext();
        String target = call.getString("target", "");
        String manifestPerm = "microphone".equals(target)
                ? Manifest.permission.RECORD_AUDIO
                : Manifest.permission.CAMERA;

        boolean granted = (context != null &&
                ContextCompat.checkSelfPermission(context, manifestPerm) == PackageManager.PERMISSION_GRANTED)
                || getPermissionState(target) == PermissionState.GRANTED;

        JSObject res = new JSObject();
        res.put("granted", granted);
        res.put("state", granted ? "granted" : "denied");
        call.resolve(res);
    }

    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        String target = call.getString("target", "appDetails");
        Intent intent = buildSettingsIntent(context, target);
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            JSObject res = new JSObject();
            res.put("opened", true);
            res.put("target", target);
            call.resolve(res);
        } catch (Exception primaryErr) {
            try {
                Intent fallback = new Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + context.getPackageName())
                );
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
                JSObject res = new JSObject();
                res.put("opened", true);
                res.put("target", "appDetails");
                call.resolve(res);
            } catch (Exception fallbackErr) {
                call.reject("Não foi possível abrir as configurações do Android.");
            }
        }
    }

    private static Intent buildSettingsIntent(Context context, String target) {
        String pkg = context.getPackageName();
        if ("notifications".equals(target)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                return intent;
            }
        } else if ("exactAlarms".equals(target)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                return new Intent(
                        Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:" + pkg)
                );
            }
        } else if ("bankListener".equals(target)) {
            return new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        } else if ("installPackages".equals(target)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + pkg)
                );
            }
        }
        return new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + pkg)
        );
    }

    private static final class VaultReadResult {
        final String payloadJson;
        final boolean encrypted;

        VaultReadResult(String payloadJson, boolean encrypted) {
            this.payloadJson = payloadJson;
            this.encrypted = encrypted;
        }
    }

    private static synchronized SecretKey getOrCreateVaultSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(VAULT_KEYSTORE_ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(VAULT_KEYSTORE_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore"
        );
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                VAULT_KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private static String encryptVaultEnvelope(String plainJson) throws Exception {
        SecretKey key = getOrCreateVaultSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] cipherBytes = cipher.doFinal(plainJson.getBytes(StandardCharsets.UTF_8));

        JSONObject envelope = new JSONObject();
        envelope.put("v", 1);
        envelope.put("enc", VAULT_CIPHER_ALG);
        envelope.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
        envelope.put("ct", Base64.encodeToString(cipherBytes, Base64.NO_WRAP));
        return envelope.toString();
    }

    private static VaultReadResult readValidVaultFile(File file) {
        if (file == null || !file.exists() || file.length() < 2 || file.length() > (MAX_VAULT_BYTES * 2L)) {
            return null;
        }
        try (
            FileInputStream fis = new FileInputStream(file);
            ByteArrayOutputStream baos = new ByteArrayOutputStream()
        ) {
            byte[] buf = new byte[16 * 1024];
            int read;
            while ((read = fis.read(buf)) != -1) {
                baos.write(buf, 0, read);
            }
            String content = baos.toString(StandardCharsets.UTF_8.name());
            JSONObject obj = new JSONObject(content);

            if (VAULT_CIPHER_ALG.equals(obj.optString("enc")) && obj.has("iv") && obj.has("ct")) {
                String plainJson = decryptVaultEnvelopeString(content);
                new JSONObject(plainJson);
                return new VaultReadResult(plainJson, true);
            }

            // Legacy unencrypted vault fallback (auto-upgraded on next saveVaultBackup)
            return new VaultReadResult(content, false);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String decryptVaultEnvelopeString(String envelopeJson) throws Exception {
        JSONObject obj = new JSONObject(envelopeJson);
        byte[] iv = Base64.decode(obj.getString("iv"), Base64.NO_WRAP);
        byte[] ct = Base64.decode(obj.getString("ct"), Base64.NO_WRAP);
        SecretKey key = getOrCreateVaultSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] plainBytes = cipher.doFinal(ct);
        return new String(plainBytes, StandardCharsets.UTF_8);
    }

    private static boolean hasPersistedWritePermission(ContentResolver resolver, Uri treeUri) {
        if (resolver == null || treeUri == null) return false;
        List<UriPermission> perms = resolver.getPersistedUriPermissions();
        for (UriPermission perm : perms) {
            if (treeUri.equals(perm.getUri()) && perm.isWritePermission()) {
                return true;
            }
        }
        return false;
    }

    private static void releaseSafPermissionQuietly(ContentResolver resolver, Uri treeUri) {
        try {
            resolver.releasePersistableUriPermission(
                    treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) {
            // ignore if already revoked
        }
    }

    private static String extractReadableTreeFolderName(Uri treeUri) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            if (docId != null && !docId.trim().isEmpty()) {
                int colon = docId.indexOf(':');
                String clean = colon >= 0 ? docId.substring(colon + 1) : docId;
                if (!clean.trim().isEmpty()) {
                    return clean.trim();
                }
            }
        } catch (Exception ignored) {
            // fallback below
        }
        return "Pasta selecionada";
    }

    private static Uri findChildDocumentByName(
            ContentResolver resolver,
            Uri treeUri,
            String parentDocId,
            String targetName
    ) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        try (Cursor cursor = resolver.query(
                childrenUri,
                new String[] {
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME
                },
                null,
                null,
                null
        )) {
            if (cursor == null) return null;
            while (cursor.moveToNext()) {
                String docId = cursor.getString(0);
                String name = cursor.getString(1);
                if (targetName.equals(name) && docId != null) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                }
            }
        } catch (Exception ignored) {
            // Some SAF providers do not support child queries; fallback creates file
        }
        return null;
    }

    private static OutputStream openTruncatingOutputStream(ContentResolver resolver, Uri docUri)
            throws Exception {
        try {
            return resolver.openOutputStream(docUri, "rwt");
        } catch (Exception firstErr) {
            return resolver.openOutputStream(docUri, "wt");
        }
    }

    private static String sanitizeExportFileName(String rawName) {
        String base = rawName == null ? "Lifeedy_Backup.lifeedy" : rawName.trim();
        base = base.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (base.isEmpty()) {
            return "Lifeedy_Backup.lifeedy";
        }
        return base;
    }

    private static void pruneExpiredExports(File exportDir, String keepName) {
        if (exportDir == null || !exportDir.isDirectory()) return;
        File[] children = exportDir.listFiles();
        if (children == null) return;
        long cutoffMs = System.currentTimeMillis() - EXPORT_CACHE_TTL_MS;
        for (File child : children) {
            if (child == null || !child.isFile()) continue;
            if (keepName.equals(child.getName()) || child.lastModified() < cutoffMs) {
                deleteQuietly(child);
            }
        }
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo getPackageInfoCompat(Context context, String packageName)
            throws PackageManager.NameNotFoundException {
        PackageManager pm = context.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0));
        }
        return pm.getPackageInfo(packageName, 0);
    }
}
