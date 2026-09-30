package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS chats (
  id              INTEGER PRIMARY KEY,
  parent_id       INTEGER REFERENCES chats(id),
  title           TEXT NOT NULL,
  origin_fragment TEXT,
  origin_source   TEXT,
  cli_session_id  TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  chat_id    INTEGER NOT NULL REFERENCES chats(id),
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_parent  ON chats(parent_id);
`

type DB struct {
	sql *sql.DB
}

func openDB(path string) (*DB, error) {
	sqlDB, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// SQLite no tolera bien escrituras concurrentes desde varias conexiones.
	sqlDB.SetMaxOpenConns(1)
	if _, err := sqlDB.Exec(schema); err != nil {
		return nil, fmt.Errorf("aplicando schema: %w", err)
	}
	return &DB{sql: sqlDB}, nil
}

func scanChat(row interface{ Scan(...any) error }) (*Chat, error) {
	var c Chat
	if err := row.Scan(&c.ID, &c.ParentID, &c.Title, &c.OriginFragment, &c.OriginSource, &c.CLISessionID, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

const chatCols = "id, parent_id, title, origin_fragment, origin_source, cli_session_id, created_at"

func (d *DB) getChat(id int64) (*Chat, error) {
	row := d.sql.QueryRow("SELECT "+chatCols+" FROM chats WHERE id = ?", id)
	return scanChat(row)
}

func (d *DB) getRootChatBySession(cliSessionID string) (*Chat, error) {
	row := d.sql.QueryRow("SELECT "+chatCols+" FROM chats WHERE parent_id IS NULL AND cli_session_id = ?", cliSessionID)
	c, err := scanChat(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return c, err
}

func (d *DB) createRootChat(cliSessionID string) (*Chat, error) {
	res, err := d.sql.Exec(
		"INSERT INTO chats (parent_id, title, cli_session_id) VALUES (NULL, 'Raíz', ?)",
		cliSessionID,
	)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return d.getChat(id)
}

// createBranch numera la rama según su posición entre los hermanos del
// mismo padre, con el número del padre como prefijo: la primera rama desde
// el raíz es "Rama 1"; la primera rama desde "Rama 1" es "Rama 1.1"; una
// segunda rama desde "Rama 1" es "Rama 1.2"; una rama desde "Rama 1.2" es
// "Rama 1.2.1".
func (d *DB) createBranch(parentID int64, originFragment, originSource string) (*Chat, error) {
	parent, err := d.getChat(parentID)
	if err != nil {
		return nil, err
	}
	var siblingCount int
	if err := d.sql.QueryRow("SELECT COUNT(*) FROM chats WHERE parent_id = ?", parentID).Scan(&siblingCount); err != nil {
		return nil, err
	}
	idx := siblingCount + 1

	var title string
	if parent.ParentID == nil {
		title = fmt.Sprintf("Rama %d", idx)
	} else {
		title = fmt.Sprintf("%s.%d", parent.Title, idx)
	}

	res, err := d.sql.Exec(
		"INSERT INTO chats (parent_id, title, origin_fragment, origin_source) VALUES (?, ?, ?, ?)",
		parentID, title, originFragment, originSource,
	)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return d.getChat(id)
}

func (d *DB) setCLISessionID(chatID int64, cliSessionID string) error {
	_, err := d.sql.Exec("UPDATE chats SET cli_session_id = ? WHERE id = ?", cliSessionID, chatID)
	return err
}

func (d *DB) listChats() ([]Chat, error) {
	rows, err := d.sql.Query("SELECT " + chatCols + " FROM chats ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Chat{} // nunca nil: un slice nil serializa como JSON null, no []
	for rows.Next() {
		c, err := scanChat(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// listSubtree devuelve rootID y todos sus descendientes (recursivo), sin
// tocar chats de otras sesiones raíz que puedan compartir la misma tabla.
func (d *DB) listSubtree(rootID int64) ([]Chat, error) {
	all, err := d.listChats()
	if err != nil {
		return nil, err
	}
	byParent := map[int64][]Chat{}
	for _, c := range all {
		if c.ParentID != nil {
			byParent[*c.ParentID] = append(byParent[*c.ParentID], c)
		}
	}

	root, err := d.getChat(rootID)
	if err != nil {
		return nil, err
	}
	out := []Chat{*root}
	var walk func(id int64)
	walk = func(id int64) {
		for _, c := range byParent[id] {
			out = append(out, c)
			walk(c.ID)
		}
	}
	walk(rootID)
	return out, nil
}

func (d *DB) listMessages(chatID int64) ([]Message, error) {
	rows, err := d.sql.Query(
		"SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY id",
		chatID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{} // nunca nil: un slice nil serializa como JSON null, no []
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ChatID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (d *DB) appendMessage(chatID int64, role, content string) (*Message, error) {
	res, err := d.sql.Exec(
		"INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)",
		chatID, role, content,
	)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	row := d.sql.QueryRow("SELECT id, chat_id, role, content, created_at FROM messages WHERE id = ?", id)
	var m Message
	if err := row.Scan(&m.ID, &m.ChatID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

// replaceRootMessages sincroniza el historial del chat raíz contra el
// transcript de la terminal: la terminal es la fuente de verdad hasta que se
// abre una rama (a partir de ahí el raíz queda en solo lectura del lado UI).
func (d *DB) replaceRootMessages(chatID int64, msgs []Message) error {
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM messages WHERE chat_id = ?", chatID); err != nil {
		return err
	}
	for _, m := range msgs {
		if _, err := tx.Exec(
			"INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)",
			chatID, m.Role, m.Content,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
