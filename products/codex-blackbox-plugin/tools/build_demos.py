"""Build reviewable demos from existing synthetic source; never mutate inputs."""
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skills/blackbox-project/scripts'))
from model_io import prepare_model, render_html, write_json
from project_scan import inventory


def source(thread, turn, item, excerpt):
    return {'kind': 'chat', 'threadId': thread, 'turnId': turn, 'itemId': item, 'excerpt': excerpt}


def orderflow():
    base = ROOT / 'fixtures/order-processing'
    original = json.loads((ROOT / 'fixtures/models/orderflow.source-model.json').read_text())
    boxes = []
    for node in original['nodes']:
        box = copy.deepcopy(node)
        box['process'] = box['description']
        box['children'] = {'checkout': ['validation'], 'orders': ['inventory', 'payments', 'store', 'notifications']}.get(box['id'], [])
        for direction in ('inputs', 'outputs'):
            box[direction] = [{'name': name[0].lower() + name[1:], 'type': name, 'dataStructure': name, 'provenance': 'unknown'} for name in box[direction]]
        box['implementation'] = {key: box['sources'][0][key] for key in ('path', 'symbol')}
        boxes.append(box)
    contract = 'Require at least one order item and a contact email.'
    proposal = 'I propose a local in-memory outbox for confirmation notifications.'
    approval = 'Yes, use the local in-memory outbox for confirmations.'
    user_order = 'Reserve stock before recording payment.'
    ai_order = 'I will coordinate reservation and payment synchronously before saving the order.'
    history = {'version': 1, 'status': 'available', 'threads': [{
        'id': 'synthetic-demo', 'title': 'Synthetic demonstration — not real project history', 'complete': True,
        'items': [
            {'id': 'user-contract', 'turnId': 't1', 'type': 'userMessage', 'role': 'user', 'text': contract},
            {'id': 'ai-outbox', 'turnId': 't1', 'type': 'agentMessage', 'role': 'assistant', 'text': proposal},
            {'id': 'user-approval', 'turnId': 't2', 'type': 'userMessage', 'role': 'user', 'text': approval},
            {'id': 'user-order', 'turnId': 't3', 'type': 'userMessage', 'role': 'user', 'text': user_order},
            {'id': 'ai-order', 'turnId': 't3', 'type': 'agentMessage', 'role': 'assistant', 'text': ai_order},
        ]}], 'warnings': ['Decision evidence in this demonstration is explicitly synthetic, not recovered historical attribution.']}
    decisions = [
        {'id': 'required-input', 'summary': 'Reject an empty order or missing contact email.', 'origin': 'human_defined',
         'sources': [source('synthetic-demo', 't1', 'user-contract', contract)]},
        {'id': 'local-confirmation', 'summary': 'Queue confirmations in a local in-memory outbox.', 'origin': 'ai_defined',
         'sources': [source('synthetic-demo', 't1', 'ai-outbox', proposal)],
         'approval': {'status': 'approved', 'sources': [source('synthetic-demo', 't2', 'user-approval', approval)]}},
        {'id': 'order-sequence', 'summary': 'Reserve first, then coordinate a synchronous payment and persistence sequence.', 'origin': 'mixed',
         'sources': [source('synthetic-demo', 't3', 'user-order', user_order), source('synthetic-demo', 't3', 'ai-order', ai_order)]},
    ]
    for box in boxes:
        mapping = {'checkout': ('human_defined', ['required-input']), 'validation': ('human_defined', ['required-input']),
                   'orders': ('mixed', ['order-sequence']), 'notifications': ('ai_defined', ['local-confirmation'])}
        box['provenance'], box['decisionIds'] = mapping.get(box['id'], ('unknown', []))
        if box['id'] == 'checkout':
            box['inputs'][0].update(provenance='human_defined', decisionIds=['required-input'])
    structures = copy.deepcopy(original['dataStructures'])
    for item in structures:
        item['provenance'] = 'unknown'
        if item['id'] == 'OrderRequest':
            for field in item['fields']:
                if field['name'] in {'items', 'email'}:
                    field.update(provenance='human_defined', decisionIds=['required-input'])
    boxes.insert(0, {'id': 'orderflow', 'label': 'Orderflow system', 'kind': 'system', 'description': 'Accept an order and return a local confirmation.',
                     'process': 'Validate → reserve → record payment → save → queue confirmation.', 'children': ['checkout', 'orders'],
                     'inputs': [{'name': 'request', 'type': 'OrderRequest', 'dataStructure': 'OrderRequest'}],
                     'outputs': [{'name': 'order', 'type': 'Order', 'dataStructure': 'Order'}],
                     'evidence': 'documented', 'provenance': 'mixed', 'decisionIds': ['required-input', 'local-confirmation', 'order-sequence'],
                     'sources': [{'kind': 'file', 'path': 'README.md', 'line': 7}]})
    manifest = inventory(base)
    model = {'format': 'codex-blackbox', 'version': 1,
             'project': {'name': 'Orderflow', 'summary': 'Synthetic source + synthetic chats. Follow an order through its child processes, shared data, and evidenced decisions.', 'rootBox': 'orderflow'},
             'boxes': boxes, 'dataStructures': structures, 'edges': original['edges'], 'decisions': decisions,
             'coverage': {'files': [{'path': f['path'], 'status': 'inspected'} for f in manifest['files']]},
             'warnings': ['Curated semantic model of the included synthetic code; relationships are source-based, not measured runtime traces.']}
    return base, model, manifest, history


