# EMA Enterprise — Next Generation

Aplicación local de pedidos y análisis de mayoreo en quetzales. [Abrir EMA en GitHub Pages](https://danielosabas045-alt.github.io/EMA-WEB/).

## Operación

- **Resumen** ofrece crear un pedido, importar un archivo y buscar pedidos guardados. Los filtros por fecha, vendedor y sucursal se comparten con **Reportes** y **Asistente EMA**. El rendimiento por producto suma las líneas y muestra por separado los ajustes entre las líneas y el total del pedido. La comparación mensual requiere meses consecutivos cerrados, incluidos por completo en el filtro y con un importe base distinto de cero.
- **Pedidos** conserva la factura de media carta, con vista previa, impresión, PDF y Word. En **Historial** se puede buscar por número, código, cliente, producto, vendedor, dirección o sucursal. Los pedidos eliminados individualmente se pueden recuperar mientras su movimiento permanezca en **Actividad**.
- **Importación** lee XLS, XLSX, XLSM, XLSB, CSV, JSON y tablas HTML de reportes históricos, incluso con extensión XLS. La vista previa separa nuevos y existentes, cuenta las filas con errores o avisos y muestra en quetzales el total de los pedidos que se cargarán. **Agregar** incorpora nuevos y actualiza los números existentes. **Reemplazar** pide confirmación si hay pedidos guardados y deja solo los del archivo. XLSM usa los valores del libro y nunca ejecuta macros.
- **Catálogos** actualiza los nombres en los pedidos vinculados y conserva sus códigos. **Reportes** exporta Excel con el resumen y el detalle de pedidos, y PDF con los filtros y totales. **Asistente EMA** muestra el período del cálculo y abre los pedidos que respaldan las cifras. La demostración usa pedidos ficticios independientes de la base local.
- **Actividad** permite descargar y restaurar respaldos JSON. La restauración reemplaza pedidos, catálogos y actividad después de confirmar. Guardá los respaldos en privado porque pueden contener datos comerciales.

## Almacenamiento y funcionamiento sin conexión

EMA conserva las claves de las versiones anteriores. Guarda en IndexedDB y, si hay espacio, en almacenamiento local. El sitio procesa y exporta los datos en el dispositivo. Si borrás los datos del navegador, podés restaurarlos desde un respaldo. No hay cuentas, sincronización entre dispositivos ni servicio de análisis externo. Después de la primera descarga completa, la PWA funciona sin conexión. **Actualizar EMA** espera la escritura pendiente y activa la nueva caché. En Android se conserva el origen local de la edición anterior y el adaptador de migración.

La importación admite archivos de hasta 20 MiB, con límites adicionales de 5 MiB para HTML, 96 MiB descomprimidos para libros ZIP y 100.000 filas o dos millones de celdas por hoja. La actividad conserva hasta 120 movimientos y el historial de importaciones guarda una muestra de hasta 200 pedidos por carga.

## Fuentes y publicación

La fuente editable de la aplicación está en `web/`. Pages y el APK usan `build_web.py`. Android añade los adaptadores de archivos, impresión y migración con `android_prepare.py`. El build genera el inventario y la versión de la caché. El workflow **EMA Web** publica Pages al actualizar `main` y genera `EMA-Enterprise.zip` como artefacto de fuentes del commit. **Compilar APK de EMA** genera el APK de depuración.

La publicación anterior en `bacb199` descomprimía `EMA-Enterprise.zip` antes de compilar tanto Pages como Android. La página y el ZIP estático del directorio raíz pertenecían a una distribución anterior. Se puede recuperar ese estado a partir de su commit y del bundle privado verificado con un clon, `git fsck`, hash del árbol archivado y prueba del ZIP. El bundle se mantuvo fuera del repositorio.

```sh
python3 build_web.py site
python3 -m http.server 8000 --directory site
```

`site` debe estar vacío antes de compilar. SheetJS CE 0.20.3 y jsPDF 4.2.1 se sirven desde `web/lib/`, con sus licencias. Se verificó el SHA-256 contra la distribución oficial de cada versión. `npm audit` de jsPDF 4.2.1 devolvió cero avisos. En CI, la compilación declara `contents: read` y descarta las credenciales de checkout. Solo el trabajo de despliegue recibe `pages: write` e `id-token: write`.

## Pruebas reproducibles

```sh
python3 -m pip install playwright openpyxl
python3 -m playwright install chromium
python3 tests/browser.py site
python3 tests/release.py site
```

`CHROME_BIN` permite usar un Chromium instalado. `tests/release.py` acepta `--baseline <build-anterior>` para medir ambos builds y probar la actualización PWA. `--public <URL>` comprueba los recursos publicados y repite el pedido móvil con una sesión anónima.

El archivo original `EMA-50-pedidos-de-prueba.xlsx` no estaba en el repositorio ni entre los archivos disponibles en el workspace. La prueba genera un XLSX ficticio con `python3 tests/fixture.py EMA-50-pedidos-de-prueba.xlsx`. Valores esperados y observados en una base vacía:

| Control | Resultado |
| --- | ---: |
| Pedidos | 50 |
| Ventas | Q 11,427.75 |
| Clientes, vendedores y sucursales | 15, 4 y 3 |
| Ticket promedio | Q 228.56 |
| Pedidos después de reimportar | 50 |
| Sucursal Centro, pantalla y Excel | 17 pedidos · Q 3,825.00 |

Pruebas en Chromium 156.0.8078.79. Se verificaron formatos históricos, archivos malformados, cancelación, edición con códigos intactos, renombrado en catálogo, búsqueda, recuperación, respaldo, restauración, PDF, Word e impresión digital. La prueba PWA conservó dos pedidos de la edición anterior al activar la nueva caché y exportó un PDF sin conexión. La prueba móvil usó un perfil emulado de Galaxy A53 a 360 × 800 y 360 × 425 CSS px. La altura reducida simula el espacio disponible encima del teclado. Se mantuvieron los campos y el botón Guardar quedó visible sin zoom. No hubo errores de consola en los flujos controlados.

| Mediana de 10 cargas frías por edición | Anterior | Actual |
| --- | ---: | ---: |
| DOMContentLoaded | 203,3 ms | 221,1 ms |
| Bytes decodificados en la carga inicial | 185.654 | 168.350 |

Misma máquina, Chromium headless, HTTP local, base vacía, contextos nuevos y service worker bloqueado durante las mediciones. Se alternó el orden de las ediciones. Un XLSX de 15.000 pedidos y 627.931 bytes produjo la vista previa en 1.491 ms. Confirmar y escribir tomó otros 370 ms. Durante la lectura se midieron 84 latidos de la interfaz a intervalos de 16 ms, con una pausa máxima de 112 ms. La prueba volvió a abrir los 15.000 pedidos después de recargar.

Quedan pendientes la validación del teclado y de la instalación en un teléfono físico, la migración de una instalación Android real y la impresión en papel.
