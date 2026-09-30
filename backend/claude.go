package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
)

// claudeResult es el objeto final que imprime `claude -p --output-format
// json` (o la última línea de --output-format stream-json): trae el texto
// de la respuesta y el session_id real que quedó grabado en el CLI.
type claudeResult struct {
	Type      string `json:"type"`
	IsError   bool   `json:"is_error"`
	Result    string `json:"result"`
	SessionID string `json:"session_id"`
}

// claudeArgs arma la porción de argumentos común a toda invocación de
// `claude -p`. resumeSessionID y newSessionID son mutuamente excluyentes:
// una rama/raíz que ya tiene sesión usa --resume; una rama en su primer
// mensaje se preasigna un UUID propio con --session-id.
func claudeArgs(prompt string, resumeSessionID, newSessionID string, streaming bool) []string {
	// "ramas" es un chat de discusión, no un agente de tareas: sin tools el
	// modelo nunca puede quedar trabado esperando una aprobación de permiso
	// que el modo no interactivo (-p) no tiene forma de recibir.
	args := []string{"-p", prompt, "--tools", ""}
	if streaming {
		args = append(args, "--output-format", "stream-json", "--verbose", "--include-partial-messages")
	} else {
		args = append(args, "--output-format", "json")
	}
	switch {
	case resumeSessionID != "":
		args = append(args, "--resume", resumeSessionID)
	case newSessionID != "":
		args = append(args, "--session-id", newSessionID)
	}
	return args
}

// runClaudeStream ejecuta `claude -p ... --output-format stream-json` y va
// reenviando cada línea NDJSON como un evento SSE tal cual la emite el CLI
// (el frontend decide qué le interesa de cada tipo de evento). Devuelve el
// objeto "result" final, que es lo que se persiste en SQLite.
func runClaudeStream(ctx context.Context, bin string, args []string, w http.ResponseWriter) (*claudeResult, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("el ResponseWriter no soporta streaming")
	}

	cmd := exec.CommandContext(ctx, bin, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("arrancando %s: %w", bin, err)
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)

	var final *claudeResult
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		fmt.Fprintf(w, "data: %s\n\n", line)
		flusher.Flush()

		var probe claudeResult
		if err := json.Unmarshal(line, &probe); err == nil && probe.Type == "result" {
			r := probe
			final = &r
		}
	}
	scanErr := scanner.Err()
	waitErr := cmd.Wait()

	if scanErr != nil {
		return nil, scanErr
	}
	if waitErr != nil {
		return nil, fmt.Errorf("%s: %w (stderr: %s)", bin, waitErr, stderr.String())
	}
	if final == nil {
		return nil, fmt.Errorf("el CLI no devolvió un evento \"result\"")
	}
	if final.IsError {
		return nil, fmt.Errorf("claude devolvió error: %s", final.Result)
	}
	return final, nil
}

// runClaudeOnce ejecuta una llamada de un solo turno, sin sesión (ni
// --resume ni --session-id): la usa el flujo de "resumir y mejorar", que
// explícitamente no debe tocar la sesión CLI real del chat padre.
func runClaudeOnce(ctx context.Context, bin, prompt string) (*claudeResult, error) {
	args := claudeArgs(prompt, "", "", false)
	cmd := exec.CommandContext(ctx, bin, args...)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("%s: %w (stderr: %s)", bin, err, ee.Stderr)
		}
		return nil, fmt.Errorf("%s: %w", bin, err)
	}
	var res claudeResult
	if err := json.Unmarshal(out, &res); err != nil {
		return nil, fmt.Errorf("parseando salida de %s: %w", bin, err)
	}
	if res.IsError {
		return nil, fmt.Errorf("claude devolvió error: %s", res.Result)
	}
	return &res, nil
}
