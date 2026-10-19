"""Entrega pública por lista explícita: excluye evidencias personales y datos locales."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    '.gitignore', '.gitattributes', 'LICENSE', 'README.md', 'ESPECIFICACION_MAESTRA.md',
    'package.json', 'package-lock.json', 'capacitor.config.ts', 'eslint.config.js',
    'index.html', 'tsconfig.json', 'vite.config.ts',
    'docs/DISTRIBUCION.md', 'docs/PRIVACIDAD.md', 'docs/PRUEBAS_PUBLICACION.md',
    'docs/NOTAS_VERSION.md', 'docs/ICONO.svg', 'docs/FIRMA_ANDROID.md',
    'scripts/android-env.ps1', 'scripts/build-android.ps1', 'scripts/prepare-android.ps1',
    'scripts/install-android-sdk.ps1', 'scripts/verify-apk.py', 'scripts/package-source.py',
]
DIRECTORIES = ['src', 'tests', 'public', '.github/workflows', 'android']
SKIP_PARTS = {'build', '.gradle', '.git', 'node_modules', 'capacitor-cordova-android-plugins', '__pycache__'}


def main():
    files = set(FILES)
    for directory in DIRECTORIES:
        for path in (ROOT / directory).rglob('*'):
            relative = path.relative_to(ROOT)
            if SKIP_PARTS.intersection(relative.parts) or str(relative).replace('\\', '/').startswith('android/app/src/main/assets/'):
                continue
            if path.name in {'local.properties', 'google-services.json', '.DS_Store'}:
                continue
            if path.is_file():
                files.add(relative.as_posix())
    content = {}
    for name in sorted(files):
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT) or not path.is_file():
            raise SystemExit('Ruta no admitida o ausente: ' + name)
        if path.suffix.lower() in {'.jks', '.keystore', '.p12', '.sorteos', '.db', '.sqlite'} or path.name.startswith('.env'):
            raise SystemExit('Archivo privado en fuentes: ' + name)
        content[name] = path.read_bytes()
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in content.items()}
    content['FUENTES_SHA256.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8-sig'))['version']
    output = ROOT / 'artifacts' / f'administrador-sorteos-{version}-fuentes.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in content.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100755 if name == 'android/gradlew' else 0o100644) << 16
            archive.writestr(info, data)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() or any(hashlib.sha256(archive.read(name)).hexdigest() != digest for name, digest in manifest.items()):
            raise SystemExit('No se verificó el archivo de fuentes.')
    print(json.dumps({'file': output.name, 'sourceFiles': len(manifest), 'bytes': output.stat().st_size,
                      'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2))


if __name__ == '__main__':
    main()
