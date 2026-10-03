#!/usr/bin/env python3
"""Preview or apply only the reviewed desktop source patch; never copy runtime state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

PATCH_FILES = {'src/state.js', 'src/settings-renderer.js', 'hooks/kimi-hook.js', 'src/settings-agent-order.js', 'test/watch-approval-store.test.js', 'docs/guides/setup-guide.md', 'test/doctor-agent-descriptors.test.js', 'docs/guides/setup-guide.zh-CN.md', 'src/doctor-detectors/agent-descriptors.js', 'src/agent-runtime-main.js', 'README.zh-CN.md', 'src/settings-tab-watch.js', 'agents/deepseek-monitor.js', 'src/settings-actions.js', 'test/codex-notify-subgate.test.js', 'README.md', 'test/agent-runtime-main.test.js', 'test/watch-approval-queue.test.js', 'test/server-kimi-permission.test.js', 'README.ko-KR.md', 'test/watch-approval-apns.test.js', 'src/settings-i18n.js', 'docs/project/agent-runtime-architecture.md', 'test/permission-autoclose-dismiss.test.js', 'src/server-route-permission.js', 'agents/deepseek-harness.js', 'src/main.js', 'src/watch-approval-queue.js', 'test/kimi-hook-permission.test.js', 'test/watch-approval-service.test.js', 'docs/guides/known-limitations.zh-CN.md', 'src/permission.js', 'src/watch-approval-store.js', 'test/kiro-install.test.js', 'hooks/kimi-install.js', 'src/watch-approval-delivery.js', 'test/watch-approval-server.test.js', 'src/watch-approval-pairing-preload.js', 'test/install.test.js', 'test/state-kimi-permission.test.js', 'test/watch-approval-settings.test.js', 'src/watch-approval-pairing.html', 'test/permission-kimi-response.test.js', 'src/watch-approval-service.js', 'test/watch-approval-contract.test.js', 'src/watch-approval-server.js', 'src/watch-approval-pairing-renderer.js', 'test/doctor-installer-defaults.test.js', 'test/permission-deepseek-response.test.js', 'test/registry.test.js', 'agents/registry.js', 'test/watch-approval-delivery.test.js', 'src/settings.html', 'src/watch-approval-apns.js', 'docs/guides/known-limitations.md', 'test/deepseek-monitor.test.js', 'src/watch-approval-settings.js', 'test/server-route-permission.test.js', 'src/prefs.js', 'test/updater.test.js', 'src/dashboard-renderer.js', 'README.ja-JP.md'}

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def safe_file(root, relative):
    file = root / relative
    for part in [root, *file.parents]:
        if part == root.parent:
            break
        if part.is_symlink():
            raise RuntimeError(f'Symlink path prohibited: {part}')
    if file.is_symlink() or (file.exists() and not file.is_file()):
        raise RuntimeError(f'Unsafe source destination: {relative}')
    return file

def run(args):
    project = Path(args.project).absolute()
    target = Path(args.target).absolute()
    baseline = json.loads((project / 'desktop-patch/base-manifest.json').read_text())['files']
    changes = []
    for relative in sorted(PATCH_FILES):
        source = safe_file(project / 'desktop-patch', relative)
        if not source.exists():
            continue
        patched_hash = sha(source)
        expected = baseline.get(relative)
        if patched_hash == expected:
            continue
        destination = safe_file(target, relative)
        current = sha(destination) if destination.exists() else None
        if current != expected:
            raise RuntimeError(f'Live source changed; refusing patch: {relative}')
        changes.append({'path': relative, 'originalSHA256': current, 'patchedSHA256': patched_hash})
    print(json.dumps({'target': str(target), 'mode': 'apply' if args.apply else 'check', 'files': changes}, indent=2))
    if not args.apply:
        return
    if not args.backup:
        raise RuntimeError('--apply requires a new --backup directory')
    backup = Path(args.backup).absolute()
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    for item in changes:
        relative = item['path']
        original = safe_file(target, relative)
        if original.exists():
            saved = backup / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, saved)
            if sha(saved) != item['originalSHA256']:
                raise RuntimeError('Backup verification failed')
    manifest = backup / 'patch-manifest.json'
    manifest.write_text(json.dumps({'target': str(target), 'files': changes}, indent=2))
    os.chmod(manifest, 0o600)
    # Recheck the entire patch immediately before writing; concurrent edits stop it.
    for item in changes:
        destination = safe_file(target, item['path'])
        actual = sha(destination) if destination.exists() else None
        if actual != item['originalSHA256']:
            raise RuntimeError(f'Live source changed during backup: {item["path"]}')
    for item in changes:
        destination = safe_file(target, item['path'])
        source = safe_file(project / 'desktop-patch', item['path'])
        if sha(source) != item['patchedSHA256']:
            raise RuntimeError('Development source changed during patch')
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.clawd-watch-', dir=destination.parent)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(source.read_bytes()); out.flush(); os.fsync(out.fileno())
            os.chmod(temporary, destination.stat().st_mode & 0o777 if destination.exists() else 0o644)
            destination = safe_file(target, item['path'])
            actual = sha(destination) if destination.exists() else None
            if actual != item['originalSHA256']:
                raise RuntimeError(f'Live source changed while installing: {item["path"]}; partial patch retained with backup')
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print(f'Applied {len(changes)} source files. Recovery: {backup}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument('--target', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    parser.add_argument('--backup')
    try:
        run(parser.parse_args())
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr); sys.exit(1)
