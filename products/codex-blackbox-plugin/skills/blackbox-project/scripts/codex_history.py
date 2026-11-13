"""Read-only Codex JSON-RPC history adapter. No turns or model calls are started."""
import json
from collections import deque
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

from project_scan import inside, project_roots

SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
                'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']
READ_METHODS = {'initialize', 'thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list'}


class RpcError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def unsupported(error):
    return isinstance(error, RpcError) and (error.code == -32601 or any(
        word in str(error).lower() for word in ('unsupported', 'not supported', 'does not support', 'legacy history', 'legacy thread')))


class CodexRpc:
    def __init__(self, executable='codex', timeout=20, total_timeout=120):
        self.timeout = timeout
        self.deadline = time.monotonic() + total_timeout
        self.messages = queue.Queue()
        self.stderr_lines = deque(maxlen=8)
        self.closed = False
        self.request_id = 0
        self.process = subprocess.Popen([executable, 'app-server', '--listen', 'stdio://'],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, encoding='utf-8')
        def read_errors():
            for line in self.process.stderr:
                self.stderr_lines.append(redact(line.strip())[:600])
        self.error_thread = threading.Thread(target=read_errors, daemon=True)
        self.error_thread.start()
        def read():
            try:
                for line in self.process.stdout:
                    try:
                        self.messages.put(json.loads(line))
                    except json.JSONDecodeError:
                        pass
            finally:
                self.messages.put(None)
        threading.Thread(target=read, daemon=True).start()
        try:
            self.call('initialize', {'clientInfo': {'name': 'blackbox_project', 'title': 'BlackBox Project', 'version': '0.2.0'},
                                     'capabilities': {'experimentalApi': False}})
            self._send({'method': 'initialized'})
        except Exception:
            self.close()
            raise

    def _send(self, message):
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()

    def call(self, method, params):
        if method not in READ_METHODS:
            raise ValueError(f'History adapter refuses mutating method: {method}')
        self.request_id += 1
        request_id = self.request_id
        self._send({'id': request_id, 'method': method, 'params': params})
        deadline = min(self.deadline, time.monotonic() + self.timeout)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f'Codex history request timed out: {method}')
            try:
                response = self.messages.get(timeout=remaining)
            except queue.Empty:
                raise TimeoutError(f'Codex history request timed out: {method}') from None
            if response is None:
                self.error_thread.join(timeout=0.1)
                detail = self.stderr_lines[-1] if self.stderr_lines else 'No startup diagnostic available.'
                raise RuntimeError(f'Codex history connection closed: {detail}')
            if 'method' in response and 'id' in response:
                self._send({'id': response['id'], 'error': {'code': -32601, 'message': 'Read-only history client'}})
                continue
            if response.get('id') != request_id:
                continue
            if 'error' in response:
                raise RpcError(response['error'].get('code'), response['error'].get('message', 'History read failed'))
            return response.get('result', {})

    def close(self):
        if getattr(self, 'process', None) and not self.closed:
            self.closed = True
            try:
                self.process.stdin.close()
            except OSError:
                pass
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.process.stdout.close()
            self.error_thread.join(timeout=1)
            self.process.stderr.close()


def redact(text):
    text = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '[REDACTED PRIVATE KEY]', text, flags=re.S)
    text = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b', '[REDACTED TOKEN]', text)
    return re.sub(r'(?i)(\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)(["\']?)[^\s"\',;}]{8,}', r'\1[REDACTED]', text)


def clean_item(item, turn_id):
    kind = item.get('type')
    if kind == 'userMessage':
        content = item.get('content', [])
        text = '\n'.join(part.get('text', '') for part in content if isinstance(part, dict) and part.get('type') in {'text', 'inputText'}) if isinstance(content, list) else str(content)
        role = 'user'
    elif kind == 'agentMessage':
        text, role = item.get('text', ''), 'assistant'
    elif kind == 'fileChange':
        # An AI file edit establishes implementation authorship, not decision ownership.
        text, role = json.dumps([{'path': c.get('path'), 'kind': c.get('kind')} for c in item.get('changes', [])]), 'assistant'
    else:
        return None  # Never export raw reasoning, terminal output, or tool credentials.
    original = redact(str(text))
    return {'id': item.get('id'), 'turnId': turn_id, 'type': kind, 'role': role,
            'text': original[:24000], 'truncated': len(original) > 24000}


