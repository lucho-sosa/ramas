package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

type server struct {
	db        *DB
	claudeBin string
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	log.Println("error:", err)
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

// GET /api/session?session=<cli-session-id>
// Da de alta (si hace falta) el chat raíz atado a esa sesión de terminal y
// resincroniza sus mensajes contra el transcript, que es la fuente de
// verdad mientras el raíz no tenga una rama abierta.
func (s *server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("falta el query param session"))
		return
	}

	chat, err := s.db.getRootChatBySession(sessionID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if chat == nil {
		chat, err = s.db.createRootChat(sessionID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
	}

	if msgs, err := loadRootMessages(sessionID); err != nil {
		log.Printf("no se pudo leer el transcript de %s: %v", sessionID, err)
	} else if err := s.db.replaceRootMessages(chat.ID, msgs); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	messages, err := s.db.listMessages(chat.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat": chat, "messages": messages})
}

// GET /api/tree
func (s *server) handleListTree(w http.ResponseWriter, r *http.Request) {
	chats, err := s.db.listChats()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, chats)
}

// POST /api/chats  {parent_id, origin_fragment, origin_source}
func (s *server) handleCreateBranch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParentID       int64  `json:"parent_id"`
		OriginFragment string `json:"origin_fragment"`
		OriginSource   string `json:"origin_source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if body.OriginFragment == "" || body.OriginSource == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("origin_fragment y origin_source son obligatorios"))
		return
	}
	if _, err := s.db.getChat(body.ParentID); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("parent_id inválido: %w", err))
		return
	}

	chat, err := s.db.createBranch(body.ParentID, body.OriginFragment, body.OriginSource)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, chat)
}

// GET /api/chats/{id}/messages
func (s *server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	msgs, err := s.db.listMessages(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, msgs)
}

// POST /api/chats/{id}/messages  {content}
// Streamea la respuesta de Claude Code por SSE y al terminar persiste el
// turno completo (user + assistant) en SQLite.
//
// TODO (pendiente, ver PROYECTO-ramas.md sec. 3): en el primer mensaje de
// una rama, lo que se le manda al CLI es fragmento+origen+pregunta
// concatenados, pero acá solo persistimos el "content" tal como lo escribió
// el usuario. Falta definir cómo se refleja/limpia eso en la UI.
func (s *server) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("falta \"content\" en el body"))
		return
	}

	chat, err := s.db.getChat(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}

	var (
		args           []string
		newBranchToken string // UUID pre-asignado si esta es la primera vez que la rama le habla al CLI
	)
	switch {
	case chat.ParentID == nil:
		// Chat raíz: siempre tiene cli_session_id (la sesión de la terminal).
		args = claudeArgs(body.Content, *chat.CLISessionID, "", true)

	case chat.CLISessionID == nil:
		// Primer mensaje de la rama: se siembra con fragmento + respuesta de
		// origen antes de la pregunta real, como un único mensaje.
		prompt := fmt.Sprintf(
			"Contexto de la conversación de origen.\n\nFragmento seleccionado:\n%s\n\nRespuesta completa de la que salió ese fragmento:\n%s\n\nPregunta:\n%s",
			derefStr(chat.OriginFragment), derefStr(chat.OriginSource), body.Content,
		)
		newBranchToken = uuid.NewString()
		args = claudeArgs(prompt, "", newBranchToken, true)

	default:
		args = claudeArgs(body.Content, *chat.CLISessionID, "", true)
	}

	if _, err := s.db.appendMessage(chat.ID, "user", body.Content); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	result, err := runClaudeStream(r.Context(), s.claudeBin, args, w)
	if err != nil {
		log.Println("error ejecutando claude:", err)
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", jsonString(err.Error()))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		return
	}

	if newBranchToken != "" {
		if err := s.db.setCLISessionID(chat.ID, result.SessionID); err != nil {
			log.Println("no se pudo guardar cli_session_id:", err)
		}
	}
	if _, err := s.db.appendMessage(chat.ID, "assistant", result.Result); err != nil {
		log.Println("no se pudo persistir la respuesta:", err)
	}
}

// POST /api/chats/{id}/summarize-session
// Botón único de "resumen de sesión": junta el chat raíz y todas sus ramas
// (persistidas, se hayan cerrado o no) y pide un solo resumen consolidado.
// No se persiste como mensaje (el raíz se resincroniza 1:1 contra el
// transcript de la terminal y lo pisaría); se devuelve para mostrar aparte.
func (s *server) handleSummarizeSession(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	root, err := s.db.getChat(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	if root.ParentID != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("el resumen de sesión se pide desde el chat raíz"))
		return
	}

	subtree, err := s.db.listSubtree(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	var sb strings.Builder
	for _, c := range subtree {
		fmt.Fprintf(&sb, "## %s\n", c.Title)
		if c.OriginFragment != nil {
			fmt.Fprintf(&sb, "(rama abierta desde: %q)\n\n", *c.OriginFragment)
		}
		msgs, err := s.db.listMessages(c.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		for _, m := range msgs {
			fmt.Fprintf(&sb, "%s: %s\n\n", m.Role, m.Content)
		}
	}

	prompt := "Resumí el conocimiento clave de esta sesión de trabajo. Incluye el " +
		"hilo principal y las ramas que se abrieron para profundizar puntos " +
		"puntuales en paralelo:\n\n" + sb.String()
	summary, err := runClaudeOnce(r.Context(), s.claudeBin, prompt)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("generando resumen: %w", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"summary": summary.Result})
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
