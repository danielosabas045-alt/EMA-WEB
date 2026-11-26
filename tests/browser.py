import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from functools import partial
from threading import Thread
root=Path(sys.argv[1] if len(sys.argv)>1 else 'site')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
http=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root)))
Thread(target=http.serve_forever,daemon=True).start()
url='http://127.0.0.1:'+str(http.server_port)
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('CHROME_BIN'),args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':1400,'height':900});p=ctx.new_page();p.set_default_timeout(6500);errors=[]
 p.on('pageerror',lambda e:(print('PAGE',e,flush=True),errors.append(str(e))))
 p.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 p.on('dialog',lambda d:d.accept())
 p.goto(url);p.wait_for_selector('body[data-view=resumen]');click=lambda s:p.locator(s).first.click()
 assert p.inner_text('#k1')=='0'
 click('#demo');assert p.inner_text('#k1')=='24';p.select_option('#dashSeller',index=1);assert int(p.inner_text('#k1'))<24
 click('#demo')
 for file in sorted((root/'EJEMPLOS').iterdir()):
  p.set_input_files('#fileInput',str(file));p.wait_for_selector('#previewBg.open');click('#previewAppend');assert p.evaluate('state.quotes.length')==2
 print('4 imports',flush=True)
 p.evaluate("setTab('resumen')");assert p.inner_text('#k1')=='2'
 click('#tab-btn-reportes')
 for id,ext in [('reportXls','.xlsx'),('reportPdf','.pdf')]:
  with p.expect_download() as info:click('#'+id)
  assert info.value.suggested_filename.endswith(ext) and info.value.path().stat().st_size>300
 click('#tab-btn-historial');click('[data-act=edit]');p.get_by_label('Sucursal',exact=True).last.fill('Sede demo QA');click('#editForm .accent');click('#tab-btn-historial');click('[data-act=del]');click('#modalOk');assert p.evaluate('state.quotes.length')==1
 click('#tab-btn-actividad');p.get_by_role('button',name='Recuperar',exact=True).click();assert p.evaluate('state.quotes.length')==2
 with p.expect_download() as info:click('#btnBackup')
 backup=info.value.path().read_bytes()
 click('#tab-btn-historial');p.set_input_files('#restoreInput',{'name':'respaldo.json','mimeType':'application/json','buffer':backup});click('#modalOk');p.get_by_text('Respaldo restaurado correctamente.',exact=True).wait_for()
 # JSON import and Excel macro-enabled workbook with no macros.
 q=p.evaluate("JSON.parse(JSON.stringify(state.quotes[0]))")
 p.set_input_files('#fileInput',{'name':'qa-demo.json','mimeType':'application/json','buffer':json.dumps([q]).encode()})
 p.wait_for_selector('#previewBg.open');click('#previewCancel')
 from io import BytesIO
 from zipfile import ZipFile,ZIP_DEFLATED
 output=BytesIO()
 with ZipFile(root/'EJEMPLOS/PRUEBA_XLSX.xlsx') as zin, ZipFile(output,'w',ZIP_DEFLATED) as zout:
  for name in zin.namelist():
   data=zin.read(name)
   if name=='[Content_Types].xml':data=data.replace(b'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',b'application/vnd.ms-excel.sheet.macroEnabled.main+xml')
   zout.writestr(name,data)
 p.set_input_files('#fileInput',{'name':'demo.xlsm','mimeType':'application/vnd.ms-excel.sheet.macroEnabled.12','buffer':output.getvalue()});p.wait_for_selector('#previewBg.open');click('#previewCancel')
 print('PASS XLSM, JSON, backup restore',flush=True)
 click('#tab-btn-catalogos');click('#newEntity');p.get_by_label('Nombre',exact=True).fill('Demo QA');click('#editForm .accent');assert 'Demo QA' in p.inner_text('#entities')
 click('#tab-btn-pedidos')
 for id in ['btnPdf','btnWord']:
  with p.expect_download() as info:click('#'+id)
  assert info.value.path().stat().st_size>300
 p.evaluate("""() => {const open=window.open;window.open=(...args)=>{const win=open(...args);win.print=()=>{};return win;};}""")
 with p.expect_popup() as pop:click('#btnPrint')
 assert pop.value.locator('.invoice').count()==1;pop.value.close()
 p.reload();p.wait_for_selector('body[data-view=resumen]');assert p.inner_text('#k1')=='2'
 p.evaluate("navigator.serviceWorker.ready.then(()=>true)");ctx.set_offline(True);p.reload();p.wait_for_selector('body[data-view=resumen]');assert p.inner_text('#k1')=='2';ctx.set_offline(False)
 p.set_viewport_size({'width':360,'height':800});p.wait_for_timeout(500);assert p.evaluate('document.documentElement.scrollWidth<=innerWidth');click('#menu');click('#tab-btn-asistente');assert p.inner_text('#answer')
 assert not errors,errors
 print('PASS reports, edit, delete, restore, catalog, PDF, Word, print, persistence, mobile, offline',flush=True)
