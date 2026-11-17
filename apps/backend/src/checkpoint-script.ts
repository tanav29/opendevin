// Runs with Python's standard library in E2B and in local preservation tests.
// Export Git objects, never .git configuration, hooks, credentials, or the environment.
export const CHECKPOINT_SCRIPT = String.raw`
import base64, gzip, json, os, pathlib, re, stat, subprocess, sys

MAX_BYTES = 20 * 1024 * 1024
MAX_FILE = 5 * 1024 * 1024
MAX_FILES = 2000
MAX_OBJECTS = 50000
root = pathlib.Path(sys.argv[2]).absolute()
archive = pathlib.Path(sys.argv[3])
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1')

def fail(message):
    raise ValueError(message)

def git(*args, data=None):
    result = subprocess.run(['git', '-c', 'core.hooksPath=' + os.devnull,
        '-c', 'core.fsmonitor=false', *args], cwd=root, env=env,
        input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if result.returncode:
        fail('Git checkpoint operation failed; check for unresolved merges or missing objects.')
    return result.stdout

def safe_path(name):
    parts = name.split('/')
    if not name or any(p in ('', '.', '..') or p.lower() == '.git' for p in parts) or any(c in name for c in '\\\x00\r\n:') or name.startswith('/'):
        fail('Checkpoint contains an unsafe path.')
    return root.joinpath(*parts)

def private_name(name):
    p = name.lower()
    return (p.startswith('.env') and p not in ('.env.example', '.env.sample', '.env.template')) or p in (
        '.ssh', '.aws', '.config', '.gnupg', '.docker', '.kube', '.azure', '.codex', '.netrc', '_netrc', '.npmrc', '.pypirc', '.git-credentials', '.gitconfig', 'auth.json',
        'credentials', 'credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml', 'id_rsa', 'id_ed25519'
    ) or p.endswith(('.pem', '.key', '.p12', '.pfx', '.keystore'))

def private_path(name):
    return any(private_name(p) for p in name.split('/'))

secret_pattern = re.compile(rb'-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})|https?://[^\s/@:]+:[^\s/@]+@', re.I)
secrets = []

def inspect_content(data):
    if secret_pattern.search(data) or any(value in data for value in secrets):
        fail('Checkpoint refused: credential-like content or a configured environment value was found. Remove it from files/history before capture.')

def objects(head, index):
    ids = git('rev-list', '--objects', '--no-object-names', head, index).splitlines()
    if len(ids) > MAX_OBJECTS:
        fail('Checkpoint exceeds 50,000 Git objects. Large histories are not supported.')
    sizes = git('cat-file', '--batch-check', data=b'\n'.join(ids) + b'\n').splitlines()
    if sum(int(line.split()[2]) for line in sizes) > MAX_BYTES:
        fail('Checkpoint Git history exceeds 20 MiB. Large histories are not supported.')
    # Inspect every reachable object, including older commits and staged blobs.
    batch = git('cat-file', '--batch', data=b'\n'.join(ids) + b'\n')
    offset = 0
    for line in sizes:
        end = batch.index(b'\n', offset)
        kind, size = line.split()[1:]
        size = int(size)
        body = batch[end + 1:end + 1 + size]
        offset = end + 2 + size
        if kind == b'tree':
            cursor = 0
            while cursor < len(body):
                space = body.index(b' ', cursor)
                nul = body.index(b'\0', space)
                mode, name = body[cursor:space], body[space + 1:nul].decode('utf-8')
                safe_path(name)
                if private_name(name):
                    fail('Checkpoint refused: Git history/index contains an environment or credential file.')
                if mode in (b'120000', b'160000'):
                    fail('Checkpoints do not support symbolic links or submodules in Git history.')
                cursor = nul + 21
        else:
            inspect_content(body)
    return ids

def capture():
    global secrets
    secrets = [s.encode() for s in json.loads(pathlib.Path(sys.argv[4]).read_text()) if s]
    if root.is_symlink() or not (root / '.git').is_dir() or (root / '.git').is_symlink():
        fail('Checkpoints require a regular Git workspace, not a linked worktree.')
    if git('rev-parse', '--show-object-format').strip() != b'sha1':
        fail('Checkpoints currently support SHA-1 Git repositories only.')
    if git('rev-parse', '--show-toplevel').decode().strip().replace('\\', '/') != root.as_posix():
        fail('Checkpoint workspace must be the repository root.')
    head = git('rev-parse', 'HEAD').decode().strip()
    branch = git('branch', '--show-current').decode().strip()
    index = git('write-tree').decode().strip()
    before = git('status', '--porcelain=v1', '-z', '-uall')
    ids = objects(head, index)
    packed = git('pack-objects', '--stdout', data=b'\n'.join(ids) + b'\n')
    names = set(git('diff', '--name-only', '--no-renames', 'HEAD', '-z').split(b'\0') +
                git('ls-files', '--deleted', '--others', '--exclude-standard', '-z').split(b'\0')) - {b''}
    if len(names) > MAX_FILES:
        fail('Checkpoint exceeds 2,000 changed/untracked files.')
    files, excluded = [], []
    total = len(packed)
    for raw in sorted(names):
        name = raw.decode('utf-8')
        path = safe_path(name)
        if private_path(name):
            excluded.append(name)
            continue
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != root.parent):
            fail('Checkpoints do not support symbolic links.')
        if not path.exists() or path.is_dir():
            files.append(dict(path=name, data=None, executable=False))
            continue
        if not stat.S_ISREG(path.stat().st_mode):
            fail('Checkpoints only support regular files.')
        if path.stat().st_size > MAX_FILE:
            fail('Checkpoint file exceeds 5 MiB.')
        content = path.read_bytes()
        inspect_content(content)
        total += len(content)
        if total > MAX_BYTES:
            fail('Checkpoint exceeds 20 MiB of Git history and file data.')
        files.append(dict(path=name, data=base64.b64encode(content).decode(), executable=bool(path.stat().st_mode & stat.S_IXUSR)))
    shallow_path = root / '.git' / 'shallow'
    shallow = shallow_path.read_text().splitlines() if shallow_path.exists() else []
    payload = dict(version=1, sourceCommit=head, branch=branch, index=index, shallow=shallow,
                   pack=base64.b64encode(packed).decode(), files=files, exclusions=excluded)
    if before != git('status', '--porcelain=v1', '-z', '-uall') or head != git('rev-parse', 'HEAD').decode().strip() or index != git('write-tree').decode().strip():
        fail('Workspace changed during capture. Stop writers and retry.')
    # Re-read changed files to detect edits that leave porcelain status unchanged.
    for item in files:
        path = safe_path(item['path'])
        if (base64.b64encode(path.read_bytes()).decode() if path.exists() and not path.is_dir() else None) != item['data']:
            fail('Workspace changed during capture. Stop writers and retry.')
    encoded = gzip.compress(json.dumps(payload).encode())
    if len(encoded) > MAX_BYTES:
        fail('Encoded checkpoint exceeds 20 MiB.')
    archive.write_bytes(encoded)
    print(json.dumps(dict(sourceCommit=head, branch=branch, fileCount=len(files), byteSize=len(encoded), exclusions=excluded)))

def restore():
    # Only a brand-new, empty workspace may be populated. No rm -rf or arbitrary extraction.
    if root.is_symlink() or (root.exists() and any(root.iterdir())):
        fail('Restore requires a new empty workspace.')
    with gzip.open(archive, 'rb') as stream:
        raw = stream.read(MAX_BYTES * 2 + 1)
    if len(raw) > MAX_BYTES * 2:
        fail('Checkpoint payload exceeds restore limit.')
    payload = json.loads(raw)
    if payload.get('version') != 1 or len(payload['files']) > MAX_FILES:
        fail('Unsupported checkpoint format.')
    for oid in [payload['sourceCommit'], payload['index'], *payload['shallow']]:
        if not re.fullmatch('[0-9a-f]{40}', oid):
            fail('Invalid checkpoint Git object.')
    for item in payload['files']:
        safe_path(item['path'])
        if private_path(item['path']):
            fail('Checkpoint contains a private path.')
    root.mkdir(parents=True, exist_ok=True)
    git('init')
    git('index-pack', '--stdin', data=base64.b64decode(payload['pack'], validate=True))
    if payload['shallow']:
        (root / '.git' / 'shallow').write_text('\n'.join(payload['shallow']) + '\n')
    objects(payload['sourceCommit'], payload['index'])
    branch = payload['branch']
    if branch:
        git('check-ref-format', '--branch', branch)
        git('update-ref', 'refs/heads/' + branch, payload['sourceCommit'])
        git('symbolic-ref', 'HEAD', 'refs/heads/' + branch)
    else:
        git('update-ref', '--no-deref', 'HEAD', payload['sourceCommit'])
    git('reset', '--hard', payload['sourceCommit'])
    git('read-tree', payload['index'])
    for item in payload['files']:
        if item['data'] is not None:
            continue
        path = safe_path(item['path'])
        if path.exists():
            path.unlink()
        for parent in path.parents:
            if parent == root:
                break
            try:
                parent.rmdir()
            except OSError:
                break
    for item in payload['files']:
        if item['data'] is None:
            continue
        path = safe_path(item['path'])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(item['data'], validate=True))
        path.chmod(0o755 if item['executable'] else 0o644)
    print(json.dumps(dict(sourceCommit=payload['sourceCommit'], branch=branch)))

try:
    if sys.argv[1] == 'capture':
        capture()
    elif sys.argv[1] == 'restore':
        restore()
    else:
        fail('Unknown checkpoint operation.')
except Exception as error:
    # Never echo subprocess stderr or file contents, which can contain credentials.
    print(json.dumps(dict(error=str(error) if isinstance(error, ValueError) else 'Checkpoint I/O failed; stop writers and check workspace access.')))
    sys.exit(1)
`;
