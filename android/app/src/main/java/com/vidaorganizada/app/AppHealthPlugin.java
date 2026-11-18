package com.vidaorganizada.app;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "AppHealth")
public class AppHealthPlugin extends Plugin {

    private static final String VAULT_DIR = "vault";
    private static final String VAULT_FILE = "lifeedy_vault.json";
    private static final String VAULT_BAK_FILE = "lifeedy_vault.bak";
    private static final String VAULT_TMP_FILE = "lifeedy_vault.tmp";
    private static final int MAX_VAULT_BYTES = 16 * 1024 * 1024; // 16 MB safety guard

    @PluginMethod
    public void saveVaultBackup(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        String payloadJson = call.getString("payloadJson", "");
        if (payloadJson == null || payloadJson.trim().isEmpty()) {
            call.reject("Payload vazio para gravação no cofre.");
            return;
        }

        byte[] dataBytes = payloadJson.getBytes(StandardCharsets.UTF_8);
        if (dataBytes.length > MAX_VAULT_BYTES) {
            call.reject("Tamanho do cofre excedeu o limite seguro.");
            return;
        }

        try {
            // Validate JSON integrity before writing to disk
            new JSONObject(payloadJson);

            File vaultDir = new File(context.getFilesDir(), VAULT_DIR);
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
            res.put("updatedAt", System.currentTimeMillis());
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Erro ao salvar cofre nativo: " + e.getMessage());
        }
    }

    @PluginMethod
    public void loadVaultBackup(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        File vaultDir = new File(context.getFilesDir(), VAULT_DIR);
        File primaryFile = new File(vaultDir, VAULT_FILE);
        File backupFile = new File(vaultDir, VAULT_BAK_FILE);

        String primaryContent = readValidJsonFile(primaryFile);
        if (primaryContent != null) {
            JSObject res = new JSObject();
            res.put("found", true);
            res.put("source", "primary");
            res.put("bytes", primaryFile.length());
            res.put("payloadJson", primaryContent);
            call.resolve(res);
            return;
        }

        String backupContent = readValidJsonFile(backupFile);
        if (backupContent != null) {
            JSObject res = new JSObject();
            res.put("found", true);
            res.put("source", "backup");
            res.put("bytes", backupFile.length());
            res.put("payloadJson", backupContent);
            call.resolve(res);
            return;
        }

        JSObject res = new JSObject();
        res.put("found", false);
        res.put("source", "none");
        res.put("bytes", 0);
        call.resolve(res);
    }

    @PluginMethod
    public void clearVaultBackup(PluginCall call) {
        Context context = getContext();
        if (context != null) {
            File vaultDir = new File(context.getFilesDir(), VAULT_DIR);
            deleteQuietly(new File(vaultDir, VAULT_TMP_FILE));
            deleteQuietly(new File(vaultDir, VAULT_FILE));
            deleteQuietly(new File(vaultDir, VAULT_BAK_FILE));
        }
        JSObject res = new JSObject();
        res.put("cleared", true);
        call.resolve(res);
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

        String channel = BuildConfig.DISTRIBUTION_CHANNEL != null
                ? BuildConfig.DISTRIBUTION_CHANNEL
                : "githubApk";
        boolean supportsSelfUpdate = "githubApk".equals(channel);

        boolean installPackagesAllowed = false;
        if (supportsSelfUpdate) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    installPackagesAllowed = context.getPackageManager().canRequestPackageInstalls();
                } catch (Exception ignored) {
                    installPackagesAllowed = false;
                }
            } else {
                installPackagesAllowed = true;
            }
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

        JSObject res = new JSObject();
        res.put("notifications", notificationsEnabled);
        res.put("exactAlarms", exactAlarmsAllowed);
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

    private static String readValidJsonFile(File file) {
        if (file == null || !file.exists() || file.length() < 2 || file.length() > MAX_VAULT_BYTES) {
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
            new JSONObject(content);
            return content;
        } catch (Exception ignored) {
            return null;
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
