"""Comprueba el APK real; no sustituye ejecutar la aplicación en Android."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
APP_ID = 'ar.com.administradordesorteos.app'


def command(tool, *args):
    return subprocess.check_output([str(tool), *map(str, args)], text=True, encoding='utf-8', errors='replace')


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--release', action='store_true', help='Exigir APK firmada y sin depuración')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    require(sdk, 'Falta ANDROID_HOME.')
    build_tools = Path(sdk) / 'build-tools' / '36.0.0'
    aapt = build_tools / ('aapt.exe' if os.name == 'nt' else 'aapt')
    signer = build_tools / ('apksigner.bat' if os.name == 'nt' else 'apksigner')
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8-sig'))
    gradle = (ROOT / 'android/app/build.gradle').read_text(encoding='utf-8')
    version_code = re.search(r'\bversionCode\s+(\d+)', gradle)
    require(version_code, 'Falta versionCode en Gradle.')
    version_code = int(version_code.group(1))
    badging = command(aapt, 'dump', 'badging', args.apk)
    require(f"name='{APP_ID}'" in badging, 'Paquete Android inesperado.')
    require(f"versionName='{package['version']}'" in badging, 'Versión Android/npm distinta.')
    require(f"versionCode='{version_code}'" in badging, 'versionCode inesperado.')
    require("sdkVersion:'24'" in badging and "targetSdkVersion:'36'" in badging, 'SDK inesperado.')
    permissions = re.findall(r"uses-permission(?:-sdk-\d+)?: name='([^']+)'", badging)
    require(set(permissions) <= {APP_ID + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'}, 'Permiso no permitido en APK: ' + ', '.join(permissions))
    manifest = command(aapt, 'dump', 'xmltree', args.apk, 'AndroidManifest.xml')
    for name in ('allowBackup', 'usesCleartextTraffic'):
        require(re.search(r'android:' + name + r'\([^\n]+\)=\(type 0x12\)0x0\b', manifest), name + ' no está deshabilitado.')
    is_debug = 'application-debuggable' in badging
    require(is_debug != args.release, 'Tipo debug/release inesperado.')
    signature = command(signer, 'verify', '--verbose', '--print-certs', args.apk)
    require('Verified using v2 scheme (APK Signature Scheme v2): true' in signature, 'Firma APK v2 ausente.')
    if args.release:
        require('CN=Android Debug' not in signature, 'La distribución no puede usar firma de depuración.')
    checked = []
    with zipfile.ZipFile(args.apk) as apk:
        names = apk.namelist()
        require(not any(n.endswith('.wasm') or 'Diagnostics-' in n for n in names), 'Se empaquetó código de prueba.')
        config = json.loads(apk.read('assets/capacitor.config.json'))
        require(config.get('loggingBehavior') == 'none', 'Registro del bridge habilitado.')
        require(config.get('android', {}).get('webContentsDebuggingEnabled') is False, 'Depuración WebView habilitada.')
        require(not config.get('server', {}).get('url'), 'Servidor externo configurado.')
        dist = ROOT / 'dist'
        require(dist.is_dir(), 'Compilar dist antes de verificar el APK.')
        for path in sorted(dist.rglob('*')):
            if path.is_file():
                relative = path.relative_to(dist).as_posix()
                require(hashlib.sha256(path.read_bytes()).digest() == hashlib.sha256(apk.read('assets/public/' + relative)).digest(), 'Recurso distinto: ' + relative)
                checked.append(relative)
        require(checked, 'dist vacío.')
    report = {
        'apk': args.apk.name, 'version': package['version'], 'versionCode': version_code,
        'kind': 'release firmada' if args.release else 'debug local/CI',
        'bytes': args.apk.stat().st_size, 'sha256': hashlib.sha256(args.apk.read_bytes()).hexdigest(),
        'permissions': permissions, 'matchingWebAssets': checked,
        'signature': signature.strip().splitlines(), 'androidRuntimeTest': 'PENDIENTE',
    }
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + '\n', encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()
