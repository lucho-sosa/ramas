package main

import "time"

type Chat struct {
	ID             int64     `json:"id"`
	ParentID       *int64    `json:"parent_id"`
	Title          string    `json:"title"`
	OriginFragment *string   `json:"origin_fragment,omitempty"`
	OriginSource   *string   `json:"origin_source,omitempty"`
	CLISessionID   *string   `json:"-"` // detalle de implementación, no se expone
	CreatedAt      time.Time `json:"created_at"`
}

type Message struct {
	ID        int64     `json:"id"`
	ChatID    int64     `json:"chat_id"`
	Role      string    `json:"role"` // "user" | "assistant"
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}
