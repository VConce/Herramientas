# Separador y anonimizador de examenes

## Uso rapido

1. Ejecuta `Iniciar_App.bat`.
2. Se abrira el navegador con la aplicacion local. Si no se abre, copia en el navegador la direccion que aparece en la ventana, por ejemplo `http://127.0.0.1:8765/`.
3. Carga el PDF escaneado.
4. Detecta los examenes.
5. Revisa la tabla.
6. Si quieres anonimizar, activa la opcion y ajusta la zona del nombre.
7. Genera el ZIP.

## Salidas

- Sin anonimizar: `Examenes_separados.zip`.
- Con anonimizar: `Examenes_anonimizados.zip`.

Dentro del ZIP:

- `Alumno01.pdf`, `Alumno02.pdf`, etc.
- `correspondencias.xlsx` si se activo anonimizar.
- Tambien se incluyen `correspondencias.csv` y `correspondencias.txt` como respaldo.

## Importante

La anonimimizacion cubre una zona visual de la primera pagina. Puedes mover el recuadro rojo arrastrandolo en la vista previa. Si arrastras desde el borde, puedes hacerlo mas grande o pequeno; los valores X, Y, ancho y alto se actualizan solos.

Si eliges cubrir todas las paginas, en las paginas posteriores el codigo se coloca arriba del todo, pegado al borde, para no tapar el examen. En esas paginas la aplicacion no busca nombres en mitad del contenido: compara el nombre detectado en la primera pagina con textos parecidos que aparezcan solo en la zona alta de la hoja, y si encuentra un duplicado aproximado lo cubre en blanco. Si la lectura normal de la pagina no lo encuentra, hace una segunda pasada OCR solo sobre la franja superior ampliada.

Todo el procesamiento se hace en este ordenador. La aplicacion no sube los PDFs a internet.

## Si el PDF no carga

No abras `index.html` directamente. Ejecuta siempre `Iniciar_App.bat`. El OCR y la lectura de PDFs necesitan el servidor local que abre ese archivo.

Si el PDF es muy grande, primero se cargara el documento y despues podras actualizar la vista previa. La deteccion OCR puede tardar varios minutos.
