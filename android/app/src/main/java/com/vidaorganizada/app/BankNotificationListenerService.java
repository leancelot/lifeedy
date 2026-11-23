package com.vidaorganizada.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

public class BankNotificationListenerService extends NotificationListenerService {
    public static final String PREFS_NAME = "vidaorganizada_bank_prefs";
    public static final String KEY_QUEUE = "pending_bank_notifications";
    public static final String KEY_RECENT = "recent_notification_hashes";
    public static final String KEY_CAPTURE_CONFIG = "bank_capture_config_v1";

    private static final int MAX_QUEUE_SIZE = 120;
    private static final long DEDUPE_WINDOW_MS = 90_000L;
    private static final int MAX_TEXT_CHARS = 600;

    private static final Pattern MONEY_PATTERN = Pattern.compile(
            "(?:(?:R\\$|RS|BRL)\\s*|\\bvalor\\s*(?:aproximado\\s*|previsto\\s*|total\\s*)?(?:de|:)?\\s*)\\d+(?:[.,]\\d{1,3})*(?:,\\d{2})?|\\b\\d{1,3}(?:\\.\\d{3})*,\\d{2}\\b",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern WALLET_HINT_PATTERN = Pattern.compile(
            "google\\s*wallet|carteira\\s*do\\s*google|google\\s*pay|gpay|tap\\s*(?:&|and)\\s*pay|por\\s*aproxima[cç][aã]o|contactless|\\b(?:visa|mastercard|elo|amex)\\s*[•*xX]{2,}\\s*\\d{4}",
            Pattern.CASE_INSENSITIVE
    );

    public static final Map<String, String> SUPPORTED_BANKS;
    public static final Map<String, String> WALLET_APPS;
    public static final Map<String, String> SMS_APPS;

    static {
        Map<String, String> banks = new HashMap<>();
        banks.put("com.nu.production", "Nubank");
        banks.put("br.com.intermedium", "Banco Inter");
        banks.put("com.itau", "Itaú");
        banks.put("com.itau.pers", "Itaú Personnalité");
        banks.put("com.itau.empresas", "Itaú Empresas");
        banks.put("com.itau.iti", "iti Itaú");
        banks.put("com.bradesco", "Bradesco");
        banks.put("com.bradesco.prime", "Bradesco Prime");
        banks.put("com.santander.app", "Santander");
        banks.put("br.com.bb.android", "Banco do Brasil");
        banks.put("br.com.gabba.Caixa", "Caixa");
        banks.put("br.com.caixa.tem", "Caixa Tem");
        banks.put("com.c6bank.app", "C6 Bank");
        banks.put("com.picpay", "PicPay");
        banks.put("com.mercadopago.wallet", "Mercado Pago");
        banks.put("com.mercadolibre", "Mercado Livre");
        banks.put("br.com.uol.ps.myaccount", "PagBank");
        banks.put("com.btgpactual.pactualdigital.mobile", "BTG Pactual");
        banks.put("com.btgpactual.banking", "BTG Banking");
        banks.put("br.com.neon", "Neon");
        banks.put("br.com.willbank", "Will Bank");
        banks.put("br.com.bradesco.next", "Next");
        banks.put("br.com.sicredi.app", "Sicredi");
        banks.put("br.com.sicoob.app", "Sicoob");
        banks.put("br.com.cora.app", "Cora");
        banks.put("br.com.xp.carteira", "XP");
        banks.put("br.com.stone.ton", "Ton");
        banks.put("br.com.stone.conta", "Stone");
        banks.put("br.com.ame.digital", "Ame Digital");
        banks.put("br.com.bancopan.app", "Banco Pan");
        banks.put("com.banrisul.app", "Banrisul");
        banks.put("br.com.brb.banco", "BRB");
        banks.put("br.com.safra.safraapp", "Banco Safra");
        banks.put("com.recargapay", "RecargaPay");
        banks.put("com.pay99.wallet", "99Pay");
        SUPPORTED_BANKS = Collections.unmodifiableMap(banks);

        Map<String, String> wallets = new HashMap<>();
        wallets.put("com.google.android.apps.walletnfcrel", "Google Wallet");
        wallets.put("com.google.android.apps.nbu.paisa.user", "Google Pay");
        wallets.put("com.samsung.android.spay", "Samsung Wallet");
        WALLET_APPS = Collections.unmodifiableMap(wallets);

        Map<String, String> sms = new HashMap<>();
        sms.put("com.google.android.apps.messaging", "Mensagens (SMS)");
        sms.put("com.samsung.android.messaging", "Mensagens Samsung (SMS)");
        sms.put("com.android.mms", "Mensagens (SMS)");
        sms.put("com.motorola.messaging", "Mensagens (SMS)");
        sms.put("com.oneplus.mms", "Mensagens (SMS)");
        SMS_APPS = Collections.unmodifiableMap(sms);
    }

    private static final class CaptureDecision {
        final String sourceKind;
        final String sourceLabel;

        CaptureDecision(String sourceKind, String sourceLabel) {
            this.sourceKind = sourceKind;
            this.sourceLabel = sourceLabel;
        }
    }

    private String safeTrim(CharSequence cs) {
        if (cs == null) return "";
        String value = cs.toString().trim();
        if (value.length() > MAX_TEXT_CHARS) {
            return value.substring(0, MAX_TEXT_CHARS);
        }
        return value;
    }

    private JSONObject readCaptureConfig(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_CAPTURE_CONFIG, null);
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private CaptureDecision resolveCaptureDecision(Context context, String packageName, String combinedText) {
        if (packageName == null || packageName.equals(context.getPackageName())) {
            return null;
        }

        JSONObject cfg = readCaptureConfig(context);
        boolean banksEnabled = cfg.optBoolean("captureBanksEnabled", true);
        boolean walletEnabled = cfg.optBoolean("captureWalletEnabled", true);
        boolean smsEnabled = cfg.optBoolean("captureSmsEnabled", true);

        // 1. Check built-in Wallets
        if (WALLET_APPS.containsKey(packageName)) {
            if (!walletEnabled) return null;
            return new CaptureDecision("wallet", WALLET_APPS.get(packageName));
        }

        // Google Play Services sometimes posts Tap & Pay / Google Wallet notifications
        if ("com.google.android.gms".equals(packageName)) {
            if (walletEnabled && WALLET_HINT_PATTERN.matcher(combinedText).find()) {
                return new CaptureDecision("wallet", "Google Wallet");
            }
            return null;
        }

        // 2. Check built-in SMS apps
        if (SMS_APPS.containsKey(packageName)) {
            if (!smsEnabled) return null;
            return new CaptureDecision("sms", SMS_APPS.get(packageName));
        }

        // 3. Check built-in Banks
        if (SUPPORTED_BANKS.containsKey(packageName)) {
            if (!banksEnabled) return null;
            return new CaptureDecision("bank", SUPPORTED_BANKS.get(packageName));
        }

        // 4. Check user-activated manual apps
        JSONArray manualApps = cfg.optJSONArray("manualApps");
        if (manualApps != null) {
            for (int i = 0; i < manualApps.length(); i++) {
                JSONObject appObj = manualApps.optJSONObject(i);
                if (appObj == null) continue;
                String pkg = appObj.optString("packageName", "").trim();
                boolean appEnabled = appObj.optBoolean("enabled", true);
                if (appEnabled && packageName.equals(pkg)) {
                    String label = appObj.optString("label", "").trim();
                    if (label.isEmpty()) label = pkg;
                    return new CaptureDecision("manual_app", label);
                }
            }
        }

        return null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;

        String packageName = sbn.getPackageName();
        if (packageName == null) return;

        Notification notification = sbn.getNotification();
        if ((notification.flags & Notification.FLAG_ONGOING_EVENT) != 0 ||
            (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
            return;
        }

        Bundle extras = notification.extras;
        if (extras == null) return;

        String title = safeTrim(extras.getCharSequence(Notification.EXTRA_TITLE));
        String text = safeTrim(extras.getCharSequence(Notification.EXTRA_TEXT));
        String bigText = safeTrim(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        String subText = safeTrim(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));

        StringBuilder linesBuilder = new StringBuilder();
        CharSequence[] textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (textLines != null && textLines.length > 0) {
            for (CharSequence line : textLines) {
                String cleanLine = safeTrim(line);
                if (!cleanLine.isEmpty()) {
                    if (linesBuilder.length() > 0) linesBuilder.append(" | ");
                    linesBuilder.append(cleanLine);
                }
            }
        }

        String primaryBody = !bigText.isEmpty() ? bigText : (!text.isEmpty() ? text : linesBuilder.toString());
        if (!subText.isEmpty() && !primaryBody.toLowerCase(Locale.ROOT).contains(subText.toLowerCase(Locale.ROOT))) {
            primaryBody = primaryBody.isEmpty() ? subText : (primaryBody + " " + subText);
        }

        String combined = (title + " " + primaryBody).trim();
        if (combined.length() > MAX_TEXT_CHARS) {
            combined = combined.substring(0, MAX_TEXT_CHARS);
        }
        if (combined.isEmpty()) return;

        CaptureDecision decision = resolveCaptureDecision(this, packageName, combined);
        if (decision == null) {
            return;
        }

        if (!MONEY_PATTERN.matcher(combined).find()) {
            return;
        }

        long postTime = sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis();
        String signatureKey = (packageName + "|" + title + "|" + primaryBody).toLowerCase(Locale.ROOT);

        if (isDuplicateRecent(signatureKey, postTime)) {
            return;
        }

        try {
            JSONObject item = new JSONObject();
            item.put("id", "bn-" + UUID.randomUUID().toString());
            item.put("packageName", packageName);
            item.put("bankName", decision.sourceLabel);
            item.put("sourceKind", decision.sourceKind);
            item.put("title", title);
            item.put("text", primaryBody);
            item.put("timestamp", postTime);

            enqueueItem(item);
            BankNotificationPlugin.emitNotificationToJs(item);
        } catch (Exception ignored) {
            // Ignora falhas de serialização silenciosamente
        }
    }

    private synchronized boolean isDuplicateRecent(String signatureKey, long nowMs) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_RECENT, "[]");
        JSONArray updated = new JSONArray();
        boolean found = false;

        try {
            JSONArray existing = new JSONArray(raw);
            for (int i = 0; i < existing.length(); i++) {
                JSONObject entry = existing.optJSONObject(i);
                if (entry == null) continue;
                long ts = entry.optLong("ts", 0L);
                if (nowMs - ts <= DEDUPE_WINDOW_MS) {
                    updated.put(entry);
                    if (signatureKey.equals(entry.optString("key"))) {
                        found = true;
                    }
                }
            }
            if (!found) {
                JSONObject nextEntry = new JSONObject();
                nextEntry.put("key", signatureKey);
                nextEntry.put("ts", nowMs);
                updated.put(nextEntry);
                prefs.edit().putString(KEY_RECENT, updated.toString()).apply();
            }
        } catch (Exception ignored) {
            return false;
        }

        return found;
    }

    private synchronized void enqueueItem(JSONObject item) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_QUEUE, "[]");
        try {
            JSONArray queue = new JSONArray(raw);
            queue.put(item);

            if (queue.length() > MAX_QUEUE_SIZE) {
                JSONArray trimmed = new JSONArray();
                int start = queue.length() - MAX_QUEUE_SIZE;
                for (int i = start; i < queue.length(); i++) {
                    trimmed.put(queue.get(i));
                }
                queue = trimmed;
            }
            prefs.edit().putString(KEY_QUEUE, queue.toString()).apply();
        } catch (Exception ignored) {
            JSONArray fallback = new JSONArray();
            fallback.put(item);
            prefs.edit().putString(KEY_QUEUE, fallback.toString()).apply();
        }
    }
}
