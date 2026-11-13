"""Run actual checks and record their results and explicit verification limits."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
sys.path.insert(0, str(ROOT / 'skills/blackbox-project/scripts'))
import build_demos
import build_release


def run(command, cwd=ROOT):
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    return result.returncode, result.stdout + result.stderr


def fixture_hashes():
    base = ROOT / 'fixtures'
    return {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest() for p in base.rglob('*') if p.is_file()}


def isolated_check(node_modules=None, chrome=None):
    """Verify a copy with no parent repository, legacy app, or sibling product."""
    steps = []
    with tempfile.TemporaryDirectory(prefix='blackbox-isolated-') as temporary:
        isolated = Path(temporary) / 'plugin'
        shutil.copytree(ROOT, isolated, ignore=shutil.ignore_patterns('release', '__pycache__', '*.pyc'))
        commands = [
            ('unitTests', [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v']),
            ('demos', [sys.executable, 'tools/build_demos.py']),
            ('package', [sys.executable, 'tools/build_release.py']),
        ]
        if node_modules:
            commands.append(('browser', ['node', 'tests/browser.cjs', node_modules, chrome]))
        for name, command in commands:
            code, log = run(command, cwd=isolated)
            step = {'name': name, 'status': 'passed' if code == 0 else 'failed'}
            if code:
                step['diagnostic'] = log[-3000:]
            steps.append(step)
            if code:
                break
    return {'status': 'passed' if all(step['status'] == 'passed' for step in steps) else 'failed',
            'parentRepositoryAvailable': False, 'steps': steps}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skill-validator')
    parser.add_argument('--validator-deps', help='Optional temporary Python packages directory for the external validator.')
    parser.add_argument('--node-modules')
    parser.add_argument('--chrome', default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    parser.add_argument('--live-history', action='store_true', help='Initialize Codex and read one project-scoped metadata page, without reading message bodies.')
    parser.add_argument('--isolated', action='store_true', help='Repeat unit, demo, package, and optional browser checks in a standalone copy.')
    parser.add_argument('--visual-reviewed', action='store_true', help='Use only after inspecting the current screenshots.')
    args = parser.parse_args()
    before = fixture_hashes()
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'installation': 'not performed', 'publicDirectoryReview': 'not performed',
              'visualReview': 'reviewed' if args.visual_reviewed else 'pending',
              'limits': ['Semantic analysis is performed by the active Codex session; helpers are not a universal code parser.',
                         'Demo chat ownership is explicitly synthetic; existing YAML provenance is preserved as recorded.',
                         'Unavailable or unverifiable history cannot establish decision ownership.']}
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    code, log = run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'])
    (output / 'unit-checks.log').write_text(log)
    count = re.search(r'Ran (\d+) tests', log)
    report['unitTests'] = {'status': 'passed' if code == 0 else 'failed', 'tests': int(count.group(1)) if count else None}
    print(f'Unit tests: {report["unitTests"]}')
    report['demos'] = build_demos.build()
    report['package'] = build_release.build()
    if args.skill_validator:
        program = ('import runpy,sys; ' + (f'sys.path.insert(0,{args.validator_deps!r}); ' if args.validator_deps else '') +
                   f'sys.argv=[{args.skill_validator!r},{str(ROOT / "skills/blackbox-project")!r}]; ' +
                   f'runpy.run_path({args.skill_validator!r},run_name="__main__")')
        validator_code, log = run([sys.executable, '-c', program])
        report['skillValidator'] = {'status': 'passed' if validator_code == 0 else 'failed', 'output': log.strip()}
    else:
        report['skillValidator'] = {'status': 'not run'}
    if args.node_modules:
        browser_code, log = run(['node', 'tests/browser.cjs', args.node_modules, args.chrome])
        (output / 'browser-checks.log').write_text(log)
        report['browser'] = json.loads((output / 'browser-checks.json').read_text()) if (output / 'browser-checks.json').exists() else {'status': 'failed'}
        if browser_code:
            report['browser']['status'] = 'failed'
        print(f'Browser: {report["browser"]["status"]}')
    else:
        report['browser'] = {'status': 'not run'}
    if args.live_history:
        from codex_history import CodexRpc
        rpc = None
        try:
            rpc = CodexRpc(timeout=10, total_timeout=20)
            result = rpc.call('thread/list', {'cwd': str(WORKSPACE), 'limit': 1, 'useStateDbOnly': True,
                                              'sourceKinds': ['cli', 'vscode', 'appServer']})
            report['liveHistorySmoke'] = {'status': 'passed', 'matchingMetadataRecords': len(result.get('data', [])), 'messageBodiesRead': False}
        except Exception as error:
            report['liveHistorySmoke'] = {'status': 'unavailable', 'reason': str(error)}
        finally:
            if rpc:
                rpc.close()
    else:
        report['liveHistorySmoke'] = {'status': 'not run'}
    report['inputSourcesUnchanged'] = before == fixture_hashes()
    report['isolated'] = isolated_check(args.node_modules, args.chrome) if args.isolated else {'status': 'not run'}
    if not report['inputSourcesUnchanged'] or any(report[key]['status'] == 'failed' for key in ['unitTests', 'skillValidator', 'browser', 'isolated']):
        report['status'] = 'failed'
    (output / 'validation-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Verification: {report["status"]}; report: {output / "validation-report.json"}')
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
