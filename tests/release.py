"""Release verification for EMA. Runs entirely with synthetic orders."""
import argparse
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory
from threading import Thread
from time import perf_counter
from urllib.parse import urljoin, urlsplit

from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

from fixture import make_workbook


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@contextmanager
def serve(path):
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(path))) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/"
        finally:
            server.shutdown()
            thread.join()


def monitor(page):
    errors, requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("response", lambda response: errors.append(f"{response.status} {response.url}") if response.status >= 400 else None)
    page.on("requestfailed", lambda request: errors.append(f"{request.failure} {request.url}") if request.failure != "net::ERR_ABORTED" else None)
    page.on("request", lambda request: requests.append(request.url))
    return errors, requests


def load(page, url):
    response = page.goto(url)
    assert response and response.ok, url
    page.set_default_timeout(9500)
    page.wait_for_selector("body[data-view=resumen]")
    assert page.locator("#quickOrder").is_visible()


def import_file(page, file):
    page.locator("#fileInput").set_input_files(file)
    page.locator("#previewBg[open]").wait_for(timeout=120000)


def download(page, selector):
    with page.expect_download() as result:
        page.locator(selector).click()
    return result.value.path().read_bytes()


def verify_dataset(browser, url, directory, sample):
    context = browser.new_context(timezone_id="America/Guatemala")
    page = context.new_page()
    errors, requests = monitor(page)
    load(page, url)
    assert page.locator("#k1").inner_text() == "0"
    synthetic = not sample
    if synthetic:
        sample = directory / "EMA-50-pedidos-de-prueba.xlsx"
        make_workbook(sample)
    import_file(page, sample)
    assert "Q 11,427.75" in page.locator("#previewInfo").inner_text()
    assert page.locator("#previewInfo .preview-chip span").all_text_contents() == ["50", "0", "0", "Q 11,427.75"]
    page.keyboard.press("Escape")
    assert page.evaluate("state.quotes.length") == 0
    import_file(page, sample)
    page.locator("#previewAppend").click()
    page.locator("#tab-btn-resumen").click()
    assert [page.locator(f"#k{i}").inner_text() for i in range(4)] == ["Q 11,427.75", "50", "15", "Q 228.56"]
    assert page.locator("#ks1").inner_text() == "4 vendedores · 3 sucursales"
    import_file(page, sample)
    assert page.locator("#previewInfo .preview-chip span").all_text_contents()[:2] == ["0", "50"]
    page.locator("#previewAppend").click()
    assert page.evaluate("state.quotes.length") == 50
    item_codes = page.evaluate("state.quotes.map(q => q.items.map(i => i.codigo))")
    if synthetic:
        assert item_codes[0][0] == "P000"
    original_codes = page.evaluate("state.quotes.map(q => q.numero)")
    page.locator("#editCurrent").click()
    page.get_by_label("Dirección", exact=True).fill("Dirección ficticia, QA")
    page.locator("#editForm button[type=submit], #editForm .editor-foot button").click()
    assert page.evaluate("state.quotes.map(q => q.numero)") == original_codes
    assert page.evaluate("state.quotes.map(q => q.items.map(i => i.codigo))") == item_codes
    assert page.evaluate("sum(state.quotes)") == 11427.75

    page.locator("#tab-btn-resumen").click()
    branch = page.locator("#dashBranch option").nth(1).get_attribute("value")
    page.select_option("#dashBranch", branch)
    amount = page.locator("#k0").inner_text()
    if synthetic:
        assert branch == "Centro" and amount == "Q 3,825.00"
        page.fill("#from", "2025-04-07")
        assert "parcial" in page.locator("#ks0").inner_text()
        page.fill("#from", "")
        assert page.locator("#k0").inner_text() == amount
    page.locator("#tab-btn-reportes").click()
    assert branch in page.locator("#reportScope").inner_text()
    assert amount in page.locator(".report-total").inner_text()
    book = load_workbook(BytesIO(download(page, "#reportXls")), data_only=True)
    summary = list(book["Resumen"].values)
    orders = list(book["Pedidos"].values)[1:]
    assert all(row[4] == branch for row in orders)
    total = float(amount.replace("Q ", "").replace(",", ""))
    assert summary[-1][:3] == ("TOTAL", len(orders), total)
    assert round(sum(row[5] for row in orders), 2) == total
    assert download(page, "#reportPdf").startswith(b"%PDF")
    page.select_option("#reportGroup", "producto")
    book = load_workbook(BytesIO(download(page, "#reportXls")), data_only=True)
    products = list(book["Resumen"].values)[5:]
    assert round(sum(row[2] for row in products[:-1]), 2) == total

    page.locator("#tab-btn-asistente").click()
    assert amount in page.locator("#answer").inner_text()
    page.locator("#answerSources button").first.click()
    assert page.locator("#found button").count() == len(orders)
    assert any(page.locator("#found button").first.inner_text().startswith(str(row[0])) for row in orders)
    page.keyboard.press("Escape")

    page.locator("#tab-btn-catalogos").click()
    page.select_option("#entityType", "producto")
    product = page.evaluate("state.quotes[0].items[0].descripcion")
    page.fill("#entitySearch", product)
    page.locator("#entities button").first.click()
    page.get_by_label("Nombre", exact=True).fill("Artículo QA renombrado")
    page.locator("#editForm .accent").click()
    assert page.evaluate("(name) => state.quotes.every(q => q.items.every(i => i.descripcion !== name))", product)
    page.locator("#globalSearch").click()
    page.fill("#findText", "articulo renombrado")
    assert page.locator("#found button").count() > 0
    page.keyboard.press("Escape")

    mixed = {"name": "validacion.json", "mimeType": "application/json", "buffer": json.dumps([
        {"numero":"QA-JSON", "cliente":"Cliente QA", "items":[{"codigo":"QA01","descripcion":"Ficticio","cantidad":2,"precio":7,"total":14}]},
        {"numero":"QA-ERROR", "items":[]},
    ]).encode()}
    import_file(page, mixed)
    assert page.locator("#previewInfo .preview-chip span").all_text_contents() == ["1", "0", "1", "Q 14.00"]
    assert b"se omit" in download(page, "#issueReport").lower()
    page.locator("#previewReplace").click()
    page.locator("#modalCancel").click()
    assert page.evaluate("state.quotes.length") == 50
    page.locator("#previewCancel").click()

    page.locator("#fileInput").set_input_files({"name":"invalido.xlsx", "mimeType":"text/plain", "buffer":b"Esto no es Excel"})
    page.get_by_text("La extensión no coincide con un libro de Excel válido.", exact=True).first.wait_for()
    assert page.evaluate("state.quotes.length") == 50
    page.locator("#tab-btn-resumen").click()
    page.keyboard.press("/")
    assert page.evaluate("document.activeElement.id") == "findText"
    page.keyboard.press("Escape")
    assert not errors, errors
    assert all(urlsplit(resource).netloc == urlsplit(url).netloc for resource in requests), requests
    context.close()
    print(f"50 pedidos · Q 11,427.75 · 15 clientes · 4 vendedores · 3 sucursales · {branch}: {amount} ({len(orders)} pedidos)", flush=True)


