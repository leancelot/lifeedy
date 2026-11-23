package com.vidaorganizada.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

public class LifeedyWidgetProvider extends AppWidgetProvider {

    public static final String WIDGET_PREFS = "lifeedy_widget_prefs";
    private static final String PREF_PENDING_TASKS = "pending_tasks_count";
    private static final String PREF_TODAY_EVENTS = "today_events_count";
    private static final String PREF_BALANCE_FORMATTED = "balance_formatted";
    private static final String PREF_HIDE_VALUES = "hide_values";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateSingleWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void saveSummaryAndRefresh(
            Context context,
            int pendingTasksCount,
            int todayEventsCount,
            String balanceFormatted,
            boolean hideValues
    ) {
        if (context == null) return;
        Context appContext = context.getApplicationContext() != null
                ? context.getApplicationContext()
                : context;

        SharedPreferences prefs = appContext.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putInt(PREF_PENDING_TASKS, Math.max(0, pendingTasksCount))
                .putInt(PREF_TODAY_EVENTS, Math.max(0, todayEventsCount))
                .putString(PREF_BALANCE_FORMATTED, balanceFormatted != null && !balanceFormatted.trim().isEmpty()
                        ? balanceFormatted.trim()
                        : "R$ 0,00")
                .putBoolean(PREF_HIDE_VALUES, hideValues)
                .apply();

        updateAllWidgets(appContext);
    }

    public static void updateAllWidgets(Context context) {
        if (context == null) return;
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, LifeedyWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        for (int appWidgetId : ids) {
            updateSingleWidget(context, manager, appWidgetId);
        }
    }

    private static void updateSingleWidget(
            Context context,
            AppWidgetManager appWidgetManager,
            int appWidgetId
    ) {
        SharedPreferences prefs = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE);
        int pendingTasks = Math.max(0, prefs.getInt(PREF_PENDING_TASKS, 0));
        int todayEvents = Math.max(0, prefs.getInt(PREF_TODAY_EVENTS, 0));
        String balance = prefs.getString(PREF_BALANCE_FORMATTED, "R$ 0,00");
        boolean hideValues = prefs.getBoolean(PREF_HIDE_VALUES, false);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_lifeedy);

        String tasksText = pendingTasks + (pendingTasks == 1 ? " tarefa pendente" : " tarefas pendentes");
        String eventsText = todayEvents + (todayEvents == 1 ? " evento hoje" : " eventos hoje");
        String balanceText = hideValues ? "R$ •••••" : balance;

        views.setTextViewText(R.id.widget_tasks_text, tasksText);
        views.setTextViewText(R.id.widget_events_text, eventsText);
        views.setTextViewText(R.id.widget_balance_value, balanceText);

        views.setOnClickPendingIntent(
                R.id.widget_header_container,
                createShortcutPendingIntent(context, 100, "dashboard")
        );
        views.setOnClickPendingIntent(
                R.id.widget_btn_new_tx,
                createShortcutPendingIntent(context, 101, "new-transaction")
        );
        views.setOnClickPendingIntent(
                R.id.widget_btn_scan_qr,
                createShortcutPendingIntent(context, 102, "scan-receipt")
        );
        views.setOnClickPendingIntent(
                R.id.widget_btn_new_task,
                createShortcutPendingIntent(context, 103, "new-task")
        );

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static PendingIntent createShortcutPendingIntent(
            Context context,
            int requestCode,
            String action
    ) {
        Intent intent = new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("com.vidaorganizada.app://shortcut?action=" + action),
                context,
                MainActivity.class
        );
        intent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
