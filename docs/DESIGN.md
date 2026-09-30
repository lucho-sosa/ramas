# Proyecto "ramas" — chatbot con conversaciones ramificadas

Documento de handoff. Contiene todo lo definido hasta ahora para retomar el
proyecto desde Claude Code.

---

## 1. Qué es

Una web de chat con IA donde podés **seleccionar un fragmento de una respuesta**
y, con un botón que aparece sobre la selección, **abrir una rama**: un chat nuevo
que profundiza ese punto sin ensuciar el hilo principal. Las ramas se muestran en
**pantalla dividida** y se organizan en un **árbol de conversaciones**.

El motor es **Claude Code corriendo en local**. La web se levanta desde la
terminal con un slash command (`/estudiar`) que le pasa la sesión actual como
chat raíz.

---

## 2. Arquitectura

Tres piezas, todo local (puede vivir en el notebook-servidor):

- **Frontend (React)** — UI de chats, selección de texto, split screen, rails
  encadenados con flechas, modal de árbol. Ya existe un prototipo funcional con
  respuestas simuladas: `chatbot-ramas-prototipo.jsx`.
- **Backend (Go)** — recibe los mensajes del frontend, ejecuta Claude Code en
  local por cada chat, y devuelve las respuestas (idealmente por streaming vía
  Server-Sent Events). Es el dueño de todo el estado.
- **Persistencia (SQLite)** — fuente de verdad del árbol, los mensajes y el
  origen de cada rama.

---

## 3. Comportamiento de la UI (definido)

- **Máximo 2 chats visibles** lado a lado.
- **Selección → botón → rama**: seleccionás texto de una respuesta de la IA,
  aparece el botón "Abrir rama", y la rama nueva se abre a la derecha. El chat
  que estaba a la derecha pasa a ser el de la izquierda.
- **Solo lectura del chat padre**: al abrirse una rama, el chat que queda a la
  izquierda (su origen) pasa a modo solo lectura hasta que esa rama se cierra.
  Vale para cualquier chat, incluido el raíz — evita el conflicto de escritura
  simultánea entre la terminal (dueña de la sesión `--resume`) y la web.
- **Una sola rama abierta por chat a la vez**: no puede haber dos ramas hijas
  abiertas simultáneamente desde el mismo chat. Cerrar una rama la colapsa (no
  la borra) y devuelve el modo escritura al padre; se puede volver a expandir
  la misma rama más tarde desde el rail o el modal de árbol.
- **Rail izquierdo ("anteriores")**: los chats ancestros (padres) colapsados,
  encadenados con flechas que apuntan hacia abajo (al siguiente).
- **Rail derecho ("siguientes")**: si navegás a un chat anterior, los chats que
  quedan "adelante" se van a este rail, también encadenados con flechas.
- **Navegación**: al hacer clic en un chat de cualquier rail, ese chat se
  expande y los rails se recalculan alrededor de la nueva posición.
- **Modal de árbol**: vista completa de la estructura de conversaciones, con el
  camino actual resaltado.
- **Sin comportamiento responsive**: la web es de uso exclusivo en monitor
  grande, no se contempla pantalla angosta.

### Contexto que hereda una rama

El fragmento seleccionado **+ la respuesta completa** de donde salió ese
fragmento, concatenados junto con la primera pregunta real del usuario en un
solo mensaje: es el primer turno que recibe la sesión nueva del CLI.

> Pendiente: cómo se "limpia" ese primer mensaje en la UI para no mostrarle al
> usuario el contexto crudo pegado a su pregunta.

### Cerrar una rama

Cerrar es opcional respecto de resumir: se puede cerrar (colapsar al rail) sin
más trámite. Además, al terminar una rama hay un botón "Resumir y mejorar"
opcional:

1. Llamada dedicada a la IA que resume la conversación de la rama.
2. Llamada aparte —no toca la sesión CLI real del padre— que con ese resumen
   más el mensaje original del padre genera una respuesta mejorada.
3. Esa respuesta mejorada se agrega como mensaje nuevo del asistente al final
   del chat padre (no reemplaza el mensaje original).

No hace falta marcar visualmente en el árbol que una rama fue "aplicada".

---

## 4. Decisiones tomadas

- **Plataforma**: web (no mobile).
- **Motor**: Claude Code local (versión 2.1.224).
- **Ramas solo en SQLite**: las ramas **no** son sesiones reales de Claude Code
  y la terminal **no** se entera de ellas. El backend es el dueño del estado.
