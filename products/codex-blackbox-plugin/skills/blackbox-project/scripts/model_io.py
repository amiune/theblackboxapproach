"""Normalize and verify the plugin model before publishing an offline snapshot."""
import copy
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re

from codex_history import redact
from project_scan import digest, inside, inventory, is_secret

PROVENANCE = {'human_defined', 'ai_defined', 'mixed', 'unknown'}
EVIDENCE = {'observed', 'documented', 'inferred', 'proposed', 'unknown'}


class ModelError(ValueError):
    pass


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def prepare_model(raw, project, manifest=None, chat_history=None):
    root = Path(project).resolve()
    if not isinstance(raw, dict) or raw.get('version') != 1 or raw.get('format') != 'codex-blackbox':
        raise ModelError('Expected format codex-blackbox, version 1.')
    model = copy.deepcopy(raw)
    if not isinstance(model.get('project'), dict) or not isinstance(model['project'].get('name'), str) or not model['project']['name'].strip():
        raise ModelError('project.name is required.')
    warnings = list(model.get('warnings', []))
    errors = []
    entities = {}
    history_index = {}
    if chat_history:
        for thread in chat_history.get('threads', []):
            for item in thread.get('items', []):
                history_index[(thread['id'], item.get('turnId'), item.get('id'))] = item

    def sources(values):
        output = []
        if not isinstance(values, list):
            errors.append('sources must be an array.')
            return output
        for value in values:
            if not isinstance(value, dict):
                errors.append('Each source must be an object.')
                continue
            source = copy.deepcopy(value)
            source.pop('verification', None)
            source.pop('role', None)
            kind = source.get('kind', 'file')
            source['kind'] = kind
            if kind == 'file':
                path = source.get('path', '')
                if not isinstance(path, str) or not path or Path(path).is_absolute() or '..' in Path(path).parts:
                    errors.append(f'File sources must use safe project-relative paths: {path}')
                    continue
                target = (root / path).resolve()
                if not inside(target, root) or not target.is_file() or is_secret(target):
                    errors.append(f'Source is missing, private, or outside the project: {path}')
                    continue
                try:
                    content = target.read_text(encoding='utf-8')
                except (OSError, UnicodeError):
                    errors.append(f'Source could not be read: {path}')
                    continue
                lines = content.splitlines()
                line = source.get('line')
                if line is not None and (type(line) is not int or not 1 <= line <= len(lines)):
                    errors.append(f'Invalid source line: {path}:{line}')
                    continue
                excerpt = source.get('excerpt')
                if excerpt and (not isinstance(excerpt, str) or excerpt not in content):
                    errors.append(f'Source excerpt not found: {path}')
                    continue
                source['verification'] = 'verified'
                declared = source.get('recordedProvenance')
                if declared is not None:
                    text = lines[line - 1] if line else ''
                    if declared not in PROVENANCE or not re.search(r'["\']?provenance["\']?\s*:\s*["\']?' + re.escape(declared) + r'\b', text):
                        errors.append(f'Recorded provenance must cite its actual declaration line: {path}')
                        continue
            elif kind == 'chat':
                key = (source.get('threadId'), source.get('turnId'), source.get('itemId'))
                item = history_index.get(key)
                excerpt = source.get('excerpt')
                if item and isinstance(excerpt, str) and excerpt.strip() and excerpt in item.get('text', ''):
                    source['verification'] = 'verified'
                    # A file change proves who edited code, not who chose a behavior.
                    source['role'] = item.get('role') if item.get('type') in {'userMessage', 'agentMessage'} else 'implementation'
                else:
                    source['verification'] = 'unverified'
                    warnings.append(f'Unverified chat evidence: {key[0]}/{key[2]}. Supply matching history and an exact excerpt.')
            else:
                errors.append(f'Unknown source kind: {kind}')
                continue
            if 'excerpt' in source:
                source['excerpt'] = redact(source['excerpt'])[:500]
            output.append(source)
        return output

    def common(record):
        if not isinstance(record, dict):
            errors.append('Model records must be objects.')
            return {'sources': [], 'provenance': 'unknown', 'decisionIds': [], 'evidence': 'unknown'}
        record['sources'] = sources(record.get('sources', []))
        record['evidence'] = record.get('evidence') if record.get('evidence') in EVIDENCE else 'unknown'
        record['provenance'] = record.get('provenance') if record.get('provenance') in PROVENANCE else 'unknown'
        if not isinstance(record.get('decisionIds', []), list):
            errors.append('decisionIds must be an array.')
        record['decisionIds'] = record.get('decisionIds', []) if isinstance(record.get('decisionIds', []), list) else []
        return record

    for category in ('boxes', 'dataStructures'):
        if not isinstance(model.get(category, []), list):
            raise ModelError(f'{category} must be an array.')
        for record in model.setdefault(category, []):
            if not isinstance(record, dict) or not isinstance(record.get('id'), str) or not record['id'].strip():
                errors.append(f'{category} record needs a nonempty string id.')
                continue
            if record['id'] in entities:
                errors.append(f'Duplicate entity ID: {record["id"]}')
            entities[record['id']] = record
            common(record)
            record.setdefault('label', record['id'])
            record.setdefault('description', '')
            if category == 'boxes':
                record.setdefault('process', record['description'])
                if 'implementation' in record:
                    record['implementation'] = common(record['implementation'])
                for key in ('children', 'inputs', 'outputs'):
                    if not isinstance(record.get(key, []), list):
                        errors.append(f'{record["id"]}.{key} must be an array.')
                        record[key] = []
                    record.setdefault(key, [])
                for port in record['inputs'] + record['outputs']:
                    if not isinstance(port, dict) or not isinstance(port.get('name'), str):
                        errors.append(f'Named port required on {record["id"]}.')
                    else:
                        common(port)
            else:
                if not isinstance(record.get('fields', []), list):
                    errors.append(f'{record["id"]}.fields must be an array.')
                    record['fields'] = []
                for field in record.setdefault('fields', []):
                    if not isinstance(field, dict) or not isinstance(field.get('name'), str):
                        errors.append(f'Named field required on {record["id"]}.')
                    else:
                        common(field)

    decisions = {}
    if not isinstance(model.get('decisions', []), list):
        raise ModelError('decisions must be an array.')
    for decision in model.setdefault('decisions', []):
        if not isinstance(decision, dict) or not isinstance(decision.get('id'), str) or not decision['id']:
            errors.append('Every decision needs a nonempty string id.')
            continue
        if decision['id'] in decisions:
            errors.append(f'Duplicate decision ID: {decision["id"]}')
        decisions[decision['id']] = decision
        decision['sources'] = sources(decision.get('sources', []))
        origin = decision.get('origin', 'unknown')
        verified = [s for s in decision['sources'] if s.get('verification') == 'verified']
        roles = {s.get('role') for s in verified}
        recorded = {s.get('recordedProvenance') for s in verified}
        supported = (origin == 'unknown' or origin in recorded or
                     (origin == 'human_defined' and 'user' in roles) or
                     (origin == 'ai_defined' and 'assistant' in roles) or
                     (origin == 'mixed' and {'user', 'assistant'} <= roles))
        if origin not in PROVENANCE or not supported:
            warnings.append(f'{decision["id"]}: ownership lacks matching decision evidence; shown as Unknown.')
            origin = 'unknown'
        decision['origin'] = origin
        approval = decision.get('approval') or {'status': 'unknown'}
        if not isinstance(approval, dict):
            errors.append(f'{decision["id"]}.approval must be an object.')
            approval = {'status': 'unknown'}
        approval['sources'] = sources(approval.get('sources', []))
        status = approval.get('status', 'unknown')
        if status not in {'approved', 'rejected', 'unknown'}:
            status = 'unknown'
        if status != 'unknown' and not any(s.get('verification') == 'verified' and s.get('role') == 'user' for s in approval['sources']):
            warnings.append(f'{decision["id"]}: user approval has no verified user message; shown as Unknown.')
            status = 'unknown'
        approval['status'] = status
        decision['approval'] = approval

    box_ids = {record.get('id') for record in model['boxes'] if isinstance(record, dict)}
    data_ids = {record.get('id') for record in model['dataStructures'] if isinstance(record, dict)}
    root_box = model['project'].get('rootBox')
    if root_box and root_box not in box_ids:
        warnings.append(f'Root box not found: {root_box}')
    for box in model['boxes']:
        if not isinstance(box, dict):
            continue
        for child in box.get('children', []):
            if not isinstance(child, str) or child not in box_ids:
                warnings.append(f'{box.get("id")}: missing child {child}')
        for port in box.get('inputs', []) + box.get('outputs', []):
            if isinstance(port, dict) and port.get('dataStructure') and port['dataStructure'] not in data_ids:
                warnings.append(f'{box.get("id")}: unresolved port data structure {port["dataStructure"]}')

    # Cross references are checked after every decision has been indexed.
    for record in list(entities.values()) + [b['implementation'] for b in model['boxes'] if isinstance(b, dict) and 'implementation' in b] + [p for b in model['boxes'] if isinstance(b, dict) for p in b.get('inputs', []) + b.get('outputs', [])] + [f for d in model['dataStructures'] if isinstance(d, dict) for f in d.get('fields', [])]:
        if not isinstance(record, dict):
            continue
        for decision_id in record.get('decisionIds', []):
            if decision_id not in decisions:
                warnings.append(f'Unknown decision reference: {decision_id}')
        # Unsupported generated provenance must not masquerade as recorded metadata.
        refs = [decisions[d] for d in record.get('decisionIds', []) if d in decisions]
        recorded = any(s.get('recordedProvenance') == record.get('provenance') for s in record.get('sources', []))
        if recorded and any(d['origin'] not in {'unknown', record.get('provenance')} for d in refs):
            warnings.append(f'{record.get("id", record.get("name", "Implementation"))}: recorded provenance differs from linked decision evidence; both are preserved.')
        if record.get('provenance') != 'unknown' and not recorded:
            origins = {d['origin'] for d in refs} - {'unknown'}
            if not origins:
                record['provenance'] = 'unknown'
            elif origins == {'human_defined'}:
                record['provenance'] = 'human_defined'
            elif origins == {'ai_defined'}:
                record['provenance'] = 'ai_defined'
            else:
                record['provenance'] = 'mixed'

    if not isinstance(model.get('edges', []), list):
        raise ModelError('edges must be an array.')
    edges = []
    for edge in model.setdefault('edges', []):
        if not isinstance(edge, dict):
            errors.append('Edges must be objects.')
            continue
        if edge.get('source') not in entities or edge.get('target') not in entities:
            warnings.append(f'Unresolved relationship: {edge.get("source")} → {edge.get("target")}')
            continue
        edge['sources'] = sources(edge.get('sources', []))
        edge['evidence'] = edge.get('evidence') if edge.get('evidence') in EVIDENCE else 'unknown'
        edges.append(edge)
    model['edges'] = edges

    coverage = model.setdefault('coverage', {})
    reviewed = coverage.get('files', [])
    if not isinstance(reviewed, list) or any(not isinstance(v, dict) or not isinstance(v.get('path'), str) for v in reviewed):
        errors.append('coverage.files must contain objects with path and status.')
        reviewed = []
    if len({v['path'] for v in reviewed}) != len(reviewed):
        errors.append('Duplicate coverage file paths.')
    if manifest:
        if Path(manifest.get('root', '')).resolve() != root:
            errors.append('Inventory belongs to a different project.')
        eligible = {v['path']: v for v in manifest.get('files', [])}
        claimed = {v['path']: v for v in reviewed}
        for path in claimed.keys() - eligible.keys():
            errors.append(f'Coverage claims a file absent from the inventory: {path}')
        current = inventory(root, output_dir=coverage.get('outputDir'), max_bytes=manifest.get('maxFileBytes', 1024 * 1024))
        current_paths = {v['path'] for v in current['files']}
        added = current_paths - eligible.keys()
        if added:
            warnings.append(f'{len(added)} eligible files were added after inventory; refresh before claiming full coverage.')
        files = []
        for path, entry in eligible.items():
            status = claimed.get(path, {}).get('status', 'pending')
            if status not in {'inspected', 'unresolved', 'pending'}:
                errors.append(f'Invalid inspection status for {path}')
                status = 'unresolved'
            target = root / path
            if not target.is_file() or not inside(target.resolve(), root) or digest(target) != entry['sha256']:
                status = 'unresolved'
                warnings.append(f'Source changed since inventory: {path}')
            files.append(dict(claimed.get(path, {}), path=path, status=status))
        files.extend({'path': path, 'status': 'pending', 'note': 'Added since the inventory snapshot.'} for path in sorted(added))
        coverage['files'] = files
        coverage['excluded'] = manifest.get('excluded', [])
        coverage['counts'] = {'eligible': len(files), 'inspected': sum(v['status'] == 'inspected' for v in files),
                              'unresolved': sum(v['status'] == 'unresolved' for v in files),
                              'pending': sum(v['status'] == 'pending' for v in files)}
        coverage['complete'] = not manifest.get('warnings') and not current.get('warnings') and not added and all(v['status'] == 'inspected' for v in files)
        warnings.extend(manifest.get('warnings', []))
        warnings.extend(current.get('warnings', []))
    else:
        coverage['complete'] = False
        coverage['counts'] = {'eligible': len(reviewed), 'inspected': sum(v.get('status') == 'inspected' for v in reviewed)}
        warnings.append('Inventory not supplied; whole-project coverage has not been verified.')
    coverage.pop('outputDir', None)
    model['history'] = {'status': chat_history.get('status', 'unavailable'), 'threadCount': len(chat_history.get('threads', [])),
                        'warnings': chat_history.get('warnings', [])} if chat_history else {'status': 'unavailable', 'threadCount': 0, 'warnings': ['No history supplied.']}
    warnings.extend(model['history']['warnings'])
    model['project']['generatedAt'] = datetime.now(timezone.utc).isoformat()
    model['warnings'] = list(dict.fromkeys(str(w) for w in warnings))
    if errors:
        raise ModelError('\n'.join(dict.fromkeys(errors)))
    return model


def render_html(model, template):
    encoded = json.dumps(model, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    result, count = re.subn(r'(<script id="project-model" type="application/json">).*?(</script>)',
                            lambda match: match[1] + encoded + match[2], template, flags=re.S)
    if count != 1:
        raise ModelError('Renderer must contain exactly one project-model JSON block.')
    name = html.escape(model['project']['name'])
    return re.sub(r'<title>.*?</title>', lambda _: f'<title>{name} · BlackBox Project</title>', result, count=1)
