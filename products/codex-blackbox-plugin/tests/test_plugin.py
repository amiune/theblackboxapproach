import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skills/blackbox-project/scripts'))
sys.path.insert(0, str(ROOT / 'tools'))
from codex_history import CodexRpc, RpcError, clean_item, collect_history, history, thread_items
from model_io import ModelError, prepare_model, render_html
from project_scan import inventory, project_roots
from blackbox import main
import build_release
import build_demos


class ProjectCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='blackbox-tests-')
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name) / 'project'
        self.project.mkdir()
        (self.project / 'main.py').write_text('def run(value):\n    return value + 1\n')
        self.model = {'format': 'codex-blackbox', 'version': 1, 'project': {'name': 'Test', 'rootBox': 'run'},
                      'boxes': [{'id': 'run', 'label': 'Run', 'process': 'Increment input.', 'children': [], 'inputs': [], 'outputs': [],
                                 'evidence': 'observed', 'provenance': 'unknown', 'sources': [{'path': 'main.py', 'line': 1}]}],
                      'dataStructures': [], 'decisions': [], 'edges': [], 'coverage': {'files': [{'path': 'main.py', 'status': 'inspected'}]}}
        self.manifest = inventory(self.project)
        self.chats = {'status': 'available', 'warnings': [], 'threads': [{'id': 'thread', 'items': [
            {'id': 'u1', 'turnId': 't1', 'type': 'userMessage', 'role': 'user', 'text': 'Require a positive input.'},
            {'id': 'a1', 'turnId': 't1', 'type': 'agentMessage', 'role': 'assistant', 'text': 'I propose an increment of one.'},
            {'id': 'u2', 'turnId': 't2', 'type': 'userMessage', 'role': 'user', 'text': 'Yes, increment by one.'},
            {'id': 'edit', 'turnId': 't2', 'type': 'fileChange', 'role': 'assistant', 'text': 'main.py'},
        ]}]}

    def chat_source(self, item='a1', turn='t1', excerpt='I propose an increment of one.'):
        return {'kind': 'chat', 'threadId': 'thread', 'turnId': turn, 'itemId': item, 'excerpt': excerpt}

    def decision(self, origin='ai_defined', sources=None):
        d = {'id': 'choice', 'origin': origin, 'summary': 'Increment by one.',
             'sources': [self.chat_source()] if sources is None else sources}
        self.model['decisions'] = [d]
        self.model['boxes'][0].update(provenance=origin, decisionIds=['choice'])
        return d

    def prepare(self, **kwargs):
        return prepare_model(self.model, self.project, kwargs.get('manifest', self.manifest), kwargs.get('chat_history', self.chats))


class InventoryTests(ProjectCase):
    def test_exclusions_and_source_hashes(self):
        for name in ['node_modules', '.git', 'dist']:
            (self.project / name).mkdir()
            (self.project / name / 'ignored.txt').write_text('excluded')
        (self.project / '.env').write_text('SECRET=do-not-read')
        (self.project / 'credentials.json').write_text('{}')
        (self.project / '.env.example').write_text('TOKEN=placeholder')
        (self.project / 'binary.bin').write_bytes(b'\x00\xff')
        (self.project / 'large.txt').write_text('x' * 2048)
        output = self.project / 'visualization/blackbox'
        output.mkdir(parents=True)
        (output / 'index.html').write_text('old output')
        result = inventory(self.project, max_bytes=1024)
        self.assertEqual({f['path'] for f in result['files']}, {'main.py', '.env.example'})
        reasons = {f['path']: f['reason'] for f in result['excluded']}
        self.assertIn('.env', reasons)
        self.assertIn('visualization/blackbox', reasons)
        self.assertIn('binary.bin', reasons)
        self.assertIn('large.txt', reasons)
        self.assertEqual(next(f for f in result['files'] if f['path'] == 'main.py')['sha256'], hashlib.sha256((self.project / 'main.py').read_bytes()).hexdigest())

    def test_symlinks_are_not_followed(self):
        outside = Path(self.temporary.name) / 'outside'
        outside.mkdir()
        (outside / 'secret.txt').write_text('private')
        (self.project / 'external').symlink_to(outside, target_is_directory=True)
        (self.project / 'linked.py').symlink_to(self.project / 'main.py')
        result = inventory(self.project)
        self.assertEqual([f['path'] for f in result['files']], ['main.py'])
        self.assertEqual(len(result['excluded']), 2)

    def test_git_ignored_files(self):
        subprocess.run(['git', 'init', '-q', str(self.project)], check=True)
        (self.project / '.gitignore').write_text('scratch.txt\n')
        (self.project / 'scratch.txt').write_text('ignore')
        self.assertNotIn('scratch.txt', {f['path'] for f in inventory(self.project)['files']})

    def test_artifact_cannot_contain_source_root(self):
        with self.assertRaises(ValueError):
            inventory(self.project, self.project.parent)

    def test_worktree_roots_do_not_expand_a_subdirectory_to_parent_project(self):
        subprocess.run(['git', 'init', '-q', str(self.project)], check=True)
        sub = self.project / 'src'
        sub.mkdir()
        self.assertEqual(project_roots(sub), [str(sub.resolve())])


