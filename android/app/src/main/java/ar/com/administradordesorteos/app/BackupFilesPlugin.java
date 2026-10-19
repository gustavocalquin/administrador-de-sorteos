package ar.com.administradordesorteos.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "BackupFiles")
public class BackupFilesPlugin extends Plugin {
    private static final int MAX_BYTES = 180 * 1024 * 1024;
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private String pending;

    @PluginMethod public void exportBackup(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("Ya hay un selector abierto."); return; }
        pending = call.getString("file");
        if (pending == null || pending.length() > MAX_BYTES || !pending.startsWith("{\"format\":\"administrador-sorteos-backup\"")) {
            pending = null; busy.set(false); call.reject("Respaldo cifrado inválido."); return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(call, intent, "folderChosen");
        } catch (Exception e) { pending = null; busy.set(false); call.reject("No se pudo abrir el selector de carpeta."); }
    }
    @PluginMethod public void importBackup(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("Ya hay un selector abierto."); return; }
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(call, intent, "fileChosen");
        } catch (Exception e) { busy.set(false); call.reject("No se pudo abrir el selector de archivo."); }
    }
    private Uri selected(ActivityResult result) {
        return result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
    }
    private void cancel(PluginCall call) {
        pending = null; busy.set(false);
        if (call != null) { JSObject result = new JSObject(); result.put("cancelled", true); call.resolve(result); }
    }
    @ActivityCallback private void fileChosen(PluginCall call, ActivityResult activityResult) {
        Uri uri = selected(activityResult);
        if (call == null || uri == null) { cancel(call); return; }
        getBridge().execute(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                if (in == null) throw new Exception();
                byte[] buffer = new byte[16384]; int read; int total = 0;
                while ((read = in.read(buffer)) != -1) {
                    total += read; if (total > MAX_BYTES) throw new Exception(); bytes.write(buffer, 0, read);
                }
                JSObject result = new JSObject(); result.put("cancelled", false);
                result.put("file", bytes.toString(StandardCharsets.UTF_8.name())); call.resolve(result);
            } catch (Exception e) { call.reject("No se pudo leer el archivo o supera 180 MB. Tus datos siguen intactos."); }
            finally { busy.set(false); }
        });
    }
    @ActivityCallback private void folderChosen(PluginCall call, ActivityResult activityResult) {
        Uri tree = selected(activityResult); final String file = pending; pending = null;
        if (call == null || tree == null) { cancel(call); return; }
        getBridge().execute(() -> {
            Uri created = null;
            try {
                if (file == null) throw new Exception();
                byte[] bytes = file.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_BYTES) throw new Exception();
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                String name = "sorteos-" + UUID.randomUUID() + ".sorteos";
                created = DocumentsContract.createDocument(getContext().getContentResolver(), parent, "application/octet-stream", name);
                if (created == null) throw new Exception();
                try (OutputStream out = getContext().getContentResolver().openOutputStream(created, "w")) {
                    if (out == null) throw new Exception(); out.write(bytes); out.flush();
                }
                MessageDigest actual = MessageDigest.getInstance("SHA-256"); int total = 0;
                try (InputStream in = getContext().getContentResolver().openInputStream(created)) {
                    if (in == null) throw new Exception(); byte[] buffer = new byte[16384]; int read;
                    while ((read = in.read(buffer)) != -1) {
                        total += read; if (total > MAX_BYTES) throw new Exception(); actual.update(buffer, 0, read);
                    }
                }
                if (!MessageDigest.isEqual(actual.digest(), MessageDigest.getInstance("SHA-256").digest(bytes))) throw new Exception();
                JSObject result = new JSObject(); result.put("cancelled", false); result.put("name", name); call.resolve(result);
            } catch (Exception e) {
                boolean partial = false;
                if (created != null) try { partial = !DocumentsContract.deleteDocument(getContext().getContentResolver(), created); } catch (Exception ignored) { partial = true; }
                call.reject(partial ? "No se verificó la exportación. Puede quedar un archivo incompleto de este intento." : "No se exportó el respaldo. Los archivos anteriores no se modificaron.");
            } finally { busy.set(false); }
        });
    }
}