- **Título de rama**: numérico jerárquico, sin truncar el fragmento ni
  generarlo con el modelo. La posición del chat en el árbol define el
  número: cada rama es "Rama `<número del padre>.<posición entre sus
  hermanos>`", y si el padre es el raíz no lleva prefijo. Ejemplo: primera
  rama desde el raíz → "Rama 1"; primera rama desde "Rama 1" → "Rama 1.1";
  segunda rama desde "Rama 1" → "Rama 1.2"; rama desde "Rama 1.2" → "Rama
  1.2.1".

### Cómo cada chat le habla al modelo

- **Chat raíz** → `claude --resume <session-id-de-la-terminal>` para heredar el
  hilo que venía en la terminal.
- **Cada rama** → una sesión **nueva y aparte** del CLI, creada en su primer
  mensaje y sembrada con el contexto heredado (fragmento + respuesta de origen)
  como apertura. **No** se usa `--fork-session`.
- El `cli_session_id` interno de cada rama se guarda en SQLite como detalle de
  implementación (para no reenviar todo el historial en cada turno), pero nunca
  se expone a la terminal.

---

## 5. El slash command `/estudiar`

Levanta la web con la sesión actual de la terminal como chat raíz. Se apoya en
la sustitución de `${CLAUDE_SESSION_ID}` en el texto del comando (disponible
desde Claude Code v2.1.9; la versión actual 2.1.224 la soporta).

**`~/.claude/commands/estudiar.md`**

```markdown
---
description: Levanta la web de chats ramificados con la sesión actual como raíz
allowed-tools: Bash(bash ~/ramas/launch.sh:*)
---

Ejecutá el lanzador de la web de ramas pasándole el ID de esta sesión:

!`bash ~/ramas/launch.sh ${CLAUDE_SESSION_ID}`

No hace falta nada más: el script arranca el backend si no está corriendo
y abre el navegador apuntando a esta sesión. Solo confirmá que se abrió bien.
```

**`~/ramas/launch.sh`** (dar permiso con `chmod +x`)

```bash
#!/usr/bin/env bash
# Uso: launch.sh <session-id>
set -euo pipefail

SESSION_ID="${1:-}"
PORT="${RAMAS_PORT:-5173}"
BIN="$HOME/ramas/ramas-server"        # binario Go compilado
PIDFILE="$HOME/ramas/.server.pid"
LOG="$HOME/ramas/server.log"

# Fallback: si no llegó el session id, usar el transcript más reciente.
if [ -z "$SESSION_ID" ]; then
  PROJDIR="$HOME/.claude/projects"
  LATEST="$(ls -t "$PROJDIR"/*/*.jsonl 2>/dev/null | head -n1 || true)"
  [ -n "$LATEST" ] && SESSION_ID="$(basename "$LATEST" .jsonl)"
fi

if ! curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "Arrancando backend en el puerto $PORT..."
  # cd a ~/ramas para que la db y el frontend buildeado (rutas relativas por
  # default) se busquen siempre ahí, sin importar desde dónde se invoque este
  # script. El "exec" adentro del subshell preserva el PID para el PIDFILE.
  (cd "$HOME/ramas" && exec nohup "$BIN" --port "$PORT" >"$LOG" 2>&1) &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 25); do
    curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break
    sleep 0.2
  done
fi

URL="http://localhost:$PORT/?session=$SESSION_ID"
echo "Abriendo $URL"

