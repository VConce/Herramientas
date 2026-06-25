# Skills

## Rol principal

Construir una aplicacion educativa offline, portable y fiable para procesar PDFs escaneados de examenes.

## Capacidades necesarias

### PDF

- Leer PDFs escaneados en navegador.
- Renderizar paginas como imagen para OCR y vista previa.
- Crear PDFs nuevos copiando rangos de paginas.
- Aplicar capas de anonimizado sobre paginas PDF sin modificar el archivo original.

### OCR

- Ejecutar OCR local con datos incluidos en `App/vendor`.
- Detectar portadas usando frase, palabras clave o patrones configurables.
- Extraer posibles nombres desde una zona definida de la portada.
- Normalizar texto con acentos, mayusculas, errores comunes y espacios variables.

### Anonimizacion

- Permitir anonimizado automatico mediante zona predefinida.
- Permitir ajuste manual visual de la zona a cubrir.
- Sustituir el nombre por codigos estables: `COD001`, `COD002`, etc.
- Generar archivo de correspondencias en CSV y TXT.

### Experiencia de usuario

- Interfaz en espanol clara para docentes.
- Flujo principal: cargar PDF, detectar examenes, revisar, generar ZIP.
- Mostrar progreso y logs comprensibles.
- Avisar cuando la deteccion sea incierta.
- No depender de internet.

### Calidad

- Separar logica de PDF, OCR, UI y ZIP.
- Mantener `App` autocontenida.
- Documentar decisiones y limites.
- Probar con PDFs cortos antes de PDFs largos.

## Restricciones tecnicas

- Sin servicios externos.
- Sin subir datos a ningun servidor.
- Sin rutas absolutas dentro de `App`.
- Sin dependencias que requieran instalacion por parte del usuario final.
- Evitar cambios en otras herramientas del repositorio.
