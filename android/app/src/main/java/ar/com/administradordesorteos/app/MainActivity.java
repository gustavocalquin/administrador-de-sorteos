package ar.com.administradordesorteos.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PublicImagesPlugin.class);
        registerPlugin(BackupFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
