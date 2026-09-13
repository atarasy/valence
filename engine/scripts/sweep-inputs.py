#!/usr/bin/env python3
"""Hash the measurement inputs, including unit tests and effective settings."""
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import sys

engine = Path(__file__).resolve().parent.parent
tests = Path(os.environ.get('ATARAXIA_TESTS', Path.home() / 'Documents/GitHub/ataraxia/tests')).resolve()
hash_ = hashlib.sha256()
def add(label, content):
    hash_.update(label.encode() + b'\0' + content + b'\0')
for root in (engine / 'src', engine / 'scripts', engine / 'test', tests):
    if not root.is_dir():
        raise SystemExit(f'measurement directory missing: {root}')
    for path in sorted(root.rglob('*')):
        if path.is_file() and not {'node_modules', '__pycache__', '.git'}.intersection(path.parts):
            add(str(path), path.read_bytes())
for name in ('package.json', 'tsconfig.json', 'bun.lock', 'bun.lockb'):
    path = engine / name
    add(str(path), path.read_bytes() if path.exists() else b'<absent>')
add('platform', platform.platform().encode())
add('python', sys.version.encode())
for command in (['bun', '--version'], ['bash', '--version']):
    add(command[0], subprocess.check_output(command))
# Output locations do not affect behaviour; all other Valence settings do.
excluded = {'VALENCE_SWEEP_HOME', 'VALENCE_LOG_DIR'}
for key, value in sorted(os.environ.items()):
    if (key.startswith(('VALENCE_', 'METER_', 'ATARAXIA_')) and key not in excluded) or key in {'PORT', 'SUITES', 'TZ', 'NODE_ENV', 'BUN_OPTIONS'}:
        add(key, value.encode())
print(hash_.hexdigest()[:24])