def load_performance(browser, targets):
    timings = {name: [] for name in targets}
    names = list(targets)
    for run in range(10):
        # Alternate the order to balance out browser warmup and machine load.
        for name in names if run % 2 == 0 else reversed(names):
            context = browser.new_context(viewport={"width":1440,"height":900}, service_workers="block")
            page = context.new_page()
            page.goto(targets[name])
            page.wait_for_selector("body[data-view=resumen]")
            timings[name].append(page.evaluate("""() => {
              const nav = performance.getEntriesByType('navigation')[0];
              const resources = performance.getEntriesByType('resource');
              return [nav.domContentLoadedEventEnd, nav.decodedBodySize +
                resources.reduce((total, item) => total + item.decodedBodySize, 0)];
            }"""))
            context.close()
    for name, records in timings.items():
        results = [round(median(values), 1) for values in zip(*records)]
        print(f"Rendimiento {name} [DOMContentLoaded ms, bytes decodificados]: {results}", flush=True)


def import_performance(browser, url, path, count):
    context = browser.new_context(timezone_id="America/Guatemala")
    page = context.new_page()
    load(page, url)
    page.evaluate("""() => {
      window.qaHeartbeat = [];
      let previous = performance.now();
      window.qaClock = setInterval(() => {
        const now = performance.now();
        window.qaHeartbeat.push(now - previous);
        previous = now;
      }, 16);
    }""")
    start = perf_counter()
    import_file(page, path)
    preview_ms = (perf_counter() - start) * 1000
    beats = page.evaluate("clearInterval(window.qaClock); window.qaHeartbeat")
    assert len(beats) > 5 and max(beats) < 500, beats
    start = perf_counter()
    page.locator("#previewAppend").click()
    page.evaluate("saveQueue")
    save_ms = (perf_counter() - start) * 1000
    assert page.evaluate("state.quotes.length") == count
    assert page.locator("#systemStatusText").inner_text() == "Guardado en este dispositivo"
    page.reload()
    page.wait_for_selector("body[data-view=resumen]")
    assert page.evaluate("state.quotes.length") == count
    context.close()
    print(f"Importación grande · {count:,} pedidos XLSX ({path.stat().st_size:,} bytes) · vista previa {preview_ms:.0f} ms · confirmación y escritura {save_ms:.0f} ms · {len(beats)} latidos, pausa máxima {max(beats):.0f} ms", flush=True)


