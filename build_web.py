"""Prepare the static EMA application for Pages or the Android wrapper."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parent
source = root / "web"
target = Path(sys.argv[1] if len(sys.argv) > 1 else "site").resolve()
if target == source or target.is_relative_to(source) or source.is_relative_to(target):
    raise SystemExit("El destino debe estar separado de las fuentes.")
if target.exists() and any(target.iterdir()):
    raise SystemExit("El directorio de salida debe estar vacío.")
shutil.copytree(source, target, dirs_exist_ok=True)
files = sorted(p for p in target.rglob("*") if p.is_file())
digest = hashlib.sha256()
for path in files:
    digest.update(path.relative_to(target).as_posix().encode() + b"\0")
    digest.update(hashlib.sha256(path.read_bytes()).digest())
version = digest.hexdigest()[:24]
worker = target / "sw.js"
worker.write_text(worker.read_text().replace("__EMA_BUILD_VERSION__", version))
(target / "precache.json").write_text(json.dumps({
    "version": version, "files": ["./" + p.relative_to(target).as_posix() for p in files if p != worker]
}))
print(f"EMA Web {version} · {len(files)} archivos")
