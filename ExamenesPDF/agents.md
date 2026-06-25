# Agents

## Constructor de App

Responsable de implementar la aplicacion portable dentro de `App`.

Prioridades:

1. Mantener la app offline.
2. Evitar dependencias innecesarias.
3. Hacer el flujo usable para un docente sin conocimientos tecnicos.
4. Comprobar que `App/index.html` carga todos los recursos de forma local.

## Especialista PDF

Responsable de la manipulacion de PDFs.

Tareas:

- Copiar rangos de paginas a nuevos documentos.
- Dibujar rectangulos blancos de anonimizado.
- Escribir codigos anonimos sobre la zona cubierta.
- Conservar formato, orientacion y tamanos de pagina.

## Especialista OCR

Responsable de deteccion de portadas y nombres.

Tareas:

- Renderizar paginas con calidad suficiente para OCR.
- Detectar marcadores de portada.
- Extraer texto de la zona de nombre.
- Dar puntuaciones de confianza y no ocultar incertidumbres.

## Revisor de UX

Responsable de revisar que el flujo sea claro.

Checklist:

- El usuario entiende que los datos se procesan localmente.
- El usuario puede corregir detecciones antes de descargar.
- Los botones estan disponibles solo cuando procede.
- Los errores dan una accion concreta.

## Revisor de portabilidad

Responsable de comprobar que la carpeta `App` se puede copiar y ejecutar sola.

Checklist:

- No hay imports desde fuera de `App`.
- No hay CDN.
- No hay rutas absolutas.
- No hay archivos de desarrollo necesarios para el usuario final.