def mobile_order(browser, url, screenshot=None):
    headers = {"user_agent": "Mozilla/5.0 (Linux; Android 14; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36"}
    context = browser.new_context(viewport={"width":360,"height":800}, device_scale_factor=3,
                                  is_mobile=True, has_touch=True, reduced_motion="reduce", **headers)
    page = context.new_page()
    errors, requests = monitor(page)
    load(page, url)
    if screenshot:
        page.screenshot(path=str(screenshot), full_page=True, animations="disabled")
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    page.locator("#theme").click()
    assert page.locator("html").get_attribute("data-theme") == "dark"
    page.locator("#quickOrder").click()
    page.get_by_label("Número", exact=True).fill("MOBIL-QA-001")
    page.get_by_label("Cliente", exact=True).fill("Cliente ficticio móvil")
    page.get_by_label("Sucursal", exact=True).fill("Sucursal ficticia")
    page.get_by_label("Producto", exact=True).fill("Artículo ficticio móvil")
    page.get_by_label("Cantidad", exact=True).fill("2")
    page.get_by_label("Precio (Q)", exact=True).fill("14.25")
    page.set_viewport_size({"width":360,"height":425})  # Simulates space left above an open keyboard.
    assert page.get_by_label("Cliente", exact=True).input_value() == "Cliente ficticio móvil"
    assert page.get_by_label("Importe (Q)", exact=True).input_value() == "28.5"
    assert page.locator("#editTotal").inner_text() == "Total Q 28.50"
    save = page.locator("#editForm .accent")
    bounds = save.bounding_box()
    assert bounds and bounds["y"] + bounds["height"] <= 425
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth && visualViewport.scale === 1")
    save.tap()
    page.locator("#invoiceWrap").get_by_text("MOBIL-QA-001", exact=True).wait_for()
    assert "Q 28.50" in page.locator("#invoiceWrap").inner_text()
    assert download(page, "#btnPdf").startswith(b"%PDF")
    assert b"MOBIL-QA-001" in download(page, "#btnWord")
    page.locator("#menu").tap()
    page.locator("#tab-btn-historial").tap()
    page.fill("#search", "movil qa")
    assert "1 de 1" in page.locator("#counter").inner_text()
    assert page.locator(".table-scroll").first.evaluate("node => node.scrollWidth > node.clientWidth")
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    page.locator("#menu").tap()
    page.locator("#tab-btn-resumen").tap()
    page.select_option("#dashBranch", "Sucursal ficticia")
    assert page.locator("#k0").inner_text() == "Q 28.50"
    assert not errors, errors
    assert all(urlsplit(resource).netloc == urlsplit(url).netloc for resource in requests), requests
    context.close()
    print(f"Móvil anónimo · {url} · 360 × 800 y 360 × 425 · pedido Q 28.50, búsqueda, filtro, PDF y Word · consola limpia", flush=True)


