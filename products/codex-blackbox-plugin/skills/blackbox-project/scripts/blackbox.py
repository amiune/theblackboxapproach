#!/usr/bin/env python3
"""Local deterministic helpers. Semantic project modeling is performed by Codex."""
import argparse
import json
from pathlib import Path
import sys

from codex_history import history
from model_io import ModelError, prepare_model, read_json, render_html, write_json
from project_scan import inventory


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    scan = commands.add_parser('inventory', help='List eligible files with hashes and explicit exclusions.')
    scan.add_argument('--project', required=True)
    scan.add_argument('--output', required=True)
    scan.add_argument('--artifact-dir')
    scan.add_argument('--max-file-bytes', type=int, default=1024 * 1024)
    chats = commands.add_parser('history', help='Read matching local Codex chats without resuming them.')
    chats.add_argument('--project', required=True)
    chats.add_argument('--output', required=True)
    chats.add_argument('--codex', default='codex')
    chats.add_argument('--timeout', type=float, default=20)
    chats.add_argument('--total-timeout', type=float, default=120)
    for name in ('validate', 'render'):
        command = commands.add_parser(name)
        command.add_argument('--project', required=True)
        command.add_argument('--model', required=True)
        command.add_argument('--inventory')
        command.add_argument('--history')
        if name == 'render':
            command.add_argument('--output-dir', help='Defaults to PROJECT/visualization/blackbox.')
    args = parser.parse_args(argv)
    try:
        if args.command == 'inventory':
            if args.max_file_bytes < 1:
                raise ValueError('max-file-bytes must be positive.')
            data = inventory(args.project, args.artifact_dir, args.max_file_bytes)
            write_json(args.output, data)
            print(json.dumps({'eligibleFiles': len(data['files']), 'excludedEntries': len(data['excluded']), 'warnings': data['warnings']}))
        elif args.command == 'history':
            if args.timeout <= 0 or args.total_timeout <= 0:
                raise ValueError('History timeouts must be positive.')
            data = history(args.project, args.codex, args.timeout, args.total_timeout)
            write_json(args.output, data)
            print(json.dumps({'status': data['status'], 'threads': len(data['threads']), 'warnings': data['warnings']}))
        else:
            raw = read_json(args.model)
            if args.command == 'render':
                raw.setdefault('coverage', {})['outputDir'] = str(Path(args.output_dir or Path(args.project) / 'visualization/blackbox').resolve())
            data = prepare_model(raw, args.project, read_json(args.inventory) if args.inventory else None,
                                 read_json(args.history) if args.history else None)
            if args.command == 'render':
                output = Path(args.output_dir or Path(args.project) / 'visualization/blackbox').resolve()
                if output == Path(args.project).resolve():
                    raise ValueError('Choose an artifact subdirectory, not the project root.')
                output.mkdir(parents=True, exist_ok=True)
                template = Path(__file__).resolve().parents[1] / 'assets/visualizer.html'
                html = render_html(data, template.read_text(encoding='utf-8'))
                # Avoid replacing unrelated existing artifacts.
                existing = output / 'index.html'
                if existing.exists() and 'name="blackbox-artifact"' not in existing.read_text(encoding='utf-8'):
                    raise ValueError('An unrelated index.html occupies the output directory; choose --output-dir.')
                write_json(output / 'model.json', data)
                existing.write_text(html, encoding='utf-8')
                print(json.dumps({'html': str(existing), 'model': str(output / 'model.json'), 'coverageComplete': data['coverage']['complete'], 'warnings': len(data['warnings'])}))
            else:
                print(json.dumps({'valid': True, 'boxes': len(data['boxes']), 'dataStructures': len(data['dataStructures']),
                                  'decisions': len(data['decisions']), 'coverageComplete': data['coverage']['complete'], 'warnings': data['warnings']}))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
