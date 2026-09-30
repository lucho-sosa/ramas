#!/usr/bin/env bash
# Uso: launch.sh <session-id>
# Arranca el backend de "ramas" si no está corriendo y abre el navegador
# apuntando a la sesión de Claude Code recibida como argumento.
set -euo pipefail

SESSION_ID="${1:-}"
PORT="${RAMAS_PORT:-5173}"
BIN="$HOME/ramas/ramas-server"        # tu binario Go compilado
PIDFILE="$HOME/ramas/.server.pid"
LOG="$HOME/ramas/server.log"

# Fallback: si no llegó el session id, usar el transcript más reciente del proyecto.
if [ -z "$SESSION_ID" ]; then
  PROJDIR="$HOME/.claude/projects"
  LATEST="$(ls -t "$PROJDIR"/*/*.jsonl 2>/dev/null | head -n1 || true)"
  [ -n "$LATEST" ] && SESSION_ID="$(basename "$LATEST" .jsonl)"
fi

# ¿Ya está levantado el server en el puerto?
if ! curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "Arrancando backend en el puerto $PORT..."
  # cd a ~/ramas para que la db y el frontend buildeado (rutas relativas por
  # default) se busquen siempre ahí, sin importar desde dónde se invoque este
  # script. El "exec" adentro del subshell preserva el PID para el PIDFILE.
  (cd "$HOME/ramas" && exec nohup "$BIN" --port "$PORT" >"$LOG" 2>&1) &
  echo $! > "$PIDFILE"
  # Esperar a que responda (máx ~5s)
  for _ in $(seq 1 25); do
    curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break
    sleep 0.2
  done
fi

URL="http://localhost:$PORT/?session=$SESSION_ID"
echo "Abriendo $URL"

# Abrir el navegador según el SO
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"        # Linux
elif command -v open      >/dev/null 2>&1; then open "$URL"        # macOS
elif command -v wslview   >/dev/null 2>&1; then wslview "$URL"     # WSL
else echo "Abrí manualmente: $URL"
fi
