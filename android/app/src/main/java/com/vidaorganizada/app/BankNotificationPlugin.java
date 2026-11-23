package com.vidaorganizada.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(name = "BankNotificationListener")
public class BankNotificationPlugin extends Plugin {
    private static WeakReference<BankNotificationPlugin> activeInstance = new WeakReference<>(null);

    @Override
    public void load() {
        super.load();
        activeInstance = new WeakReference<>(this);
    }

    public static void emitNotificationToJs(JSONObject item) {
        BankNotificationPlugin plugin = activeInstance.get();
        if (plugin == null || item == null) return;
        try {
            JSObject jsItem = JSObject.fromJSONObject(item);
            plugin.notifyListeners("bankNotificationReceived", jsItem);
        } catch (Exception ignored) {
            // Safe fallback when WebView is not active
        }
    }

    @PluginMethod
    public void isPermissionGranted(PluginCall call) {
        Context context = getContext();
        boolean granted = NotificationManagerCompat.getEnabledListenerPackages(context)
                .contains(context.getPackageName());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível abrir as configurações de notificação.", e);
        }
    }

    @PluginMethod
    public void getPendingNotifications(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
                BankNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        String raw = prefs.getString(BankNotificationListenerService.KEY_QUEUE, "[]");
        JSObject ret = new JSObject();
        try {
            JSArray arr = new JSArray(raw);
            ret.put("notifications", arr);
        } catch (Exception e) {
            ret.put("notifications", new JSArray());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void clearPendingNotifications(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
                BankNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
        );

        JSArray idsToRemove = call.getArray("ids");
        if (idsToRemove == null) {
            prefs.edit().putString(BankNotificationListenerService.KEY_QUEUE, "[]").apply();
            call.resolve();
            return;
        }

        Set<String> removeSet = new HashSet<>();
        for (int i = 0; i < idsToRemove.length(); i++) {
            String id = idsToRemove.optString(i, null);
            if (id != null) removeSet.add(id);
        }

        try {
            String raw = prefs.getString(BankNotificationListenerService.KEY_QUEUE, "[]");
            JSONArray existing = new JSONArray(raw);
            JSONArray remaining = new JSONArray();
            for (int i = 0; i < existing.length(); i++) {
                JSONObject item = existing.optJSONObject(i);
                if (item != null && !removeSet.contains(item.optString("id"))) {
                    remaining.put(item);
                }
            }
            prefs.edit().putString(BankNotificationListenerService.KEY_QUEUE, remaining.toString()).apply();
        } catch (Exception ignored) {
            prefs.edit().putString(BankNotificationListenerService.KEY_QUEUE, "[]").apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void getCaptureConfig(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
                BankNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        String raw = prefs.getString(BankNotificationListenerService.KEY_CAPTURE_CONFIG, null);
        JSObject ret = new JSObject();
        try {
            if (raw != null && !raw.trim().isEmpty()) {
                JSONObject parsed = new JSONObject(raw);
                ret.put("captureBanksEnabled", parsed.optBoolean("captureBanksEnabled", true));
                ret.put("captureWalletEnabled", parsed.optBoolean("captureWalletEnabled", true));
                ret.put("captureSmsEnabled", parsed.optBoolean("captureSmsEnabled", true));
                ret.put("captureScheduledMessagesEnabled", parsed.optBoolean("captureScheduledMessagesEnabled", true));
                JSONArray apps = parsed.optJSONArray("manualApps");
                ret.put("manualApps", apps != null ? JSArray.from(apps.toString()) : new JSArray());
                call.resolve(ret);
                return;
            }
        } catch (Exception ignored) {
            // fallback to defaults
        }

        ret.put("captureBanksEnabled", true);
        ret.put("captureWalletEnabled", true);
        ret.put("captureSmsEnabled", true);
        ret.put("captureScheduledMessagesEnabled", true);
        ret.put("manualApps", new JSArray());
        call.resolve(ret);
    }

    @PluginMethod
    public void setCaptureConfig(PluginCall call) {
        try {
            boolean captureBanksEnabled = call.getBoolean("captureBanksEnabled", true);
            boolean captureWalletEnabled = call.getBoolean("captureWalletEnabled", true);
            boolean captureSmsEnabled = call.getBoolean("captureSmsEnabled", true);
            boolean captureScheduledMessagesEnabled = call.getBoolean("captureScheduledMessagesEnabled", true);
            JSArray rawManualApps = call.getArray("manualApps");

            JSONObject stored = new JSONObject();
            stored.put("captureBanksEnabled", captureBanksEnabled);
            stored.put("captureWalletEnabled", captureWalletEnabled);
            stored.put("captureSmsEnabled", captureSmsEnabled);
            stored.put("captureScheduledMessagesEnabled", captureScheduledMessagesEnabled);

            JSONArray sanitizedApps = new JSONArray();
            if (rawManualApps != null) {
                for (int i = 0; i < rawManualApps.length() && i < 80; i++) {
                    JSONObject obj = rawManualApps.optJSONObject(i);
                    if (obj == null) continue;
                    String pkg = obj.optString("packageName", "").trim();
                    if (pkg.isEmpty()) continue;
                    String label = obj.optString("label", pkg).trim();
                    boolean enabled = obj.optBoolean("enabled", true);

                    JSONObject entry = new JSONObject();
                    entry.put("packageName", pkg);
                    entry.put("label", label.isEmpty() ? pkg : label);
                    entry.put("enabled", enabled);
                    sanitizedApps.put(entry);
                }
            }
            stored.put("manualApps", sanitizedApps);

            SharedPreferences prefs = getContext().getSharedPreferences(
                    BankNotificationListenerService.PREFS_NAME,
                    Context.MODE_PRIVATE
            );
            prefs.edit().putString(BankNotificationListenerService.KEY_CAPTURE_CONFIG, stored.toString()).apply();

            JSObject ret = new JSObject();
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Não foi possível salvar configurações de captura.", e);
        }
    }

    @PluginMethod
    public void getInstalledApps(PluginCall call) {
        Context context = getContext();
        PackageManager pm = context.getPackageManager();
        String selfPackage = context.getPackageName();
        Map<String, JSONObject> discovered = new HashMap<>();

        try {
            Intent launcherIntent = new Intent(Intent.ACTION_MAIN, null);
            launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> resolveList = pm.queryIntentActivities(launcherIntent, 0);

            for (ResolveInfo info : resolveList) {
                if (info.activityInfo == null || info.activityInfo.packageName == null) continue;
                String pkg = info.activityInfo.packageName;
                if (pkg.equals(selfPackage) || discovered.containsKey(pkg)) continue;

                CharSequence labelCs = info.loadLabel(pm);
                String label = labelCs != null ? labelCs.toString().trim() : pkg;
                if (label.isEmpty()) label = pkg;

                JSONObject appObj = new JSONObject();
                appObj.put("packageName", pkg);
                appObj.put("label", label);
                appObj.put("isBuiltInBank", BankNotificationListenerService.SUPPORTED_BANKS.containsKey(pkg));
                appObj.put("isWallet", BankNotificationListenerService.WALLET_APPS.containsKey(pkg));
                appObj.put("isSms", BankNotificationListenerService.SMS_APPS.containsKey(pkg));
                discovered.put(pkg, appObj);
            }
        } catch (Exception ignored) {
            // Fallback empty if package query restricted
        }

        List<JSONObject> sorted = new ArrayList<>(discovered.values());
        Collections.sort(sorted, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                String la = a.optString("label", "").toLowerCase(Locale.ROOT);
                String lb = b.optString("label", "").toLowerCase(Locale.ROOT);
                return la.compareTo(lb);
            }
        });

        JSArray appsArray = new JSArray();
        for (JSONObject obj : sorted) {
            appsArray.put(obj);
        }
        JSObject ret = new JSObject();
        ret.put("apps", appsArray);
        call.resolve(ret);
    }
}
