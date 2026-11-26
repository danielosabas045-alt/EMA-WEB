"""Package the same static edition as Pages, plus its local Android adapters."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "app/src/main/assets/ema"
ASSETS.parent.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(dir=ASSETS.parent) as directory:
    stage = Path(directory)
    site = stage / "site"
    subprocess.run([sys.executable, str(ROOT / "build_web.py"), str(site)], check=True)
    for extension in ("js", "css"):
        name = f"android-mobile.{extension}"
        shutil.copy2(ROOT / name, site / name)
    index = site / "index.html"
    html = index.read_text(encoding="utf-8")
    if "</head>" not in html or "</body>" not in html:
        raise ValueError("El documento principal de EMA no está completo.")
    html = html.replace("</head>", '<link rel="stylesheet" href="android-mobile.css">\n</head>', 1)
    html = html.replace("</body>", '<script defer src="android-mobile.js"></script>\n</body>', 1)
    index.write_text(html, encoding="utf-8")
    # The old file URL must stay exactly the same for on-device data migration.
    shutil.copy2(ROOT / "android/migrate.html", stage / "index.html")
    shutil.copy2(ROOT / "android/migrate.js", stage / "migrate.js")
    subprocess.run(["node", "--check", str(site / "android-mobile.js")], check=True)
    subprocess.run(["node", "--check", str(stage / "migrate.js")], check=True)
    if ASSETS.exists():
        shutil.rmtree(ASSETS)
    shutil.copytree(stage, ASSETS)
print("EMA Enterprise preparada para Android.")