class ModelTests(ProjectCase):
    def test_ai_origin_and_user_approval_are_separate(self):
        decision = self.decision()
        decision['approval'] = {'status': 'approved', 'sources': [self.chat_source('u2', 't2', 'Yes, increment by one.')]}
        model = self.prepare()
        self.assertEqual(model['decisions'][0]['origin'], 'ai_defined')
        self.assertEqual(model['decisions'][0]['approval']['status'], 'approved')
        self.assertEqual(model['boxes'][0]['provenance'], 'ai_defined')
        self.assertEqual(model['decisions'][0]['sources'][0]['role'], 'assistant')

    def test_user_and_mixed_decision_evidence(self):
        user = self.chat_source('u1', 't1', 'Require a positive input.')
        self.decision('human_defined', [user])
        self.assertEqual(self.prepare()['decisions'][0]['origin'], 'human_defined')
        self.decision('mixed', [user, self.chat_source()])
        self.assertEqual(self.prepare()['decisions'][0]['origin'], 'mixed')

    def test_wrong_role_unknown_and_does_not_inherit_to_children(self):
        self.decision('human_defined')
        model = self.prepare()
        self.assertEqual(model['decisions'][0]['origin'], 'unknown')
        self.assertEqual(model['boxes'][0]['provenance'], 'unknown')
        self.decision('ai_defined')
        self.model['boxes'].append({'id': 'child', 'provenance': 'ai_defined', 'children': [], 'inputs': [], 'outputs': []})
        self.model['boxes'][0]['children'] = ['child']
        self.assertEqual(self.prepare()['boxes'][1]['provenance'], 'unknown')

    def test_missing_history_or_mismatched_excerpt_unknown(self):
        self.decision()
        self.assertEqual(self.prepare(chat_history=None)['decisions'][0]['origin'], 'unknown')
        self.model['decisions'][0]['sources'][0]['excerpt'] = 'Invented statement'
        self.assertEqual(self.prepare()['decisions'][0]['origin'], 'unknown')

    def test_file_edit_is_not_decision_or_approval_evidence(self):
        edit = self.chat_source('edit', 't2', 'main.py')
        decision = self.decision('ai_defined', [edit])
        decision['approval'] = {'status': 'approved', 'sources': [edit]}
        model = self.prepare()
        self.assertEqual(model['decisions'][0]['origin'], 'unknown')
        self.assertEqual(model['decisions'][0]['approval']['status'], 'unknown')

    def test_assistant_cannot_supply_user_approval(self):
        decision = self.decision()
        decision['approval'] = {'status': 'approved', 'sources': [self.chat_source()]}
        self.assertEqual(self.prepare()['decisions'][0]['approval']['status'], 'unknown')

    def test_ordinary_source_does_not_establish_ownership(self):
        self.decision('ai_defined', [{'path': 'main.py', 'line': 1}])
        self.assertEqual(self.prepare()['decisions'][0]['origin'], 'unknown')

    def test_recorded_yaml_and_field_provenance_preserved(self):
        (self.project / 'metadata.yaml').write_text('provenance: human_defined\nfields:\n  - name: result\n    provenance: ai_defined\n')
        self.manifest = inventory(self.project)
        declared = {'path': 'metadata.yaml', 'line': 1, 'recordedProvenance': 'human_defined'}
        self.model['boxes'][0].update(provenance='human_defined', sources=[declared])
        self.model['dataStructures'] = [{'id': 'result', 'fields': [{'name': 'result', 'provenance': 'ai_defined',
            'sources': [{'path': 'metadata.yaml', 'line': 4, 'recordedProvenance': 'ai_defined'}]}]}]
        model = self.prepare(chat_history=None)
        self.assertEqual(model['boxes'][0]['provenance'], 'human_defined')
        self.assertEqual(model['dataStructures'][0]['fields'][0]['provenance'], 'ai_defined')

    def test_recorded_provenance_needs_matching_declaration(self):
        self.model['boxes'][0]['sources'][0]['recordedProvenance'] = 'ai_defined'
        with self.assertRaises(ModelError):
            self.prepare()

    def test_per_port_decision_does_not_make_whole_box_user_defined(self):
        self.decision('human_defined', [self.chat_source('u1', 't1', 'Require a positive input.')])
        box = self.model['boxes'][0]
        box.update(provenance='unknown', decisionIds=[], inputs=[{'name': 'value', 'provenance': 'human_defined', 'decisionIds': ['choice']}])
        model = self.prepare()
        self.assertEqual(model['boxes'][0]['inputs'][0]['provenance'], 'human_defined')
        self.assertEqual(model['boxes'][0]['provenance'], 'unknown')

    def test_safe_source_paths_lines_and_excerpts(self):
        for source in [{'path': '../outside'}, {'path': str(self.project / 'main.py')}, {'path': 'main.py', 'line': 30}, {'path': 'main.py', 'excerpt': 'not in file'}]:
            with self.subTest(source=source):
                self.model['boxes'][0]['sources'] = [source]
                with self.assertRaises(ModelError):
                    self.prepare()

    def test_duplicate_ids_fail_and_dangling_links_warn(self):
        self.model['boxes'].append(copy.deepcopy(self.model['boxes'][0]))
        with self.assertRaises(ModelError):
            self.prepare()
        self.model['boxes'].pop()
        self.model['boxes'][0]['children'] = ['missing']
        self.model['edges'] = [{'source': 'run', 'target': 'missing', 'type': 'calls'}]
        model = self.prepare()
        self.assertEqual(model['edges'], [])
        self.assertTrue(any('missing' in w for w in model['warnings']))

    def test_coverage_counts_are_derived_and_missing_files_pending(self):
        self.assertTrue(self.prepare()['coverage']['complete'])
        self.model['coverage']['files'] = []
        model = self.prepare()
        self.assertFalse(model['coverage']['complete'])
        self.assertEqual(model['coverage']['counts']['pending'], 1)

    def test_changes_or_new_files_invalidate_full_coverage(self):
        (self.project / 'main.py').write_text('def run(value):\n    return value + 2\n')
        model = self.prepare()
        self.assertFalse(model['coverage']['complete'])
        self.assertEqual(model['coverage']['counts']['unresolved'], 1)
        (self.project / 'new.py').write_text('pass\n')
        model = self.prepare()
        self.assertEqual(model['coverage']['counts']['eligible'], 2)
        self.assertEqual(model['coverage']['counts']['pending'], 1)

    def test_unknown_coverage_claims_fail_without_inventory_never_complete(self):
        self.model['coverage']['files'].append({'path': 'invented.py', 'status': 'inspected'})
        with self.assertRaises(ModelError):
            self.prepare()
        self.model['coverage']['files'].pop()
        self.assertFalse(self.prepare(manifest=None)['coverage']['complete'])

    def test_custom_file_limit_and_new_file_coverage_records(self):
        (self.project / 'large.txt').write_text('x' * 200)
        self.manifest = inventory(self.project, max_bytes=100)
        self.assertTrue(self.prepare()['coverage']['complete'])
        (self.project / 'new.py').write_text('pass\n')
        coverage = self.prepare()['coverage']
        self.assertEqual(next(f for f in coverage['files'] if f['path'] == 'new.py')['status'], 'pending')

    def test_recorded_metadata_conflict_and_implementation_authorship_are_visible(self):
        (self.project / 'meta.yaml').write_text('provenance: human_defined\nprovenance: ai_defined\n')
        self.manifest = inventory(self.project)
        self.decision('ai_defined')
        self.model['boxes'][0].update(provenance='human_defined', sources=[{'path': 'meta.yaml', 'line': 1, 'recordedProvenance': 'human_defined'}],
            implementation={'path': 'main.py', 'symbol': 'run', 'provenance': 'ai_defined',
                            'sources': [{'path': 'meta.yaml', 'line': 2, 'recordedProvenance': 'ai_defined'}]})
        model = self.prepare()
        self.assertEqual(model['boxes'][0]['provenance'], 'human_defined')
        self.assertEqual(model['boxes'][0]['implementation']['provenance'], 'ai_defined')
        self.assertTrue(any('recorded provenance differs' in w for w in model['warnings']))

    def test_html_embedding_is_safe(self):
        self.model['project']['name'] = '</script><img src=x onerror=alert(1)>'
        model = self.prepare()
        template = (ROOT / 'skills/blackbox-project/assets/visualizer.html').read_text()
        result = render_html(model, template)
        self.assertIn('\\u003c/script>', result)
        self.assertNotIn('<img src=x', result)
        self.assertIn('&lt;/script&gt;', result)

    def test_render_cli_preserves_source_and_protects_unrelated_output(self):
        scratch = Path(self.temporary.name) / 'scratch'
        scratch.mkdir()
        for name, data in [('model', self.model), ('inventory', self.manifest)]:
            (scratch / f'{name}.json').write_text(json.dumps(data))
        before = (self.project / 'main.py').read_bytes()
        args = ['render', '--project', str(self.project), '--model', str(scratch / 'model.json'), '--inventory', str(scratch / 'inventory.json')]
        self.assertEqual(main(args), 0)
        output = self.project / 'visualization/blackbox'
        embedded = (output / 'index.html').read_text().split('<script id="project-model" type="application/json">')[1].split('</script>')[0]
        self.assertEqual(json.loads(embedded), json.loads((output / 'model.json').read_text()))
        self.assertTrue(json.loads((output / 'model.json').read_text())['coverage']['complete'])
        self.assertEqual((self.project / 'main.py').read_bytes(), before)
        (output / 'index.html').write_text('Unrelated artifact')
        self.assertEqual(main(args), 1)
        self.assertEqual((output / 'index.html').read_text(), 'Unrelated artifact')


