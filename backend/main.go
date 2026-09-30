package main

import (
	"flag"
	"log"
	"net/http"
	"os"
)

func main() {
	port := flag.String("port", envOr("RAMAS_PORT", "5173"), "puerto HTTP")
	dbPath := flag.String("db", envOr("RAMAS_DB", "ramas.db"), "ruta al archivo SQLite")
	claudeBin := flag.String("claude-bin", envOr("RAMAS_CLAUDE_BIN", "claude"), "binario del CLI de Claude Code")
	webDir := flag.String("web", envOr("RAMAS_WEB_DIR", "./web"), "carpeta con el frontend ya buildeado (opcional)")
	flag.Parse()

	db, err := openDB(*dbPath)
	if err != nil {
		log.Fatalf("no se pudo abrir la base %s: %v", *dbPath, err)
	}

	s := &server{db: db, claudeBin: *claudeBin}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /api/session", s.handleGetSession)
	mux.HandleFunc("GET /api/tree", s.handleListTree)
	mux.HandleFunc("POST /api/chats", s.handleCreateBranch)
	mux.HandleFunc("GET /api/chats/{id}/messages", s.handleListMessages)
	mux.HandleFunc("POST /api/chats/{id}/messages", s.handleSendMessage)
	mux.HandleFunc("POST /api/chats/{id}/summarize-session", s.handleSummarizeSession)

	// El frontend (chatbot-ramas-prototipo.jsx) todavía no está cableado
	// contra este backend (ver PROYECTO-ramas.md, próximos pasos). Si existe
	// una carpeta con un build ya generado se sirve como estáticos; si no,
	// dejamos un placeholder para no romper "/".
	if info, statErr := os.Stat(*webDir); statErr == nil && info.IsDir() {
		mux.Handle("/", http.FileServer(http.Dir(*webDir)))
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte("ramas-server activo. Todavía no hay frontend buildeado en " + *webDir + "\n"))
		})
	}

	addr := ":" + *port
	log.Printf("ramas-server escuchando en http://localhost%s (db=%s, claude=%s)", addr, *dbPath, *claudeBin)
	log.Fatal(http.ListenAndServe(addr, withCORS(mux)))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// withCORS es permisivo a propósito: todo esto corre en local y el próximo
// paso es cablear el frontend, probablemente primero contra un dev server
// en otro puerto (Vite).
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
