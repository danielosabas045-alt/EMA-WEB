# EMA Enterprise — Next Generation

Aplicación de pedidos y análisis de mayoreo en quetzales. [Abrir EMA](https://danielosabas045-alt.github.io/EMA-WEB/).

## Código fuente editable

Descargá [EMA-Enterprise.zip](./EMA-Enterprise.zip) y extraé la carpeta `EMA-Enterprise/`. Incluye la aplicación de `web/`, los adaptadores Android, las pruebas y los scripts de compilación. Las rutas de desarrollo que se indican abajo corresponden a esa carpeta. El ZIP con prefijo `EMA-MAYOREO-WEB` es el paquete estático de distribución compatible con la publicación anterior.

## Uso

1. Abrí **Resumen**. Los indicadores muestran la base local. **Explorar demo** cambia únicamente el conjunto de análisis y señala los datos ficticios en pantalla y en las exportaciones.
2. En **Pedidos**, creá un pedido o elegí **Importar pedidos**. También podés soltar el archivo en la zona de carga. EMA acepta XLS, XLSX, XLSM, CSV, JSON y reportes antiguos HTML con extensión XLS. El límite por archivo es 20 MiB. Revisá los totales, las observaciones y los duplicados antes de confirmar. **Combinar** actualiza los números existentes. **Reemplazar** sustituye la base de pedidos.
3. En **Historial**, buscá por número, cliente, dirección o vendedor. Podés editar, eliminar con confirmación o abrir la factura. **Pedidos** ofrece vista previa, Word, PDF e impresión individual y por vendedor. La lupa busca también sucursales y productos.
4. **Catálogos** reúne los nombres importados y las altas manuales. Renombrar un registro actualiza los pedidos relacionados. Un registro sin pedidos vinculados se puede eliminar. **Actividad** permite recuperar pedidos eliminados individualmente mientras se conserve el movimiento.
5. Aplicá los filtros de fecha, vendedor y sucursal en **Resumen**. Tocá un dato del gráfico para explorar su período o grupo. **Reportes** usa la misma selección para generar PDF y Excel por día, mes, vendedor o sucursal. **Asistente EMA** calcula comparaciones, resúmenes, alertas y estimaciones en el dispositivo.
6. En **Actividad**, descargá un respaldo JSON. **Historial → Restaurar respaldo** recupera pedidos, catálogos, auditoría e historial de importaciones. Un respaldo exportado puede contener tus datos de trabajo. Guardalo en un lugar privado.

## Persistencia y privacidad

Los datos pertenecen al navegador y al dispositivo. Se guardan en IndexedDB, con copia en almacenamiento local cuando hay espacio. La edición conserva las claves de la versión anterior. Al borrar los datos del sitio se pierde la copia local. El respaldo JSON permite trasladarla manualmente. El historial de operaciones guarda los últimos 120 movimientos y se puede modificar desde el propio dispositivo.

La página pública entrega archivos estáticos. La importación, los documentos y el análisis se procesan localmente. La lectura de XLSM utiliza los valores disponibles en el libro. Las macros no se ejecutan. Los ejemplos de web/EJEMPLOS son ficticios. La instalación PWA usa el menú del navegador; en iOS, Compartir y Agregar a inicio. Después de la primera descarga completa se puede volver a abrir sin red. Las nuevas versiones ofrecen el botón Actualizar EMA.

## Arquitectura y desarrollo

La fuente editable está en `web/`. `app.js` conserva las facturas, el historial, la persistencia y la impresión. `parser.js` reconoce columnas y normaliza pedidos. `import-worker.js` procesa los libros en un hilo separado. Los reportes HTML heredados se leen desde una plantilla inerte. `enterprise.js` conecta los catálogos, filtros, reportes y análisis. `charts.js` dibuja SVG accesibles. Las versiones locales de SheetJS CE 0.20.3 y jsPDF 4.2.1 y sus licencias están en `web/lib/`.

```sh
python3 build_web.py site
python3 -m http.server 8000 --directory site
```

La salida debe estar vacía antes de compilar. El proceso genera el inventario de recursos y la versión de la caché. Los cambios en main activan **EMA Web** en GitHub Actions. El destino es GitHub Pages. La compilación de Android empaqueta las mismas fuentes con adaptadores para archivos e impresión.

## Verificación y alcance

La prueba de navegador usa Playwright para Python y Chromium. Ejecutar `python3 tests/browser.py site` tras compilar. Se puede indicar otro Chromium mediante la variable CHROME_BIN. Las pruebas usan pedidos ficticios en una sesión temporal.

Pruebas funcionales en Chromium 158: importación de XLS binario, XLS con tabla HTML, XLSX, XLSM sin macros, CSV y JSON; exportación de informes PDF y XLSX; factura PDF y Word; composición del documento para imprimir; edición, eliminación y recuperación de pedidos; restauración JSON; catálogos; filtros de demostración; persistencia; uso sin red y menú móvil a 360 píxeles.

| Mediana de siete cargas locales | Versión anterior | Enterprise |
| --- | ---: | ---: |
| DOMContentLoaded | 143,9 ms | 33,1 ms |
| Bytes decodificados en la carga inicial | 1.443.919 | 185.313 |

Misma máquina, Chrome Headless Shell 158, siete contextos nuevos por versión, HTTP local, caché fría y service worker bloqueado para medir la carga inicial. El precargado posterior para uso sin conexión descarga también los módulos de Excel y PDF. Los tiempos no equivalen a una medición física en Android.

Esta edición trabaja en un solo dispositivo. Usuarios con roles, auditoría central y sincronización entre equipos requieren un backend independiente. Las estimaciones emplean tres meses consecutivos con datos, anteriores al mes actual. Las comparaciones emplean los meses dentro del filtro; un mes parcial representa solamente su actividad registrada. Los pedidos de origen carecen de coordenadas verificadas para un mapa. Las pruebas de impresión abarcan el documento digital; la salida en papel y la instalación física en iOS dependen de los equipos.