class FakeRpc:
    def __init__(self, project, legacy=0):
        self.project, self.legacy, self.calls = str(project), legacy, []

    def call(self, method, params):
        self.calls.append((method, params))
        if method == 'thread/list':
            if params.get('archived'):
                return {'data': [{'id': 'archived', 'cwd': self.project, 'name': 'Archived project chat'}], 'nextCursor': None}
            if params.get('cursor') == 'next':
                return {'data': [{'id': 'child', 'cwd': self.project + '/src'}], 'nextCursor': None}
            return {'data': [{'id': 'active', 'cwd': self.project}, {'id': 'unrelated', 'cwd': self.project + '-other'}], 'nextCursor': 'next'}
        if method == 'thread/items/list':
            if self.legacy:
                raise RpcError(-32601, 'Unsupported method')
            if params.get('cursor'):
                return {'data': [], 'nextCursor': None}
            return {'data': [{'turnId': 't1', 'item': {'type': 'userMessage', 'id': 'u1', 'content': [{'type': 'text', 'text': 'Use local storage.'}]}}], 'nextCursor': 'items-next'}
        if method == 'thread/turns/list':
            if self.legacy > 1:
                raise RpcError(-32000, 'Legacy thread does not support pagination')
            return {'data': [{'id': 't1', 'items': [{'type': 'agentMessage', 'id': 'a1', 'text': 'Use an outbox.'}]}], 'nextCursor': None}
        if method == 'thread/read':
            return {'thread': {'turns': [{'id': 't1', 'items': [{'type': 'agentMessage', 'id': 'a1', 'text': 'Use an outbox.'}]}]}}
        raise AssertionError(f'Unexpected method {method}')


