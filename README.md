# Fichaje Residencia

Aplicación de control horario para una residencia, pensada para usarse en un **iPad** a la entrada.

- Cada trabajador ficha **Entrada** o **Salida** con su usuario y contraseña.
- Los fichajes se guardan en la **memoria del iPad** (funciona sin internet).
- Se cuentan las horas automáticamente (hoy, semana, mes…).
- **Panel de administración** con usuario y contraseña propios: horas de todos los trabajadores,
  detalle por día, fichajes manuales/correcciones, altas y bajas de trabajadores.
- Los datos se pasan al **ordenador por wifi** (AirDrop, o Archivos/iCloud/OneDrive) y se pueden
  abrir en Excel.

No necesita servidor ni base de datos: son archivos HTML/JS estáticos.

---

## 1. Publicar la app (una sola vez)

1. En GitHub, entra en el repositorio → **Settings** → **Pages**.
2. En *Build and deployment* → *Source* elige **Deploy from a branch**.
3. Branch: **main**, carpeta **/ (root)** → **Save**.
4. En un par de minutos la app estará en
   `https://novumnegotium23-lab.github.io/app-h-bitos/`

> La dirección es HTTPS, que es lo que necesita el iPad para guardar la app y que funcione sin conexión.

## 2. Instalar en el iPad

1. Abre la dirección anterior en **Safari**.
2. Pulsa el botón **Compartir** → **Añadir a pantalla de inicio**.
3. Abre la app desde el icono **Fichaje** de la pantalla de inicio (siempre desde ahí).

**Importante:** usa siempre el icono de la pantalla de inicio. Safari puede borrar los datos de las
webs que no se usan durante días, pero no los de las apps añadidas a la pantalla de inicio.
Aun así, envía una copia al ordenador con frecuencia (por ejemplo, cada semana).

Recomendado para uso tipo "quiosco": *Ajustes → Accesibilidad → Acceso guiado*, para que el iPad
se quede siempre en la app.

## 3. Primer uso

1. La primera vez la app pide crear el **administrador** (usuario y contraseña) y el nombre del centro.
2. En **Trabajadores** → **+ Nuevo trabajador**: nombre, usuario y contraseña de cada empleado.
3. Pulsa **Salir**: el iPad queda en la pantalla de fichaje.

## 4. Fichar

El trabajador escribe su usuario y contraseña y pulsa **Entrada** o **Salida**. La pantalla confirma
la hora y le muestra sus horas de hoy, de la semana y del mes. A los pocos segundos vuelve sola a la
pantalla de fichaje.

- Si ficha dos veces lo mismo seguido, la app lo avisa.
- Si confirma una entrada/salida "rara" (por ejemplo, salida sin entrada), la app pregunta antes.
- Tras 5 contraseñas erróneas, **ese usuario** queda bloqueado 30 segundos (los demás pueden seguir fichando).
- Si alguien deja su usuario o contraseña escritos, se borran solos a los 30 segundos.
- Si por cualquier motivo el fichaje no se puede guardar, la pantalla lo dice claramente
  ("NO SE HA GUARDADO EL FICHAJE") en vez de dar un falso OK.

## 5. Panel de administración

Botón **Administración** (abajo) → usuario y contraseña de administrador.

| Pestaña | Qué hace |
|---|---|
| **Horas** | Horas de cada trabajador en el periodo elegido, quién está dentro ahora, avisos de fichajes incompletos y detalle por días. Exportar a Excel. |
| **Fichajes** | Todos los fichajes; añadir uno manual (p. ej. si alguien olvidó fichar), editar o borrar. Las correcciones quedan marcadas como "Manual" con su motivo y **se conserva el valor original** (también en el Excel). Para borrar hay que indicar el motivo, y el fichaje borrado se conserva en el historial. |
| **Trabajadores** | Altas, cambios de contraseña y bajas. |
| **Datos y ordenador** | Enviar copia al ordenador, importar copias, ajustes (nombre del centro, contraseña del administrador, duración máxima de un turno). |

**Turnos y salidas olvidadas:** un turno de noche (p. ej. 22:00–08:00) cuenta como un solo día, el día
en que empieza. Si una entrada queda abierta más de la duración máxima de turno (16 h por defecto,
configurable), se considera una salida olvidada: no suma horas y aparece como "fichaje incompleto"
para que la administración lo corrija.

La sesión de administración se cierra sola tras 5 minutos sin tocar la pantalla.

## 6. Pasar los datos al ordenador por wifi

En el iPad: **Administración → Datos y ordenador**.

- **Enviar copia (JSON)**: copia completa. Se abre el menú de compartir del iPad:
  - Mac: elige **AirDrop** y tu Mac.
  - PC con Windows: **Guardar en Archivos** → iCloud Drive / OneDrive / Google Drive, o envíalo por correo.
- **Enviar Excel (CSV)**: lista de todos los fichajes, lista para abrir en Excel.

En el ordenador, para ver todo en el panel:

1. Abre `https://novumnegotium23-lab.github.io/app-h-bitos/` en el navegador.
2. La primera vez pulsa **Importar copia de seguridad** y elige el archivo `.json` recibido.
3. Entra con el mismo usuario/contraseña de administrador del iPad.
4. Las siguientes veces: **Datos y ordenador → Importar copia**. Los datos se **combinan**, no se
   duplican, así que puedes importar copias nuevas siempre que quieras (o de varios iPads).

## Archivos

```
index.html            pantallas de la app
styles.css            estilos
js/store.js           guardado en el dispositivo, contraseñas, copias e importación
js/hours.js           cálculo de horas
js/app.js             lógica de pantallas y panel
js/sha256.js          cifrado de contraseñas (hash)
sw.js                 funcionamiento sin conexión
manifest.webmanifest  instalación en pantalla de inicio
```

Para probarla en local: `python3 -m http.server 8000` y abrir `http://localhost:8000`.

## Seguridad y notas

- Las contraseñas no se guardan en claro: se guarda un hash con sal.
- Los datos se guardan en la base de datos interna del navegador (IndexedDB), con capacidad para años
  de fichajes. Los datos de versiones anteriores se trasladan solos la primera vez.
- Los datos solo están en el dispositivo y en las copias que envíes. Guarda las copias en un lugar
  seguro: contienen datos personales de los trabajadores (RGPD).
- Si cambias archivos de la app, sube la versión de `CACHE` en `sw.js` para que el iPad la actualice.
