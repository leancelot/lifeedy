package com.vidaorganizada.app;

import android.accounts.Account;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONException;

@CapacitorPlugin(name = "NativeGoogleAuth")
public class NativeGoogleAuthPlugin extends Plugin {

    private static final List<String> DEFAULT_SCOPES = Arrays.asList(
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/tasks",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile"
    );

    private ActivityResultLauncher<IntentSenderRequest> authorizationLauncher;
    private String pendingCallId;

    @Override
    public void load() {
        authorizationLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            this::handleAuthorizationActivityResult
        );
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            JSObject res = new JSObject();
            res.put("available", false);
            res.put("statusCode", ConnectionResult.SERVICE_MISSING);
            call.resolve(res);
            return;
        }

        int statusCode = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context);
        JSObject res = new JSObject();
        res.put("available", statusCode == ConnectionResult.SUCCESS);
        res.put("statusCode", statusCode);
        call.resolve(res);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            call.reject("Atividade Android indisponível.", "ACTIVITY_UNAVAILABLE");
            return;
        }

        int playStatus = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity);
        if (playStatus != ConnectionResult.SUCCESS) {
            call.reject(
                "Google Play Services indisponível ou desatualizado neste dispositivo.",
                "PLAY_SERVICES_UNAVAILABLE"
            );
            return;
        }

        boolean silentOnly = Boolean.TRUE.equals(call.getBoolean("silentOnly", false));
        String accountEmail = call.getString("accountEmail", null);
        List<Scope> scopes = parseScopes(call.getArray("scopes"));

        AuthorizationRequest.Builder requestBuilder = AuthorizationRequest.builder()
            .setRequestedScopes(scopes);

        if (accountEmail != null && !accountEmail.trim().isEmpty()) {
            requestBuilder.setAccount(new Account(accountEmail.trim(), "com.google"));
        }

        AuthorizationClient client = Identity.getAuthorizationClient(activity);
        client
            .authorize(requestBuilder.build())
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    if (silentOnly) {
                        JSObject res = new JSObject();
                        res.put("authorized", false);
                        res.put("needsResolution", true);
                        call.resolve(res);
                        return;
                    }

                    PendingIntent pendingIntent = result.getPendingIntent();
                    if (pendingIntent == null) {
                        call.reject("Google não retornou a tela de autorização.", "NO_PENDING_INTENT");
                        return;
                    }

                    if (pendingCallId != null) {
                        PluginCall staleCall = bridge.getSavedCall(pendingCallId);
                        if (staleCall != null) {
                            staleCall.reject("Nova tentativa de login iniciada.", "SUPERSEDED");
                            staleCall.release(bridge);
                        }
                        pendingCallId = null;
                    }

                    pendingCallId = call.getCallbackId();
                    bridge.saveCall(call);

                    activity.runOnUiThread(() -> {
                        try {
                            IntentSenderRequest intentSenderRequest = new IntentSenderRequest.Builder(
                                pendingIntent.getIntentSender()
                            ).build();
                            authorizationLauncher.launch(intentSenderRequest);
                        } catch (Exception e) {
                            PluginCall savedCall = bridge.getSavedCall(pendingCallId);
                            pendingCallId = null;
                            if (savedCall != null) {
                                savedCall.reject(
                                    e.getMessage() != null ? e.getMessage() : "Falha ao abrir autorização Google.",
                                    "LAUNCH_FAILED",
                                    e
                                );
                                savedCall.release(bridge);
                            }
                        }
                    });
                    return;
                }

                resolveAuthorizationResult(call, result);
            })
            .addOnFailureListener(e -> rejectWithGoogleException(call, e));
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        AppCompatActivity activity = getActivity();
        String token = call.getString("token", "");
        if (activity == null || token == null || token.trim().isEmpty()) {
            JSObject res = new JSObject();
            res.put("cleared", false);
            call.resolve(res);
            return;
        }

        ClearTokenRequest request = ClearTokenRequest.builder().setToken(token.trim()).build();
        Identity.getAuthorizationClient(activity)
            .clearToken(request)
            .addOnSuccessListener(unused -> {
                JSObject res = new JSObject();
                res.put("cleared", true);
                call.resolve(res);
            })
            .addOnFailureListener(e -> {
                JSObject res = new JSObject();
                res.put("cleared", false);
                call.resolve(res);
            });
    }

    private void handleAuthorizationActivityResult(ActivityResult activityResult) {
        if (pendingCallId == null) {
            return;
        }

        PluginCall savedCall = bridge.getSavedCall(pendingCallId);
        pendingCallId = null;
        if (savedCall == null) {
            return;
        }

        try {
            if (activityResult.getResultCode() == Activity.RESULT_CANCELED) {
                JSObject res = new JSObject();
                res.put("authorized", false);
                res.put("cancelled", true);
                savedCall.resolve(res);
                return;
            }

            if (activityResult.getData() == null) {
                savedCall.reject("Autorização Google retornou sem dados.", "EMPTY_RESULT");
                return;
            }

            AppCompatActivity activity = getActivity();
            if (activity == null) {
                savedCall.reject("Atividade Android indisponível.", "ACTIVITY_UNAVAILABLE");
                return;
            }

            AuthorizationResult result = Identity.getAuthorizationClient(activity)
                .getAuthorizationResultFromIntent(activityResult.getData());
            resolveAuthorizationResult(savedCall, result);
        } catch (ApiException e) {
            rejectWithGoogleException(savedCall, e);
        } catch (Exception e) {
            savedCall.reject(
                e.getMessage() != null ? e.getMessage() : "Falha ao concluir autorização Google.",
                "AUTH_INTENT_ERROR",
                e
            );
        } finally {
            savedCall.release(bridge);
        }
    }

    private void resolveAuthorizationResult(PluginCall call, AuthorizationResult result) {
        String accessToken = result != null ? result.getAccessToken() : null;
        if (accessToken == null || accessToken.trim().isEmpty()) {
            call.reject("Google não retornou token de acesso.", "MISSING_ACCESS_TOKEN");
            return;
        }

        JSArray grantedScopes = new JSArray();
        if (result.getGrantedScopes() != null) {
            for (String scope : result.getGrantedScopes()) {
                grantedScopes.put(scope);
            }
        }

        JSObject res = new JSObject();
        res.put("authorized", true);
        res.put("accessToken", accessToken);
        res.put("grantedScopes", grantedScopes);
        call.resolve(res);
    }

    private void rejectWithGoogleException(PluginCall call, Exception e) {
        if (e instanceof ApiException) {
            ApiException apiEx = (ApiException) e;
            int statusCode = apiEx.getStatusCode();
            if (statusCode == CommonStatusCodes.CANCELED || statusCode == 12501) {
                JSObject res = new JSObject();
                res.put("authorized", false);
                res.put("cancelled", true);
                call.resolve(res);
                return;
            }
            call.reject(
                apiEx.getMessage() != null ? apiEx.getMessage() : "Erro na API Google Play Services.",
                String.valueOf(statusCode),
                apiEx
            );
            return;
        }

        call.reject(
            e.getMessage() != null ? e.getMessage() : "Falha na autenticação nativa Google.",
            "NATIVE_AUTH_ERROR",
            e
        );
    }

    private List<Scope> parseScopes(JSArray scopesArray) {
        List<Scope> scopes = new ArrayList<>();
        if (scopesArray != null && scopesArray.length() > 0) {
            for (int i = 0; i < scopesArray.length(); i++) {
                try {
                    String scope = scopesArray.getString(i);
                    if (scope != null && !scope.trim().isEmpty()) {
                        scopes.add(new Scope(scope.trim()));
                    }
                } catch (JSONException ignored) {
                    // Skip malformed entries
                }
            }
        }

        if (scopes.isEmpty()) {
            for (String defaultScope : DEFAULT_SCOPES) {
                scopes.add(new Scope(defaultScope));
            }
        }
        return scopes;
    }
}
