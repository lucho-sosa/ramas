import { useState, useRef, useEffect, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* ------------------------------------------------------------------ */
/*  Tokens de diseño                                                   */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#101216",
  rail: "#0b0d10",
  panel: "#171a20",
  panelAlt: "#14161c",
  border: "#262b34",
  borderSoft: "#1e232b",
  text: "#e7e9ee",
  muted: "#8a92a6",
  faint: "#5b6273",
  accent: "#e5a83b",
  accentDim: "rgba(229,168,59,0.14)",
  userBubble: "#232a36",
  danger: "#e06c75",
};
const MONO = "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/* ------------------------------------------------------------------ */
/*  API                                                                */
/* ------------------------------------------------------------------ */
async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

function getSessionId() {
  return new URLSearchParams(window.location.search).get("session");
}

// Manda el mensaje al backend y va leyendo la respuesta SSE. Cada línea es
// un evento crudo del CLI de Claude Code (--output-format stream-json
// --include-partial-messages), reenviado tal cual por el backend:
//  - stream_event / content_block_delta → texto incremental (token a token)
//  - result                             → objeto final, autoritativo
async function streamMessage(chatId, content, { onDelta, onDone, onError }) {
  let res;
  try {
    res = await fetch(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    onError(err);
    return;
  }
  if (!res.ok || !res.body) {
    onError(new Error(`HTTP ${res.status}`));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const handleFrame = (frame) => {
    const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) return;
    let evt;
    try {
      evt = JSON.parse(dataLine.slice(6));
    } catch {
      return;
    }
    if (evt.type === "stream_event" && evt.event?.type === "content_block_delta") {
      const delta = evt.event.delta;
      if (delta?.type === "text_delta" && delta.text) onDelta(delta.text);
    } else if (evt.type === "result") {
      onDone(evt);
    } else if (evt.type === "error") {
      onError(new Error(evt.error || "error desconocido del stream"));
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      handleFrame(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Utilidades                                                         */
/* ------------------------------------------------------------------ */
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function toLocalMessage(m) {
  return { role: m.role, text: m.content };
}

function toLocalChat(backendChat) {
  return {
    id: String(backendChat.id),
    parentId: backendChat.parent_id == null ? null : String(backendChat.parent_id),
    title: backendChat.title,
    context: backendChat.origin_fragment
      ? { fragment: backendChat.origin_fragment, source: backendChat.origin_source }
      : null,
    children: [],
    messages: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Markdown (estilos en el <style> global bajo la clase .md)          */
/* ------------------------------------------------------------------ */
const Markdown = memo(function Markdown({ text }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Componentes de presentación (sin cambios respecto del prototipo)   */
/* ------------------------------------------------------------------ */

function RailItem({ chat, active, onClick }) {
  return (
    <button
      onClick={onClick}
      title={chat.title}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: active ? C.accentDim : C.panelAlt,
        border: `1px solid ${active ? C.accent : C.border}`,
        borderRadius: 8,
        color: active ? C.accent : C.text,
        padding: "8px 10px",
        fontFamily: MONO,
        fontSize: 11,
        lineHeight: 1.35,
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      {trunc(chat.title, 34)}
    </button>
  );
}

function Arrow() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
      <svg width="12" height="22" viewBox="0 0 12 22">
        <line x1="6" y1="0" x2="6" y2="15" stroke={C.faint} strokeWidth="1.5" />
        <path d="M2 14 L6 21 L10 14" fill="none" stroke={C.faint} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function Rail({ ids, chats, side, onNavigate }) {
  return (
    <div
      style={{
        width: 168,
        flexShrink: 0,
        background: C.rail,
        borderRight: side === "left" ? `1px solid ${C.borderSoft}` : "none",
        borderLeft: side === "right" ? `1px solid ${C.borderSoft}` : "none",
        padding: "14px 10px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.faint,
          marginBottom: 10,
        }}
      >
        {side === "left" ? "anteriores" : "siguientes"}
      </div>
      {ids.map((id, i) => (
        <div key={id}>
          {i > 0 && <Arrow />}
          <RailItem chat={chats[id]} onClick={() => onNavigate(id)} />
        </div>
      ))}
      {side === "right" && ids.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
          <span style={{ color: C.faint, fontSize: 10, fontFamily: MONO }}>fin</span>
        </div>
      )}
    </div>
  );
}

function ContextChip({ context }) {
  const [open, setOpen] = useState(false);
  if (!context) return null;
  return (
    <div
      style={{
        margin: "0 0 14px 0",
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.accent}`,
        borderRadius: 8,
        background: C.panelAlt,
        padding: "10px 12px",
        fontSize: 12.5,
      }}
    >
      <div style={{ color: C.accent, fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", marginBottom: 6 }}>
        RAMA ABIERTA DESDE
      </div>
      <div style={{ color: C.text, fontStyle: "italic" }}>"{context.fragment}"</div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          marginTop: 6,
          background: "none",
          border: "none",
          color: C.muted,
          fontSize: 11,
          fontFamily: MONO,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? "▾ ocultar respuesta original" : "▸ ver respuesta original completa"}
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: `1px dashed ${C.border}`,
            color: C.muted,
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          <Markdown text={context.source} />
        </div>
      )}
    </div>
  );
}

const Message = memo(function Message({ msg, chatId }) {
  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "10px 0" }}>
        <div
          style={{
            background: C.userBubble,
            color: C.text,
            borderRadius: "12px 12px 3px 12px",
            padding: "9px 13px",
            maxWidth: "82%",
            fontSize: 13.5,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div
      data-selectable="1"
      data-chat={chatId}
      data-fulltext={msg.text}
      style={{
        color: C.text,
        fontSize: 13.5,
        margin: "12px 0 18px 0",
      }}
    >
      <Markdown text={msg.text} />
    </div>
  );
});

function ChatPanel({ chat, isActive, single, onSend, streamingText, canClose, onClose, busy }) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);
  const readOnly = !single && !isActive;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat.messages.length, streamingText]);

  const send = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    onSend(chat.id, t);
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: isActive ? C.panel : C.panelAlt,
        borderRight: `1px solid ${C.borderSoft}`,
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${C.borderSoft}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isActive ? C.accent : C.faint,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: isActive ? C.text : C.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {chat.title}
        </span>
        {!single && (
          <span style={{ marginLeft: readOnly ? 8 : "auto", fontFamily: MONO, fontSize: 10, color: C.faint }}>
            {isActive ? "actual" : "anterior · solo lectura"}
          </span>
        )}
        {canClose && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              onClick={onClose}
              disabled={busy}
              title="Cerrar la rama (no se borra, se puede reabrir desde el árbol)"
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.muted,
                borderRadius: 6,
                padding: "3px 8px",
                fontFamily: MONO,
                fontSize: 10.5,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              cerrar
            </button>
          </div>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
        <ContextChip context={chat.context} />
        {chat.messages.map((m, i) => (
          <Message key={i} msg={m} chatId={chat.id} />
        ))}
        {streamingText != null && (
          <Message msg={{ role: "assistant", text: streamingText || "…" }} chatId={chat.id} />
        )}
      </div>

      <div style={{ padding: "10px 14px 14px", borderTop: `1px solid ${C.borderSoft}` }}>
        {readOnly ? (
          <div
            style={{
              padding: "9px 12px",
              color: C.faint,
              fontFamily: MONO,
              fontSize: 11,
              border: `1px dashed ${C.border}`,
              borderRadius: 10,
            }}
          >
            solo lectura mientras la rama de la derecha está abierta
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 8,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "8px 10px",
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Mensaje para ${trunc(chat.title, 26)}`}
              rows={1}
              disabled={busy}
              style={{
                flex: 1,
                resize: "none",
                background: "transparent",
                border: "none",
                outline: "none",
                color: C.text,
                fontFamily: SANS,
                fontSize: 13,
                lineHeight: 1.4,
              }}
            />
            <button
              onClick={send}
              disabled={busy}
              style={{
                alignSelf: "flex-end",
                background: C.accent,
                color: "#1a1405",
                border: "none",
                borderRadius: 7,
                padding: "5px 12px",
                fontFamily: MONO,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              Enviar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeModal({ chats, rootId, currentIds, onGo, onClose }) {
  const render = (id, depth) => {
    const c = chats[id];
    if (!c) return null;
    return (
      <div key={id} style={{ marginLeft: depth * 18 }}>
        <button
          onClick={() => onGo(id)}
          style={{
            background: currentIds.includes(id) ? C.accentDim : "transparent",
            border: "none",
            borderLeft: `2px solid ${currentIds.includes(id) ? C.accent : C.border}`,
            color: currentIds.includes(id) ? C.accent : C.text,
            fontFamily: MONO,
            fontSize: 12,
            padding: "5px 10px",
            margin: "2px 0",
            cursor: "pointer",
            textAlign: "left",
            borderRadius: "0 6px 6px 0",
          }}
        >
          {trunc(c.title, 48)}
        </button>
        {c.children.map((k) => render(k, depth + 1))}
      </div>
    );
  };
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 20,
          width: 440,
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted, marginBottom: 12, letterSpacing: "0.06em" }}>
          ÁRBOL DE CONVERSACIONES
        </div>
        {render(rootId, 0)}
      </div>
    </div>
  );
}

function SummaryModal({ text, loading, error, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 20,
          width: 560,
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted, letterSpacing: "0.06em" }}>
            RESUMEN DE LA SESIÓN
          </div>
          {text && (
            <button
              onClick={() => navigator.clipboard.writeText(text)}
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.muted,
                borderRadius: 6,
                padding: "3px 8px",
                fontFamily: MONO,
                fontSize: 10.5,
                cursor: "pointer",
              }}
            >
              copiar
            </button>
          )}
        </div>
        {loading && <div style={{ color: C.muted, fontFamily: MONO, fontSize: 12 }}>generando resumen…</div>}
        {error && <div style={{ color: C.danger, fontSize: 13 }}>{error}</div>}
        {text && <div style={{ color: C.text, fontSize: 13.5 }}><Markdown text={text} /></div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
export default function App() {
  const sessionId = useRef(getSessionId()).current;

  const [chats, setChats] = useState({});
  const [path, setPath] = useState([]);
  const [focus, setFocus] = useState(0);
  const [selInfo, setSelInfo] = useState(null);
  const [streaming, setStreaming] = useState(null); // { chatId, text }
  const [treeOpen, setTreeOpen] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [busyChatId, setBusyChatId] = useState(null);
  const [summary, setSummary] = useState(null); // { loading, error, text } | null

  const rootId = path[0];

  /* ---- carga inicial: raíz + árbol persistido en SQLite ---- */
  useEffect(() => {
    if (!sessionId) {
      setLoadError(
        "Falta ?session=<id> en la URL. Esta web se levanta con el slash command /estudiar, que la pasa automáticamente."
      );
      return;
    }
    (async () => {
      try {
        const rootData = await apiGet(`/api/session?session=${encodeURIComponent(sessionId)}`);
        const tree = await apiGet("/api/tree");

        const map = {};
        for (const c of tree) map[String(c.id)] = toLocalChat(c);
        // La raíz puede no estar en /api/tree si es la primera vez (ya la
        // creó /api/session): la agregamos si hace falta.
        const rootKey = String(rootData.chat.id);
        if (!map[rootKey]) map[rootKey] = toLocalChat(rootData.chat);

        for (const id of Object.keys(map)) {
          const parentId = map[id].parentId;
          if (parentId && map[parentId]) map[parentId].children.push(id);
        }

        map[rootKey].messages = rootData.messages.map(toLocalMessage);
        await Promise.all(
          Object.keys(map)
            .filter((id) => id !== rootKey)
            .map(async (id) => {
              const msgs = await apiGet(`/api/chats/${id}/messages`);
              map[id].messages = msgs.map(toLocalMessage);
            })
        );

        setChats(map);
        setPath([rootKey]);
        setFocus(0);
      } catch (err) {
        setLoadError(String(err));
      }
    })();
  }, [sessionId]);

  /* ---- selección de texto ---- */
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (text.length < 3) return;
      let node = sel.anchorNode;
      while (node && node.nodeType !== 1) node = node.parentNode;
      const host = node ? node.closest('[data-selectable="1"]') : null;
      if (!host) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelInfo({
        chatId: host.getAttribute("data-chat"),
        text,
        source: host.getAttribute("data-fulltext"),
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    };
    const onDown = (e) => {
      if (e.target.closest && e.target.closest("#branch-btn")) return;
      setSelInfo(null);
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  /* ---- acciones ---- */
  const branch = async () => {
    if (!selInfo) return;
    const { chatId, text, source } = selInfo;
    setSelInfo(null);
    window.getSelection().removeAllRanges();

    try {
      const backendChat = await apiPost("/api/chats", {
        parent_id: Number(chatId),
        origin_fragment: text,
        origin_source: source,
      });
      const child = toLocalChat(backendChat);
      child.messages = [
        {
          role: "assistant",
          text: "Abrimos esta rama para profundizar en el punto seleccionado. Contame qué querés explorar sobre esto y lo desarrollamos sin mezclarlo con el hilo principal.",
        },
      ];

      setChats((prev) => {
        const parent = { ...prev[chatId], children: [...prev[chatId].children, child.id] };
        return { ...prev, [chatId]: parent, [child.id]: child };
      });
      setPath((prev) => {
        const i = prev.indexOf(chatId);
        const np = [...prev.slice(0, i + 1), child.id];
        setFocus(Math.max(0, np.length - 2));
        return np;
      });
    } catch (err) {
      setLoadError(String(err));
    }
  };

  const sendMessage = (chatId, text) => {
    setChats((prev) => ({
      ...prev,
      [chatId]: { ...prev[chatId], messages: [...prev[chatId].messages, { role: "user", text }] },
    }));
    setStreaming({ chatId, text: "" });
    setBusyChatId(chatId);

    streamMessage(chatId, text, {
      onDelta: (delta) => setStreaming((s) => (s && s.chatId === chatId ? { ...s, text: s.text + delta } : s)),
      onDone: (result) => {
        setChats((prev) => ({
          ...prev,
          [chatId]: {
            ...prev[chatId],
            messages: [...prev[chatId].messages, { role: "assistant", text: result.result }],
          },
        }));
        setStreaming(null);
        setBusyChatId(null);
      },
      onError: (err) => {
        setChats((prev) => ({
          ...prev,
          [chatId]: {
            ...prev[chatId],
            messages: [...prev[chatId].messages, { role: "assistant", text: `⚠ error: ${err.message}` }],
          },
        }));
        setStreaming(null);
        setBusyChatId(null);
      },
    });
  };

  const navigateTo = (id) => {
    const i = path.indexOf(id);
    if (i === -1) return;
    setFocus(Math.max(0, Math.min(i, path.length - 2)));
  };

  const goFromTree = (id) => {
    const chain = [];
    let cur = id;
    while (cur) {
      chain.unshift(cur);
      cur = chats[cur]?.parentId;
    }
    setPath(chain);
    setFocus(Math.max(0, chain.length - 2));
    setTreeOpen(false);
  };

  // Cerrar colapsa la rama fuera del camino visible (path); sigue viva en
  // `chats` y se puede reabrir desde el modal de árbol.
  const closeBranch = (chatId) => {
    const idx = path.indexOf(chatId);
    if (idx <= 0) return;
    const np = path.slice(0, idx);
    setPath(np);
    setFocus(Math.max(0, np.length - 2));
  };

  const summarizeSession = async () => {
    setSummary({ loading: true, error: null, text: null });
    try {
      const { summary: text } = await apiPost(`/api/chats/${rootId}/summarize-session`, {});
      setSummary({ loading: false, error: null, text });
    } catch (err) {
      setSummary({ loading: false, error: String(err), text: null });
    }
  };

  /* ---- derivados ---- */
  const single = path.length <= 1;
  const visible = single ? [path[0]] : [path[focus], path[focus + 1]];
  const leftRail = single ? [] : path.slice(0, focus);
  const rightRail = single ? [] : path.slice(focus + 2);
  const tipId = path[path.length - 1];

  if (loadError) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.bg,
          color: C.danger,
          fontFamily: MONO,
          fontSize: 13,
          padding: 24,
          textAlign: "center",
        }}
      >
        {loadError}
      </div>
    );
  }

  if (!rootId) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.bg,
          color: C.muted,
          fontFamily: MONO,
          fontSize: 13,
        }}
      >
        cargando…
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        fontFamily: SANS,
        overflow: "hidden",
      }}
    >
      <style>{`
        ::selection { background: rgba(229,168,59,0.35); }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        @keyframes pop { from { opacity: 0; transform: translate(-50%, -4px) scale(.95); } to { opacity: 1; transform: translate(-50%, -8px) scale(1); } }

        .md { line-height: 1.65; }
        .md > *:first-child { margin-top: 0; }
        .md > *:last-child { margin-bottom: 0; }
        .md p { margin: 0 0 10px 0; }
        .md h1, .md h2, .md h3, .md h4 { color: ${C.text}; font-weight: 600; margin: 16px 0 8px; line-height: 1.35; }
        .md h1 { font-size: 1.25em; }
        .md h2 { font-size: 1.12em; }
        .md h3, .md h4 { font-size: 1.02em; }
        .md ul, .md ol { margin: 0 0 10px 0; padding-left: 22px; }
        .md li { margin: 3px 0; }
        .md li > p { margin: 0; }
        .md strong { color: ${C.text}; font-weight: 700; }
        .md a { color: ${C.accent}; }
        .md hr { border: none; border-top: 1px solid ${C.border}; margin: 14px 0; }
        .md blockquote { margin: 8px 0; padding: 2px 0 2px 12px; border-left: 3px solid ${C.border}; color: ${C.muted}; }
        .md code { font-family: ${MONO}; font-size: 0.9em; background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 4px; padding: 1px 5px; }
        .md pre { background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; padding: 10px 12px; margin: 8px 0; overflow-x: auto; }
        .md pre code { background: none; border: none; padding: 0; }
        .md table { border-collapse: collapse; margin: 8px 0; font-size: 0.95em; }
        .md th, .md td { border: 1px solid ${C.border}; padding: 4px 8px; text-align: left; }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: `1px solid ${C.borderSoft}`,
          background: C.rail,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 14, color: C.accent, fontWeight: 700 }}>ramas</span>
        <span style={{ fontSize: 11.5, color: C.faint }}>
          seleccioná texto de una respuesta para abrir una rama en pantalla dividida
        </span>
        <button
          onClick={summarizeSession}
          disabled={summary?.loading}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.accent,
            borderRadius: 7,
            padding: "5px 12px",
            fontFamily: MONO,
            fontSize: 11,
            cursor: summary?.loading ? "default" : "pointer",
            opacity: summary?.loading ? 0.6 : 1,
          }}
        >
          {summary?.loading ? "generando…" : "resumen de sesión"}
        </button>
        <button
          onClick={() => setTreeOpen(true)}
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.muted,
            borderRadius: 7,
            padding: "5px 12px",
            fontFamily: MONO,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ver árbol
        </button>
      </div>

      {/* Cuerpo */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {leftRail.length > 0 && <Rail ids={leftRail} chats={chats} side="left" onNavigate={navigateTo} />}

        {visible.map((id, i) => (
          <ChatPanel
            key={id}
            chat={chats[id]}
            single={single}
            isActive={single || i === 1}
            onSend={sendMessage}
            streamingText={streaming && streaming.chatId === id ? streaming.text : null}
            canClose={!single && id === tipId && chats[id].parentId !== null && i === 1}
            onClose={() => closeBranch(id)}
            busy={busyChatId === id}
          />
        ))}

        {rightRail.length > 0 && <Rail ids={rightRail} chats={chats} side="right" onNavigate={navigateTo} />}
      </div>

      {/* Botón flotante de ramificar */}
      {selInfo && (
        <button
          id="branch-btn"
          onClick={branch}
          style={{
            position: "fixed",
            left: selInfo.x,
            top: selInfo.y,
            transform: "translate(-50%, -8px)",
            translate: "0 -100%",
            background: C.accent,
            color: "#1a1405",
            border: "none",
            borderRadius: 8,
            padding: "7px 14px",
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
            zIndex: 50,
            animation: "pop .14s ease-out",
          }}
        >
          ⑂ Abrir rama
        </button>
      )}

      {treeOpen && (
        <TreeModal chats={chats} rootId={rootId} currentIds={path} onGo={goFromTree} onClose={() => setTreeOpen(false)} />
      )}

      {summary && (
        <SummaryModal
          text={summary.text}
          loading={summary.loading}
          error={summary.error}
          onClose={() => setSummary(null)}
        />
      )}
    </div>
  );
}