def quote_engine():
    # This known fixture is deliberately mapped from reviewed YAML, not parsed
    # with a heuristic advertised as a general YAML or code parser.
    base = ROOT / 'fixtures/blackbox-project'
    box_names = {'quote_order': 'Quote order', 'validate_items': 'Validate items', 'calculate_total': 'Calculate total'}
    boxes = []
    for id, label in box_names.items():
        path = f'blackboxes/boxes/{id}.yaml'
        lines = (base / path).read_text().splitlines()
        provenance_line = next(i + 1 for i, line in enumerate(lines) if line == 'provenance: ai_defined')
        declared = {'kind': 'file', 'path': path, 'line': provenance_line, 'recordedProvenance': 'ai_defined'}
        intent = next(line.removeprefix('intent: ') for line in lines if line.startswith('intent: '))
        box = {'id': id, 'label': label, 'kind': 'logic', 'description': intent, 'process': intent,
               'state': 'partial' if id == 'quote_order' else 'abstract', 'evidence': 'documented', 'provenance': 'ai_defined',
               'sources': [declared], 'children': ['validate_items', 'calculate_total'] if id == 'quote_order' else [],
               'inputs': [{'name': 'request', 'type': 'QuoteRequest', 'dataStructure': 'QuoteRequest'}],
               'outputs': [] if id == 'validate_items' else [{'name': 'quote', 'type': 'Quote', 'dataStructure': 'Quote'}]}
        boxes.append(box)
    data = []
    for id, name in [('Quote', 'quote'), ('QuoteRequest', 'quote_request')]:
        path = f'blackboxes/data/{name}.yaml'
        lines = (base / path).read_text().splitlines()
        fields = [{'name': lines[i].split(': ', 1)[1], 'type': lines[i + 1].split(': ', 1)[1].strip('"')} for i, line in enumerate(lines) if line.startswith('  - name: ')]
        data.append({'id': id, 'label': id, 'fields': fields, 'provenance': 'ai_defined', 'evidence': 'documented',
                     'sources': [{'kind': 'file', 'path': path, 'line': 3, 'recordedProvenance': 'ai_defined'}]})
    manifest = inventory(base)
    model = {'format': 'codex-blackbox', 'version': 1, 'project': {'name': 'Quote Engine', 'summary': 'An existing BlackBoxApproach YAML design, preserving recorded AI provenance and implementation state.', 'rootBox': 'quote_order'},
             'boxes': boxes, 'dataStructures': data, 'decisions': [],
             'edges': [{'source': 'quote_order', 'target': id, 'type': 'calls', 'evidence': 'documented', 'sources': [{'kind': 'file', 'path': 'blackboxes/boxes/quote_order.yaml', 'line': line}]} for id, line in [('validate_items', 17), ('calculate_total', 18)]],
             'coverage': {'files': [{'path': f['path'], 'status': 'inspected'} for f in manifest['files']]},
             'warnings': ['Leaf boxes are abstract specifications, not verified executable code.']}
    return base, model, manifest, {'status': 'unavailable', 'threads': [], 'warnings': ['This fixture has no chat history; displayed provenance is explicitly recorded in YAML.']}


def build():
    template = (ROOT / 'skills/blackbox-project/assets/visualizer.html').read_text()
    result = {}
    for name, factory in [('orderflow', orderflow), ('quote-engine', quote_engine)]:
        base, raw, manifest, chats = factory()
        model = prepare_model(raw, base, manifest, chats)
        directory = ROOT / 'demos' / name
        directory.mkdir(parents=True, exist_ok=True)
        write_json(directory / 'model.json', model)
        (directory / 'index.html').write_text(render_html(model, template))
        result[name] = {'boxes': len(model['boxes']), 'dataStructures': len(model['dataStructures']), 'decisions': len(model['decisions']), 'sourceCoverageComplete': model['coverage']['complete']}
    print(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    build()