if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
elif command -v open      >/dev/null 2>&1; then open "$URL"
elif command -v wslview   >/dev/null 2>&1; then wslview "$URL"
else echo "Abrí manualmente: $URL"
fi
```

### Handoff de la sesión

Los transcripts viven en `~/.claude/projects/<hash-del-proyecto>/<session-id>.jsonl`.
Cada línea es un JSON con rol y contenido. El backend, al servir `?session=<id>`,
lee ese JSONL, filtra los mensajes `user` / `assistant`, y los carga como el chat
raíz.

> Nota: el `session_id` **no** está expuesto como variable de entorno en el tool
> Bash ni en los hooks, por eso hay que pasarlo como argumento vía la sustitución
> del comando (o usar el fallback del transcript más reciente).

---

## 6. Esquema SQLite

```sql
CREATE TABLE chats (
  id              INTEGER PRIMARY KEY,
  parent_id       INTEGER REFERENCES chats(id),  -- NULL = chat raíz
  title           TEXT NOT NULL,
  origin_fragment TEXT,                           -- el texto seleccionado
  origin_source   TEXT,                           -- la respuesta completa de origen
  cli_session_id  TEXT,                           -- sesión interna del CLI (oculta)
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY,
  chat_id    INTEGER NOT NULL REFERENCES chats(id),
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_chat ON messages(chat_id);
CREATE INDEX idx_chats_parent  ON chats(parent_id);
```

El árbol se reconstruye con `parent_id`: el raíz es el único con `parent_id`
NULL, y los hijos de un chat salen de consultar por `parent_id`.

---

## 7. Próximos pasos sugeridos

1. ~~Esqueleto del backend en Go~~ — **hecho**, ver sección 9.
2. ~~Cablear el prototipo React contra el backend real~~ — **hecho**, ver
   sección 9. `chatbot-ramas-prototipo.jsx` queda como snapshot histórico del
   prototipo con datos simulados; la app real vive en `frontend/`.
3. Definir cómo se limpia visualmente, en la UI, el primer mensaje de una rama
   (contexto heredado + pregunta van juntos al CLI, pero no deberían mostrarse
   crudos). Sigue pendiente.
4. El placeholder que se muestra al abrir una rama ("Abrimos esta rama
   para...") es puramente local, no se persiste — si recargás la página antes
   de mandar el primer mensaje real, desaparece. No es un bug: recién se crea
   contenido real en SQLite cuando el usuario manda su primera pregunta.
5. ~~Actualizar `launch.sh`~~ — **hecho**: `/estudiar` ya está instalado en
   `~/.claude/commands/estudiar.md`, y `~/ramas/` tiene `launch.sh`,
   `ramas-server` y `web/` (copia del build). `launch.sh` ahora hace `cd
   ~/ramas` antes de arrancar el binario, así la db y el frontend se
   encuentran siempre ahí sin importar desde qué directorio se invoque
   `/estudiar`. Falta automatizar el redeploy: por ahora, después de tocar
   `backend/` o `frontend/` hay que volver a copiar el binario/`web/` a mano.
6. ~~Probar el flujo completo en un navegador real~~ — probado. Confirmó en
   la práctica el riesgo de la sección 3: mandar un mensaje al chat raíz
   *antes* de abrir cualquier rama resume la sesión de terminal en vivo desde
   un segundo proceso del CLI, que puede intentar usar tools y chocar con los
   permisos (no se perdió nada, pero quedaron turnos extra en el transcript
   que la terminal no vio). Las ramas en sí probaron ser seguras — corren en
   sesión aislada.
7. Reusar rama existente en selección solapada: si el fragmento
   seleccionado se superpone con (o está incluido en) el `origin_fragment` de
   una rama ya creada desde el mismo chat, "Abrir rama" debería llevar a esa
   rama existente en lugar de crear una nueva. Pendiente de implementar.
8. ~~Bug: los mensajes no respondían / tardaban mucho~~ — **arreglado**. Causa
   real: el CLI se invocaba con acceso a tools (Read, WebFetch, etc.), y en
   modo no interactivo (`-p`) no hay forma de aprobar un permiso en vivo — el
   modelo quedaba pidiendo confirmación y el proceso terminaba colgado o
   muerto (`signal: killed`). Fix: todas las llamadas del chat van con
   `--tools ""` (sin herramientas). Tiene sentido además conceptualmente:
   "ramas" es un chat de discusión, no un agente de tareas.
9. Riesgo que sigue latente: mandar un mensaje al chat raíz mientras la
   terminal de esa sesión está *activa al mismo tiempo* puede seguir dando
   respuestas incoherentes (dos conversaciones distintas escribiendo al mismo
   historial). El fix del punto 8 evita que se cuelgue, pero no evita la
   mezcla de contexto. Ver sección 3, "Solo lectura del chat padre".

---

## 8. Archivos del proyecto

- `chatbot-ramas-prototipo.jsx` — snapshot histórico del prototipo original
  (React, respuestas simuladas). Ya no se usa en runtime, ver sección 9.
- `estudiar.md` — el slash command.
- `launch.sh` — el lanzador.
- `PROYECTO-ramas.md` — este documento.
- `backend/` — servidor Go (fuente de verdad del estado).
- `frontend/` — proyecto Vite/React cableado contra el backend real.

---

## 9. Estado actual del código

### Backend (`backend/`)

Go + `modernc.org/sqlite` (sin CGO). Implementado y probado en vivo contra el
CLI de Claude Code real (no son stubs):

- `GET /health`
- `GET /api/session?session=<id>` — da de alta/sincroniza el chat raíz contra
  el transcript de la terminal.
- `GET /api/tree` — todos los chats (flat, con `parent_id`).
- `POST /api/chats` — crea una rama (`parent_id`, `origin_fragment`,
  `origin_source`); el título lo asigna el backend (`Rama N`).
- `GET /api/chats/{id}/messages`
- `POST /api/chats/{id}/messages` — le habla al CLI real (`--resume` o
  `--session-id` preasignado para el primer mensaje de una rama) y
  streamea la respuesta por SSE token a token (`--include-partial-messages`).
- `POST /api/chats/{id}/close-summarize` — el botón "Resumir y mejorar":
  dos llamadas aparte al CLI, sin tocar la sesión real del padre.

Sirve el frontend buildeado desde `./web` (configurable con `--web`).
Flags: `--port` / `RAMAS_PORT` (default 5173), `--db` / `RAMAS_DB`,
`--claude-bin` / `RAMAS_CLAUDE_BIN`.

### Frontend (`frontend/`)

Vite + React, adaptado del prototipo original. `src/App.jsx` reemplaza los
datos simulados por llamadas reales a la API: hidrata el árbol completo al
cargar, crea ramas contra `POST /api/chats`, y muestra las respuestas
escribiéndose en tiempo real leyendo el SSE a mano (`fetch` +
`ReadableStream`, no `EventSource`, porque el pedido es `POST`).

- `npm run dev` — levanta Vite en `:5174` con proxy de `/api` y `/health`
  hacia el backend en `:5173` (tienen que correr los dos a la vez).
- `npm run build` — genera `../backend/web`, que el binario Go sirve solo con
  levantarlo (sin flags).

Implementado en el frontend, más allá de lo ya descrito en la sección 3:
- Modo solo lectura del chat padre mientras la rama está abierta.
- Botones "cerrar" y "resumir y mejorar" en la rama activa (el extremo del
  camino actual); cerrar la saca del camino visible pero no la borra —
  se puede reabrir desde el modal de árbol.
