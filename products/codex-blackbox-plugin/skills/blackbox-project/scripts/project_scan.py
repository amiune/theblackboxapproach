"""Inventory project inputs without executing or modifying the target project."""
import hashlib
from pathlib import Path
import os
import subprocess

EXCLUDED_DIRS = {
    '.git', '.svn', '.hg', 'node_modules', 'vendor', 'Pods', '.venv', 'venv',
    '__pycache__', '.build', 'build', 'dist', 'target', '.next', '.nuxt',
    '.cache', '.pytest_cache', '.mypy_cache', 'coverage', '.aws', '.ssh',
}
SECRET_SUFFIXES = {'.pem', '.key', '.p12', '.pfx', '.keystore'}


def is_secret(path):
    name = path.name.lower()
    return (name == '.env' or (name.startswith('.env.') and name not in {'.env.example', '.env.sample', '.env.template'})
            or name in {'auth.json', 'credentials', 'credentials.json', 'id_rsa', 'id_ed25519', '.netrc', '.npmrc', '.pypirc'}
            or path.suffix.lower() in SECRET_SUFFIXES)


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            checksum.update(block)
    return checksum.hexdigest()


def inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def project_roots(project):
    """Include worktrees only when the selected directory is the repository root."""
    root = Path(project).resolve()
    roots = {root}
    try:
        top = subprocess.run(['git', '-C', str(root), 'rev-parse', '--show-toplevel'],
                             capture_output=True, text=True, timeout=10, check=True)
        if Path(top.stdout.strip()).resolve() != root:
            return sorted(map(str, roots))
        result = subprocess.run(['git', '-C', str(root), 'worktree', 'list', '--porcelain', '-z'],
                                capture_output=True, timeout=10, check=True)
        for field in result.stdout.split(b'\0'):
            if field.startswith(b'worktree '):
                roots.add(Path(os.fsdecode(field[9:])).resolve())
    except (OSError, subprocess.SubprocessError):
        pass
    return sorted(map(str, roots))


def inventory(project, output_dir=None, max_bytes=1024 * 1024):
    root = Path(project).resolve()
    if not root.is_dir():
        raise ValueError(f'Project directory does not exist: {root}')
    artifact = Path(output_dir).resolve() if output_dir else root / 'visualization' / 'blackbox'
    if artifact == root or inside(root, artifact):
        raise ValueError('The artifact directory must not contain the project root.')
    candidates, excluded, warnings = [], [], []

    def skip(path, reason):
        excluded.append({'path': path.relative_to(root).as_posix(), 'reason': reason})

    def walk_error(error):
        warnings.append(f'Cannot list {error.filename}: {error.strerror}')

    for folder, dirs, names in os.walk(root, followlinks=False, onerror=walk_error):
        base = Path(folder)
        for name in sorted(dirs[:]):
            path = base / name
            if path.is_symlink() or name in EXCLUDED_DIRS or path == artifact:
                skip(path, 'symlink' if path.is_symlink() else 'generated/dependency/private directory')
                dirs.remove(name)
        dirs.sort()
        for name in sorted(names):
            path = base / name
            if path.is_symlink():
                skip(path, 'symlink')
            elif is_secret(path):
                skip(path, 'secret or credential file')
            elif name in {'.DS_Store', '.git'}:
                skip(path, 'tool metadata')
            else:
                candidates.append(path)
    ignored = set()
    if candidates:
        try:
            result = subprocess.run(['git', '-C', str(root), 'check-ignore', '--stdin', '-z'],
                                    input=b'\0'.join(os.fsencode(str(p)) for p in candidates) + b'\0',
                                    capture_output=True, timeout=20)
            if result.returncode in (0, 1):
                ignored = {os.fsdecode(p) for p in result.stdout.split(b'\0') if p}
            elif (root / '.git').exists():
                warnings.append('Git ignore rules could not be read; standard directory exclusions still apply.')
        except (OSError, subprocess.SubprocessError):
            warnings.append('Git ignore rules unavailable; standard directory exclusions still apply.')
    files = []
    for path in candidates:
        if str(path) in ignored:
            skip(path, 'git ignored')
            continue
        try:
            size = path.stat().st_size
            if size > max_bytes:
                skip(path, f'exceeds {max_bytes} byte inspection limit')
                continue
            raw = path.read_bytes()
            if b'\0' in raw:
                skip(path, 'binary file')
                continue
            try:
                raw.decode('utf-8')
            except UnicodeDecodeError:
                skip(path, 'non-UTF-8 file')
                continue
            files.append({'path': path.relative_to(root).as_posix(), 'bytes': len(raw),
                          'sha256': hashlib.sha256(raw).hexdigest()})
        except OSError as error:
            skip(path, f'unreadable: {error.strerror}')
            warnings.append(f'Could not inspect {path.relative_to(root)}')
    return {'version': 1, 'root': str(root), 'files': files, 'excluded': excluded,
            'warnings': warnings, 'maxFileBytes': max_bytes}
