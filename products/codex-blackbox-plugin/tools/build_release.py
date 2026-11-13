"""Reproducibly package only runtime plugin resources and a local marketplace."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build():
    manifest = json.loads((ROOT / 'plugin.json').read_text())
    compatibility = json.loads((ROOT / '.codex-plugin/plugin.json').read_text())
    for key in ('name', 'version'):
        if manifest[key] != compatibility[key]:
            raise ValueError(f'Manifests disagree on {key}.')
    files = [ROOT / 'plugin.json', ROOT / '.codex-plugin/plugin.json'] + sorted(
        path for path in (ROOT / 'skills').rglob('*') if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc')
    if any(path.is_symlink() for path in files):
        raise ValueError('Package must not contain symlinks.')
    if sum(path.name == 'SKILL.md' for path in files) != 1:
        raise ValueError('Expected the single blackbox-project skill.')
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    archive = output / f'{manifest["name"]}-{manifest["version"]}.zip'
    for stale in output.glob(f'{manifest["name"]}-*.zip'):
        if stale.name != archive.name:
            stale.unlink()
    entries = []
    marketplace = output / 'marketplace'
    plugin = marketplace / 'plugins' / manifest['name']
    if plugin.exists():
        shutil.rmtree(plugin)
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
        for path in files:
            relative = path.relative_to(ROOT).as_posix()
            contents = path.read_bytes()
            info = zipfile.ZipInfo(relative, date_time=(2026, 11, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            package.writestr(info, contents)
            destination = plugin / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(contents)
            entries.append({'path': relative, 'sha256': hashlib.sha256(contents).hexdigest(), 'bytes': len(contents)})
    catalog = {'name': 'blackbox-local', 'interface': {'displayName': 'BlackBoxApproach Local'}, 'plugins': [{
        'name': manifest['name'], 'source': {'source': 'local', 'path': './plugins/' + manifest['name']},
        'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'}, 'category': 'Developer Tools'}]}
    catalog_path = marketplace / '.agents/plugins/marketplace.json'
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps(catalog, indent=2) + '\n')
    metadata = {'name': manifest['name'], 'version': manifest['version'], 'archive': archive.name,
                'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'files': entries}
    (output / 'package-manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
    with zipfile.ZipFile(archive) as package:
        if package.testzip() is not None:
            raise ValueError('ZIP integrity check failed.')
    print(f'Built {archive.name}: {len(files)} runtime files, {archive.stat().st_size:,} bytes')
    return metadata


if __name__ == '__main__':
    build()