class HistoryTests(ProjectCase):
    def test_project_archive_source_and_pagination_filters(self):
        rpc = FakeRpc(self.project)
        result = collect_history(self.project, rpc)
        self.assertEqual({t['id'] for t in result['threads']}, {'active', 'child', 'archived'})
        self.assertTrue(next(t for t in result['threads'] if t['id'] == 'archived')['archived'])
        self.assertEqual(result['status'], 'available')
        self.assertTrue(all('unrelated' != p.get('threadId') for _, p in rpc.calls))
        self.assertTrue(all(p['useStateDbOnly'] and 'appServer' in p['sourceKinds'] for m, p in rpc.calls if m == 'thread/list'))
        self.assertTrue(any(p.get('cursor') == 'items-next' for m, p in rpc.calls if m == 'thread/items/list'))

    def test_turn_and_legacy_full_history_fallbacks(self):
        for level in [1, 2]:
            with self.subTest(level=level):
                rpc = FakeRpc(self.project, legacy=level)
                items = thread_items(rpc, 'thread')
                self.assertEqual(items[0][0]['id'], 'a1')
                self.assertFalse(any(m == 'thread/resume' for m, _ in rpc.calls))
                if level == 2:
                    self.assertTrue(any(m == 'thread/read' and p['includeTurns'] for m, p in rpc.calls))

    def test_timeout_is_disclosed(self):
        class TimeoutRpc:
            def call(self, *args):
                raise TimeoutError('test timeout')
        result = collect_history(self.project, TimeoutRpc())
        self.assertEqual(result['status'], 'unavailable')
        self.assertIn('test timeout', result['warnings'])

    def test_missing_cli_is_nonfatal(self):
        result = history(self.project, executable='/definitely/missing/codex')
        self.assertEqual(result['status'], 'unavailable')

    def test_redaction_and_raw_reasoning_exclusion(self):
        raw = {'type': 'agentMessage', 'id': 'a', 'text': 'api_key=privatecredential123 sk-' + 'a' * 30}
        clean = clean_item(raw, 't')
        self.assertNotIn('privatecredential123', clean['text'])
        self.assertNotIn('sk-' + 'a' * 30, clean['text'])
        self.assertIsNone(clean_item({'type': 'reasoning', 'content': 'private'}, 't'))
        self.assertIsNone(clean_item({'type': 'commandExecution', 'aggregatedOutput': 'private'}, 't'))
        self.assertTrue(clean_item({'type': 'agentMessage', 'text': 'x' * 25000}, 't')['truncated'])

    def test_stdio_handshake_and_mutation_allowlist(self):
        fake = Path(self.temporary.name) / 'fake-codex'
        fake.write_text('#!/usr/bin/env python3\nimport json,sys\nfor line in sys.stdin:\n r=json.loads(line)\n if "id" in r:\n  print(json.dumps({"id":r["id"],"result":{"data":[],"nextCursor":None}}),flush=True)\n')
        fake.chmod(0o755)
        rpc = CodexRpc(str(fake), timeout=3, total_timeout=10)
        self.addCleanup(rpc.close)
        self.assertEqual(rpc.call('thread/list', {})['data'], [])
        with self.assertRaises(ValueError):
            rpc.call('turn/start', {})

    def test_startup_failures_include_sanitized_diagnostics(self):
        fake = Path(self.temporary.name) / 'failing-codex'
        fake.write_text('#!/usr/bin/env python3\nimport sys\nsys.stderr.write("State runtime unavailable api_key=privatecredential123\\n")\nsys.exit(1)\n')
        fake.chmod(0o755)
        result = history(self.project, executable=str(fake), timeout=2)
        self.assertEqual(result['status'], 'unavailable')
        message = ' '.join(result['warnings'])
        self.assertIn('State runtime unavailable', message)
        self.assertNotIn('privatecredential123', message)


