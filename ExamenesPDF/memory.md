# Memory

## Proyecto

Aplicacion offline para separar y opcionalmente anonimizar PDFs escaneados con examenes de alumnos.

Ruta prevista:

- Proyecto: `C:\Users\victo\Documents\GitHub\Herramientas\ExamenesPDF`
- Entregable portable: `C:\Users\victo\Documents\GitHub\Herramientas\ExamenesPDF\App`

## Objetivo funcional

La aplicacion recibe un unico PDF con examenes escaneados y genera un ZIP descargable con:

- Un PDF por alumno: `Alumno01.pdf`, `Alumno02.pdf`, etc.
- Si se activa anonimizar: PDFs con el nombre cubierto y sustituido por un codigo.
- Si se activa anonimizar: un archivo final de correspondencias entre nombre detectado y codigo asignado.

## Contexto de la version anterior

La muestra `ApiPDF - ChatGPT.html`:

- Trocea correctamente cuando detecta portadas mediante OCR.
- Usa `pdf.js`, `pdf-lib`, `JSZip`, `FileSaver` y `Tesseract.js` desde CDN.
- No es offline porque carga librerias, worker y OCR desde internet.
- No anonimiza de forma fiable.

## Decisiones iniciales

- Todo lo que necesite ejecutar un usuario no tecnico debe vivir dentro de `App`.
- No debe requerir instalacion ni internet.
- La primera version se ejecuta con `App\Iniciar_App.bat`, que levanta un servidor local en `localhost`.
- Las dependencias externas deben copiarse en `App/vendor`.
- El procesamiento debe hacerse localmente en el navegador; ningun PDF sale del equipo.
- La deteccion de portadas debe ser revisable: mostrar paginas detectadas y rangos antes de generar el ZIP.

## Estado inicial implementado

- `App/index.html`: interfaz de carga, deteccion, revision, anonimizado y generacion ZIP.
- `App/js/app.js`: logica de PDF, OCR, ZIP sin compresion externa y anonimizado por zona porcentual.
- `App/css/styles.css`: estilos de utilidad sobrios y responsivos.
- `App/server.ps1` y `App/Iniciar_App.bat`: servidor local offline para evitar problemas con workers desde `file://`.
- `App/vendor`: copias locales de `pdf.js`, `pdf-lib`, `tesseract.js`, cores de `tesseract.js-core` y datos OCR `spa`/`eng`.

## Verificacion realizada

- La app carga en `http://localhost:8765/` sin errores de consola.
- `App/js/app.js` pasa comprobacion sintactica con Node.
- No hay dependencias CDN en los archivos propios de `App`; solo se usa `localhost` para el servidor local.

## Revision tras primera prueba de uso

- La carga del PDF ahora tiene `try/catch`, progreso y errores visibles.
- La vista previa inicial ya no bloquea el uso si falla o tarda con un escaneo pesado.
- La localizacion de nombres ya no depende solo de una zona fija:
  - modo OCR busca etiquetas `Nombre`, `Apellidos`, `Alumno` o `Alumna`;
  - calcula una zona alrededor del texto escrito o a la derecha de la etiqueta;
  - puede repetir la busqueda en todas las paginas si el alumno escribe el nombre en cada hoja;
  - el modo por defecto usa zona manual como respaldo si el OCR no encuentra la etiqueta.

## Correccion OCR local

- El error generico `Error durante el OCR` estaba causado por recursos locales incompletos de `tesseract.js-core`.
- Tesseract 7 intentaba cargar `tesseract-core-relaxedsimd-lstm.wasm.js`, que no estaba en `App/vendor/tesseract-core`.
- Se copiaron las seis variantes locales del core:
  - `tesseract-core.wasm.js`
  - `tesseract-core-lstm.wasm.js`
  - `tesseract-core-simd.wasm.js`
  - `tesseract-core-simd-lstm.wasm.js`
  - `tesseract-core-relaxedsimd.wasm.js`
  - `tesseract-core-relaxedsimd-lstm.wasm.js`
- La app importa ahora `tesseract.esm.min.js` como modulo local y usa `workerBlobURL: false`.
- Diagnostico verificado: carga core, idiomas `spa+eng` y API correctamente desde `localhost`.

## Correccion del lanzador `.bat`

- `server.ps1` ya no usa `System.Net.HttpListener`, porque puede fallar en Windows por permisos o reservas URL al abrir desde doble clic.
- Ahora usa `System.Net.Sockets.TcpListener` en `127.0.0.1` y busca puerto libre entre `8765` y `8799`.
- Si el navegador no se abre automaticamente, la ventana muestra la URL local para abrirla manualmente.
- Verificado: el nuevo servidor sirve `index.html`, `js/app.js`, `tesseract-core-relaxedsimd-lstm.wasm.js` y `spa.traineddata.gz`.

## Mejoras de anonimizado y revision

- La zona manual de anonimizado se puede mover arrastrando el recuadro rojo en la vista previa.
- El recuadro se puede redimensionar arrastrando sus bordes o esquinas; los campos `X`, `Y`, `Ancho` y `Alto` se actualizan automaticamente.
- En la primera pagina de cada examen se cubre el nombre y se escribe el codigo sobre la zona cubierta.
- En paginas posteriores, el codigo se escribe arriba del todo y pegado al borde para no tapar contenido del examen.
- En paginas posteriores, la busqueda de nombres queda limitada a la zona alta de la hoja.
- Tras reconocer el nombre en la primera pagina, el OCR busca duplicados aproximados de ese nombre en la zona alta de las paginas secundarias y cubre esas zonas en blanco.
- Si la pasada OCR de pagina completa no encuentra duplicados en paginas secundarias, se recorta la franja superior, se amplia, se mejora el contraste y se lanza una segunda pasada OCR solo sobre esa franja.
- El listado principal de correspondencias se genera como `correspondencias.xlsx`, con el nombre aproximado en la primera columna. Se mantienen CSV/TXT como respaldo.

## Riesgos conocidos

- La anonimimizacion perfecta en escaneos depende de OCR y de la calidad de imagen.
- Los nombres manuscritos son mucho mas dificiles que texto impreso.
- Para anonimizar de forma robusta hay que permitir ajuste manual de la zona de nombre por pagina/portada.
- Abrir HTML desde `file://` puede limitar workers o WASM en algunos navegadores; si ocurre, habra que incluir un lanzador local simple.