def verify_update(browser, baseline, site, directory):
    current = directory / "published"
    current.symlink_to(baseline, target_is_directory=True)
    with serve(current) as url:
        context = browser.new_context()
        page = context.new_page()
        page.goto(url)
        page.wait_for_selector("body[data-view=resumen]")
        page.locator("#fileInput").set_input_files(baseline / "EJEMPLOS/PRUEBA_XLSX.xlsx")
        page.locator("#previewBg.open").wait_for()
        page.locator("#previewAppend").click()
        page.evaluate("saveQueue")
        page.wait_for_function("!!navigator.serviceWorker.controller")
        old = page.evaluate("caches.keys()")
        staged = directory / "next"
        staged.symlink_to(site, target_is_directory=True)
        staged.replace(current)
        page.evaluate("navigator.serviceWorker.ready.then(reg => reg.update()).then(() => true)")
        page.locator("#updateShell").wait_for(timeout=15000)
        page.locator("#updateShell").click()
        page.locator("#quickOrder").wait_for(timeout=15000)
        assert page.locator("#k1").inner_text() == "2"
        version = json.loads((site / "precache.json").read_text())["version"]
        page.wait_for_function("(version) => caches.keys().then(keys => keys.length === 1 && keys[0].endsWith(version))", arg=version)
        assert old != page.evaluate("caches.keys()")
        context.set_offline(True)
        page.reload()
        page.wait_for_selector("body[data-view=resumen]")
        assert page.locator("#k1").inner_text() == "2"
        page.locator("#tab-btn-reportes").click()
        assert download(page, "#reportPdf").startswith(b"%PDF")
        context.close()
        print("PWA · actualización desde la edición anterior, pedidos conservados, caché anterior retirada y PDF sin red", flush=True)


def verify_live_assets(browser, url, site):
    context = browser.new_context()
    manifest = context.request.get(urljoin(url, "precache.json"))
    assert manifest.ok
    live = manifest.json()
    local = json.loads((site / "precache.json").read_text())
    assert live == local
    for asset in [*live["files"], "./sw.js"]:
        response = context.request.get(urljoin(url, asset))
        target = site / asset
        assert response.ok and response.body() == target.read_bytes(), asset
    context.close()
    print(f"Publicación anónima · {len(live['files']) + 2} recursos verificados · versión {live['version']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=lambda path: Path(path).resolve())
    parser.add_argument("--baseline", type=lambda path: Path(path).resolve())
    parser.add_argument("--sample", type=Path)
    parser.add_argument("--public")
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    with TemporaryDirectory() as tmp, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get("CHROME_BIN"), args=["--no-sandbox"])
        directory = Path(tmp)
        if args.public:
            verify_live_assets(browser, args.public, args.site)
            mobile_order(browser, args.public)
            return
        with serve(args.site) as url:
            verify_dataset(browser, url, directory, args.sample)
            mobile_order(browser, url, args.screenshot)
            large = directory / "EMA-15000-pedidos-ficticios.xlsx"
            make_workbook(large, 15000)
            import_performance(browser, url, large, 15000)
            if args.baseline:
                with serve(args.baseline) as baseline_url:
                    load_performance(browser, {"anterior": baseline_url, "actual": url})
            else:
                load_performance(browser, {"actual": url})
        if args.baseline:
            verify_update(browser, args.baseline, args.site, directory)


if __name__ == "__main__":
    main()