def pages(rpc, method, params):
    cursor, seen = None, set()
    while True:
        result = rpc.call(method, dict(params, **({'cursor': cursor} if cursor else {})))
        yield result.get('data', [])
        cursor = result.get('nextCursor')
        if not cursor:
            break
        if cursor in seen:
            raise RuntimeError(f'History pagination repeated a cursor: {method}')
        seen.add(cursor)


def thread_items(rpc, thread_id):
    try:
        return [(row.get('item', {}), row.get('turnId')) for batch in pages(
            rpc, 'thread/items/list', {'threadId': thread_id, 'limit': 100, 'sortDirection': 'asc'}) for row in batch]
    except RpcError as error:
        if not unsupported(error):
            raise
    try:
        turns = [turn for batch in pages(rpc, 'thread/turns/list',
                 {'threadId': thread_id, 'limit': 50, 'sortDirection': 'asc', 'itemsView': 'full'}) for turn in batch]
    except RpcError as error:
        if not unsupported(error):
            raise
        result = rpc.call('thread/read', {'threadId': thread_id, 'includeTurns': True})
        turns = result.get('thread', {}).get('turns', [])
    return [(item, turn.get('id')) for turn in turns for item in turn.get('items', [])]


def collect_history(project, rpc, roots=None):
    roots = [Path(p).resolve() for p in (roots or project_roots(project))]
    result = {'version': 1, 'status': 'available', 'projectRoots': list(map(str, roots)), 'threads': [], 'warnings': []}
    seen_threads = set()
    matched = []
    try:
        for archived in (False, True):
            params = {'limit': 100, 'archived': archived, 'sourceKinds': SOURCE_KINDS,
                      'modelProviders': [], 'useStateDbOnly': True}
            try:
                for batch in pages(rpc, 'thread/list', params):
                    matched.extend((thread, archived) for thread in batch)
            except RpcError as error:
                if error.code != -32602:
                    raise
                # Older clients may not recognize newer source-kind enum values.
                result['warnings'].append('Older Codex source filters: some desktop/subagent history may be unavailable.')
                result['status'] = 'partial'
                params.pop('sourceKinds')
                params.pop('useStateDbOnly')
                for batch in pages(rpc, 'thread/list', params):
                    matched.extend((thread, archived) for thread in batch)
    except (OSError, RuntimeError, TimeoutError) as error:
        result['status'] = 'partial' if matched else 'unavailable'
        result['warnings'].append(str(error))
    for thread, archived in matched:
        cwd = thread.get('cwd')
        if not cwd or not any(inside(Path(cwd).resolve(), root) for root in roots):
            continue
        thread_id = thread.get('id')
        if not thread_id or thread_id in seen_threads:
            continue
        seen_threads.add(thread_id)
        record = {'id': thread_id, 'title': thread.get('name') or thread.get('preview', '')[:120],
                  'cwd': cwd, 'archived': archived, 'forkedFromId': thread.get('forkedFromId'),
                  'updatedAt': thread.get('updatedAt'), 'complete': True, 'items': []}
        try:
            seen_items = set()
            for item, turn_id in thread_items(rpc, thread_id):
                clean = clean_item(item, turn_id)
                key = (turn_id, item.get('id'))
                if clean and key not in seen_items:
                    seen_items.add(key)
                    record['items'].append(clean)
                    if clean['truncated']:
                        result['warnings'].append(f'A message in {thread_id} was truncated; inspect original history for missing evidence.')
                        record['complete'] = False
            if not record['complete']:
                result['status'] = 'partial'
        except (OSError, RuntimeError, TimeoutError) as error:
            record['complete'] = False
            result['status'] = 'partial'
            result['warnings'].append(f'{thread_id}: {error}')
        result['threads'].append(record)
    if not result['threads'] and result['status'] == 'available':
        result['warnings'].append('No locally stored Codex chats matched this project. Decision ownership may be Unknown.')
    return result


def history(project, executable='codex', timeout=20, total_timeout=120):
    rpc = None
    try:
        rpc = CodexRpc(executable, timeout, total_timeout)
        return collect_history(project, rpc)
    except (OSError, RuntimeError, TimeoutError) as error:
        return {'version': 1, 'status': 'unavailable', 'threads': [], 'warnings': [str(error)]}
    finally:
        if rpc:
            rpc.close()
