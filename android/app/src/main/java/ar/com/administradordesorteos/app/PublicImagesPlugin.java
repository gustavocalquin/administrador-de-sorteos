package ar.com.administradordesorteos.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/** Only generated PNGs in our private cache are exposed, with temporary read grants. */
@CapacitorPlugin(name = "PublicImages")
public class PublicImagesPlugin extends Plugin {
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private ArrayList<File> prepared = new ArrayList<>();

    @PluginMethod public void share(PluginCall call) { prepare(call, false); }
    @PluginMethod public void exportImages(PluginCall call) { prepare(call, true); }

    private void prepare(PluginCall call, boolean export) {
        if (!busy.compareAndSet(false, true)) { call.reject("Ya hay una salida en curso."); return; }
        getBridge().execute(() -> {
            ArrayList<File> files = new ArrayList<>();
            try {
                JSArray images = call.getArray("images");
                if (images == null || images.length() == 0 || images.length() > 100) throw new Exception("Seleccioná entre 1 y 100 imágenes.");
                File directory = new File(getContext().getCacheDir(), "public-images");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("No se pudo preparar la carpeta temporal.");
                File[] old = directory.listFiles();
                if (old != null) for (File file : old) {
                    if (file.isFile() && file.getName().matches("sorteo-[a-f0-9-]+-[0-9]{3}\\.png") && System.currentTimeMillis() - file.lastModified() > 7L * 86400000) file.delete();
                }
                String batch = UUID.randomUUID().toString(); long encodedSize = 0;
                for (int i = 0; i < images.length(); i++) {
                    String data = images.getJSONObject(i).getString("dataUrl"); encodedSize += data.length();
                    if (encodedSize > 60000000 || !data.startsWith("data:image/png;base64,iVBORw0KGgo")) throw new Exception("Las imágenes son inválidas o demasiado grandes.");
                    byte[] bytes = Base64.decode(data.substring(22), Base64.DEFAULT);
                    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                    if (bounds.outWidth != 1080 || bounds.outHeight != 1920 || !"image/png".equals(bounds.outMimeType)) throw new Exception("Se esperaba un PNG de 1080 × 1920.");
                    File file = new File(directory, String.format(Locale.ROOT, "sorteo-%s-%03d.png", batch, i + 1)); files.add(file);
                    try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(bytes); }
                }
                prepared = files;
                getActivity().runOnUiThread(() -> {
                    try {
                        if (export) {
                            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            startActivityForResult(call, intent, "folderChosen");
                        } else {
                            ArrayList<Uri> uris = new ArrayList<>();
                            for (File file : prepared) uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file));
                            Intent intent = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
                            intent.setType("image/png");
                            if (uris.size() == 1) intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
                            else intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                            ClipData clip = ClipData.newUri(getContext().getContentResolver(), "Imágenes del sorteo", uris.get(0));
                            for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
                            intent.setClipData(clip); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            getActivity().startActivity(Intent.createChooser(intent, "Compartir sorteo"));
                            busy.set(false); JSObject result = new JSObject(); result.put("opened", true); call.resolve(result);
                        }
                    } catch (Exception e) { busy.set(false); call.reject("No se pudo abrir el selector de Android.", e); }
                });
            } catch (Exception e) {
                for (File file : files) file.delete(); busy.set(false); call.reject(e.getMessage(), e);
            }
        });
    }

    @ActivityCallback private void folderChosen(PluginCall call, ActivityResult activityResult) {
        if (call == null) { busy.set(false); return; }
        Intent data = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            busy.set(false); JSObject result = new JSObject(); result.put("cancelled", true); call.resolve(result); return;
        }
        final Uri tree = data.getData(); final ArrayList<File> files = new ArrayList<>(prepared);
        getBridge().execute(() -> {
            ArrayList<Uri> created = new ArrayList<>();
            try {
                if (files.isEmpty()) throw new Exception("La preparación se interrumpió. Volvé a exportar.");
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                for (File file : files) {
                    Uri uri = DocumentsContract.createDocument(getContext().getContentResolver(), parent, "image/png", file.getName());
                    if (uri == null) throw new Exception("No se pudo crear un archivo en la carpeta elegida.");
                    created.add(uri);
                    try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w"); FileInputStream in = new FileInputStream(file)) {
                        if (out == null) throw new Exception("No se pudo abrir el destino.");
                        byte[] buffer = new byte[16384]; int read;
                        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    }
                }
                JSObject result = new JSObject(); result.put("cancelled", false); result.put("count", files.size()); call.resolve(result);
            } catch (Exception e) {
                boolean partial = false;
                for (Uri uri : created) try { if (!DocumentsContract.deleteDocument(getContext().getContentResolver(), uri)) partial = true; } catch (Exception ignored) { partial = true; }
                call.reject(partial ? "La exportación falló. Pueden quedar archivos incompletos de este intento en la carpeta elegida." : "La exportación falló; no se conservaron archivos de este intento.", e);
            } finally { busy.set(false); }
        });
    }
}
