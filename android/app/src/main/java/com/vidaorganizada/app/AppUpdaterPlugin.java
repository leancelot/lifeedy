package com.vidaorganizada.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String PREFS_NAME = "VidaOrganizadaUpdaterPrefs";
    private static final String KEY_PENDING_APK_PATH = "pending_apk_path";
    private static final String UPDATES_DIR = "updates";
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int MAX_REDIRECTS = 8;

    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);

    @Override
    protected void handleOnDestroy() {
        downloadExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getInstalledAppInfo(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }
        try {
            PackageInfo info = getPackageInfoCompat(context, context.getPackageName());
            String channel = BuildConfig.DISTRIBUTION_CHANNEL != null
                ? BuildConfig.DISTRIBUTION_CHANNEL
                : "githubApk";
            JSObject res = new JSObject();
            res.put("packageName", context.getPackageName());
            res.put("versionName", info.versionName != null ? info.versionName : "1.0.0");
            res.put("versionCode", PackageInfoCompat.getLongVersionCode(info));
            res.put("distributionChannel", channel);
            res.put("supportsSelfUpdate", "githubApk".equals(channel));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Não foi possível ler a versão instalada: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openPlayStoreListing(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }
        String pkg = context.getPackageName();
        try {
            Intent marketIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
            marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(marketIntent);
            JSObject res = new JSObject();
            res.put("opened", true);
            call.resolve(res);
        } catch (Exception ignored) {
            try {
                Intent webIntent = new Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)
                );
                webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(webIntent);
                JSObject res = new JSObject();
                res.put("opened", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Não foi possível abrir a página na Play Store.");
            }
        }
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        Context context = getContext();
        boolean supportsSelf = "githubApk".equals(BuildConfig.DISTRIBUTION_CHANNEL);
        boolean canInstall = supportsSelf && canInstallPackages(context);
        JSObject res = new JSObject();
        res.put("canInstall", canInstall);
        res.put("supportsSelfUpdate", supportsSelf);
        res.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(res);
    }

    @PluginMethod
    public void openInstallUnknownAppsSettings(PluginCall call) {
        Context context = getContext();
        Activity activity = getActivity();
        if (context == null || activity == null) {
            call.reject("Atividade Android indisponível.");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                JSObject res = new JSObject();
                res.put("opened", true);
                call.resolve(res);
                return;
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_SECURITY_SETTINGS);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(fallback);
                    JSObject res = new JSObject();
                    res.put("opened", true);
                    call.resolve(res);
                    return;
                } catch (Exception ignored) {
                    call.reject("Não foi possível abrir as configurações de instalação.");
                    return;
                }
            }
        }

        JSObject res = new JSObject();
        res.put("opened", false);
        call.resolve(res);
    }

    @PluginMethod
    public void hasPendingApk(PluginCall call) {
        Context context = getContext();
        File pending = getValidPendingApk(context);
        JSObject res = new JSObject();
        if (pending != null) {
            PackageInfo archiveInfo = getArchivePackageInfo(context, pending);
            res.put("hasPending", true);
            res.put("fileName", pending.getName());
            res.put("fileSize", pending.length());
            if (archiveInfo != null) {
                res.put("versionName", archiveInfo.versionName != null ? archiveInfo.versionName : "");
                res.put("versionCode", PackageInfoCompat.getLongVersionCode(archiveInfo));
            }
        } else {
            res.put("hasPending", false);
        }
        call.resolve(res);
    }

    @PluginMethod
    public void installPendingApk(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }
        File pending = getValidPendingApk(context);
        if (pending == null) {
            JSObject res = new JSObject();
            res.put("status", "missing");
            call.resolve(res);
            return;
        }
        if (!canInstallPackages(context)) {
            JSObject res = new JSObject();
            res.put("status", "permission_required");
            call.resolve(res);
            return;
        }
        try {
            launchInstaller(context, pending);
            JSObject res = new JSObject();
            res.put("status", "installer_launched");
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Erro ao abrir o instalador do Android: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearPendingApk(PluginCall call) {
        Context context = getContext();
        if (context != null) {
            clearUpdatesDirectory(context);
            savePendingApkPath(context, null);
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        if (!"githubApk".equals(BuildConfig.DISTRIBUTION_CHANNEL)) {
            call.reject("Esta versão foi distribuída pela Google Play Store e deve ser atualizada pela loja.");
            return;
        }

        String downloadUrl = call.getString("url", "").trim();
        String token = call.getString("token", "").trim();
        String requestedName = call.getString("fileName", "Lifeedy-update.apk").trim();
        String expectedSha256 = call.getString("expectedSha256", "").trim().toLowerCase(Locale.ROOT);

        if (downloadUrl.isEmpty()) {
            call.reject("URL de download da atualização não informada.");
            return;
        }

        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        if (!isDownloading.compareAndSet(false, true)) {
            call.reject("Já existe um download de atualização em andamento.");
            return;
        }

        downloadExecutor.execute(() -> {
            try {
                File updatesDir = new File(context.getFilesDir(), UPDATES_DIR);
                if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                    throw new IOException("Não foi possível preparar a pasta de atualização.");
                }
                clearUpdatesDirectory(context);
                savePendingApkPath(context, null);

                String safeName = sanitizeFileName(requestedName);
                File downloadedFile = new File(updatesDir, safeName);

                emitProgress("downloading", 0, 0L, 0L);
                downloadWithRedirects(downloadUrl, token, downloadedFile);

                File apkFile = resolveApkFromDownloadedFile(context, downloadedFile, updatesDir);

                emitProgress("verifying", 96, apkFile.length(), apkFile.length());
                PackageInfo archiveInfo = getArchivePackageInfo(context, apkFile);
                if (archiveInfo == null) {
                    throw new IOException("O arquivo baixado não é um pacote APK válido.");
                }
                if (!context.getPackageName().equals(archiveInfo.packageName)) {
                    throw new IOException(
                        "Pacote incompatível (" + archiveInfo.packageName + "). Esperado: " + context.getPackageName()
                    );
                }

                String actualSha256 = computeSha256(apkFile);
                if (!expectedSha256.isEmpty() && !expectedSha256.equals(actualSha256)) {
                    throw new IOException("Falha na verificação de integridade SHA-256 do APK baixado.");
                }

                long installedVersionCode = 0L;
                try {
                    PackageInfo currentInfo = getPackageInfoCompat(context, context.getPackageName());
                    installedVersionCode = PackageInfoCompat.getLongVersionCode(currentInfo);
                } catch (Exception ignored) {
                    // Proceed cleanly if installed package info lookup fails
                }

                long archiveVersionCode = PackageInfoCompat.getLongVersionCode(archiveInfo);
                if (installedVersionCode > 0L && archiveVersionCode < installedVersionCode) {
                    throw new IOException(
                        "O APK baixado (build #" + archiveVersionCode + ") é mais antigo que o instalado (#" + installedVersionCode + ")."
                    );
                }

                savePendingApkPath(context, apkFile.getAbsolutePath());
                String archiveVersionName = archiveInfo.versionName != null ? archiveInfo.versionName : "";

                if (!canInstallPackages(context)) {
                    JSObject res = new JSObject();
                    res.put("status", "permission_required");
                    res.put("versionName", archiveVersionName);
                    res.put("versionCode", archiveVersionCode);
                    res.put("fileSize", apkFile.length());
                    res.put("sha256", actualSha256);
                    call.resolve(res);
                    return;
                }

                emitProgress("installing", 100, apkFile.length(), apkFile.length());
                launchInstaller(context, apkFile);

                JSObject res = new JSObject();
                res.put("status", "installer_launched");
                res.put("versionName", archiveVersionName);
                res.put("versionCode", archiveVersionCode);
                res.put("fileSize", apkFile.length());
                res.put("sha256", actualSha256);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Falha ao baixar atualização.");
            } finally {
                isDownloading.set(false);
            }
        });
    }

    private void downloadWithRedirects(String initialUrl, String token, File targetFile) throws IOException {
        String currentUrl = initialUrl;
        HttpURLConnection conn = null;

        for (int redirectCount = 0; redirectCount < MAX_REDIRECTS; redirectCount++) {
            URL url = new URL(currentUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestProperty("User-Agent", "Lifeedy-Android-Updater");

            String host = url.getHost() != null ? url.getHost().toLowerCase(Locale.ROOT) : "";
            boolean isGitHubHost = host.equals("api.github.com") || host.equals("github.com");

            if (isGitHubHost && host.equals("api.github.com") && currentUrl.contains("/releases/assets/")) {
                conn.setRequestProperty("Accept", "application/octet-stream");
            }
            if (isGitHubHost && token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }

            int code = conn.getResponseCode();
            if (
                code == HttpURLConnection.HTTP_MOVED_PERM ||
                code == HttpURLConnection.HTTP_MOVED_TEMP ||
                code == HttpURLConnection.HTTP_SEE_OTHER ||
                code == 307 ||
                code == 308
            ) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new IOException("Redirecionamento inválido ao baixar o APK.");
                }
                currentUrl = new URL(url, location).toString();
                continue;
            }

            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new IOException("Servidor retornou erro HTTP " + code + " ao baixar atualização.");
            }

            long totalBytes = conn.getContentLengthLong();
            try (
                InputStream in = new BufferedInputStream(conn.getInputStream(), 32 * 1024);
                FileOutputStream out = new FileOutputStream(targetFile)
            ) {
                byte[] buffer = new byte[32 * 1024];
                long downloaded = 0L;
                int lastPercent = -1;
                long lastEmitMs = 0L;
                int bytesRead;

                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                    downloaded += bytesRead;

                    int percent = totalBytes > 0
                        ? (int) Math.min(92L, (downloaded * 92L) / totalBytes)
                        : 0;
                    long now = SystemClock.uptimeMillis();
                    if (percent != lastPercent && (now - lastEmitMs >= 120L || percent - lastPercent >= 3)) {
                        lastPercent = percent;
                        lastEmitMs = now;
                        emitProgress("downloading", percent, downloaded, Math.max(0L, totalBytes));
                    }
                }
                out.flush();
                emitProgress("downloading", 92, downloaded, Math.max(downloaded, totalBytes));
            } finally {
                conn.disconnect();
            }
            return;
        }

        throw new IOException("Excesso de redirecionamentos ao baixar a atualização.");
    }

    private File resolveApkFromDownloadedFile(Context context, File downloadedFile, File updatesDir) throws IOException {
        if (!downloadedFile.exists() || downloadedFile.length() < 1024) {
            throw new IOException("Arquivo baixado está vazio ou incompleto.");
        }

        // First check if the downloaded file is already a valid APK
        if (getArchivePackageInfo(context, downloadedFile) != null) {
            File normalizedApk = downloadedFile.getName().toLowerCase(Locale.ROOT).endsWith(".apk")
                ? downloadedFile
                : new File(updatesDir, "Lifeedy-update.apk");
            if (!normalizedApk.equals(downloadedFile)) {
                if (!downloadedFile.renameTo(normalizedApk)) {
                    throw new IOException("Não foi possível preparar o arquivo APK.");
                }
            }
            return normalizedApk;
        }

        // Otherwise inspect as a .zip artifact (GitHub Actions artifact wrapping the APK)
        emitProgress("extracting", 94, downloadedFile.length(), downloadedFile.length());
        File extractedApk = new File(updatesDir, "Lifeedy-extracted.apk");
        boolean foundApkInZip = false;

        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(downloadedFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String entryName = entry.getName();
                if (entry.isDirectory() || entryName == null || entryName.contains("..")) {
                    continue;
                }
                if (entryName.toLowerCase(Locale.ROOT).endsWith(".apk")) {
                    try (FileOutputStream fos = new FileOutputStream(extractedApk)) {
                        byte[] buf = new byte[32 * 1024];
                        int len;
                        while ((len = zis.read(buf)) != -1) {
                            fos.write(buf, 0, len);
                        }
                        fos.flush();
                    }
                    foundApkInZip = true;
                    break;
                }
            }
        }

        // Remove original zip after extraction
        if (downloadedFile.exists() && !downloadedFile.equals(extractedApk)) {
            //noinspection ResultOfMethodCallIgnored
            downloadedFile.delete();
        }

        if (!foundApkInZip || !extractedApk.exists()) {
            throw new IOException("Nenhum arquivo .apk válido foi encontrado na atualização baixada.");
        }

        return extractedApk;
    }

    private void launchInstaller(Context context, File apkFile) {
        Uri contentUri = FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            apkFile
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> activity.startActivity(intent));
        } else {
            context.startActivity(intent);
        }
    }

    private void emitProgress(String phase, int progress, long downloadedBytes, long totalBytes) {
        JSObject payload = new JSObject();
        payload.put("phase", phase);
        payload.put("progress", progress);
        payload.put("downloadedBytes", downloadedBytes);
        payload.put("totalBytes", totalBytes);
        notifyListeners("updateDownloadProgress", payload, true);
    }

    private static boolean canInstallPackages(Context context) {
        if (context == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                return context.getPackageManager().canRequestPackageInstalls();
            } catch (Exception ignored) {
                return false;
            }
        }
        return true;
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo getPackageInfoCompat(Context context, String packageName) throws PackageManager.NameNotFoundException {
        PackageManager pm = context.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0));
        }
        return pm.getPackageInfo(packageName, 0);
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo getArchivePackageInfo(Context context, File apkFile) {
        if (context == null || apkFile == null || !apkFile.exists()) return null;
        try {
            PackageManager pm = context.getPackageManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), PackageManager.PackageInfoFlags.of(0));
            }
            return pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), 0);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static File getValidPendingApk(Context context) {
        if (context == null) return null;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String path = prefs.getString(KEY_PENDING_APK_PATH, null);
            if (path == null || path.isEmpty()) return null;
            File file = new File(path);
            if (!file.exists() || file.length() < 1024) return null;
            PackageInfo archiveInfo = getArchivePackageInfo(context, file);
            if (archiveInfo == null || !context.getPackageName().equals(archiveInfo.packageName)) {
                return null;
            }
            return file;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void savePendingApkPath(Context context, String path) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            if (path == null || path.isEmpty()) {
                prefs.edit().remove(KEY_PENDING_APK_PATH).apply();
            } else {
                prefs.edit().putString(KEY_PENDING_APK_PATH, path).apply();
            }
        } catch (Exception ignored) {
            // Safe fallback
        }
    }

    private static void clearUpdatesDirectory(Context context) {
        if (context == null) return;
        File dir = new File(context.getFilesDir(), UPDATES_DIR);
        if (!dir.exists() || !dir.isDirectory()) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            //noinspection ResultOfMethodCallIgnored
            child.delete();
        }
    }

    private static String computeSha256(File file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new BufferedInputStream(new FileInputStream(file), 32 * 1024)) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                }
            }
            byte[] hashBytes = digest.digest();
            StringBuilder hex = new StringBuilder(hashBytes.length * 2);
            for (byte b : hashBytes) {
                hex.append(String.format(Locale.ROOT, "%02x", b));
            }
            return hex.toString();
        } catch (IOException ioEx) {
            throw ioEx;
        } catch (Exception e) {
            throw new IOException("Falha ao calcular SHA-256 do APK: " + e.getMessage(), e);
        }
    }

    private static String sanitizeFileName(String raw) {
        String clean = raw.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (clean.isEmpty()) return "Lifeedy-update.apk";
        return clean;
    }
}
