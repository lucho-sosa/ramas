package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type transcriptEntry struct {
	Type    string `json:"type"`
	Message struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// findTranscriptPath busca <session-id>.jsonl bajo ~/.claude/projects/*/,
// sin asumir en qué proyecto quedó grabada la sesión.
func findTranscriptPath(sessionID string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	matches, err := filepath.Glob(filepath.Join(home, ".claude", "projects", "*", sessionID+".jsonl"))
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("no se encontró transcript para la sesión %s", sessionID)
	}
	return matches[0], nil
}

// extractText intenta interpretar el campo "content" de un mensaje del
// transcript, que puede venir como string plano (mensajes de usuario
// simples) o como lista de bloques (respuestas del asistente, o mensajes de
// usuario que en realidad son resultados de herramientas). Solo nos interesa
// el texto legible: bloques "text"; se descartan "thinking", "tool_use" y
// "tool_result".
func extractText(raw json.RawMessage) (string, bool) {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if s == "" {
			return "", false
		}
		return s, true
	}

	var blocks []contentBlock
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return "", false
	}
	var sb strings.Builder
	for _, b := range blocks {
		if b.Type == "text" {
			sb.WriteString(b.Text)
		}
	}
	if sb.Len() == 0 {
		return "", false
	}
	return sb.String(), true
}

// loadRootMessages parsea el transcript de la sesión de terminal y devuelve
// los turnos user/assistant legibles, en orden, para hidratar el chat raíz.
func loadRootMessages(sessionID string) ([]Message, error) {
	path, err := findTranscriptPath(sessionID)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var out []Message
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry transcriptEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		if entry.Type != "user" && entry.Type != "assistant" {
			continue
		}
		text, ok := extractText(entry.Message.Content)
		if !ok {
			continue
		}
		out = append(out, Message{Role: entry.Type, Content: text})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