class PackageTests(unittest.TestCase):
    def test_package_is_self_contained_and_reproducible(self):
        metadata = build_release.build()
        archive = ROOT / 'release' / metadata['archive']
        first = archive.read_bytes()
        build_release.build()
        self.assertEqual(first, archive.read_bytes())
        self.assertEqual([p.name for p in archive.parent.glob('codex-blackbox-*.zip')], [archive.name])
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            self.assertIn('skills/blackbox-project/SKILL.md', names)
            self.assertTrue(all(not name.startswith(('tests/', 'demos/', 'tools/', 'release/')) and '__pycache__' not in name for name in names))
        catalog_root = ROOT / 'release/marketplace'
        catalog = json.loads((catalog_root / '.agents/plugins/marketplace.json').read_text())
        plugin = catalog_root / catalog['plugins'][0]['source']['path']
        self.assertEqual(json.loads((plugin / 'plugin.json').read_text())['name'], metadata['name'])

    def test_original_blackbox_fixture_mapping(self):
        base, raw, manifest, chats = build_demos.quote_engine()
        before = {p: p.read_bytes() for p in base.rglob('*') if p.is_file()}
        model = prepare_model(raw, base, manifest, chats)
        self.assertEqual(len(model['boxes']), 3)
        self.assertEqual(len(model['dataStructures']), 2)
        self.assertTrue(all(b['provenance'] == 'ai_defined' for b in model['boxes']))
        self.assertEqual(next(b for b in model['boxes'] if b['id'] == 'quote_order')['state'], 'partial')
        self.assertEqual(before, {p: p.read_bytes() for p in base.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
