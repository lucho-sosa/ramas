import { useState, useRef, useEffect } from "react";

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
/*  Datos simulados                                                    */
/* ------------------------------------------------------------------ */
let nextId = 1;
let branchCount = 0;

const CANNED = [
  "Para implementar esto conviene separar el problema en capas. La capa de presentación maneja la selección de texto y el layout dividido, mientras que la capa de datos mantiene el árbol de conversaciones en memoria y lo sincroniza con el backend. Cada rama guarda una referencia a su chat padre y al fragmento que le dio origen.",
  "El manejo de sesiones es el punto más delicado. Claude Code asigna un identificador único a cada sesión, y el flag de fork permite clonar el historial en una sesión nueva sin tocar la original. Eso significa que ramificar no duplica costos de contexto pasado, solo continúa desde el punto de bifurcación.",
  "En cuanto a la persistencia, SQLite es suficiente para este caso de uso. Una tabla de chats con columnas id, parent_id, session_id, titulo y fragmento origen alcanza para reconstruir el árbol completo. Los mensajes pueden vivir en una tabla aparte relacionada por chat_id, con rol, contenido y timestamp.",
  "El streaming de respuestas se resuelve con Server-Sent Events. El backend en Go lanza el proceso del CLI, lee stdout línea por línea con bufio.Scanner, parsea cada evento JSON y lo reenvía al navegador. El frontend va acumulando los deltas de texto y actualizando el mensaje en pantalla en tiempo real.",
  "Un detalle importante es el título automático de cada rama. Podés generarlo truncando el fragmento seleccionado, o pedirle al modelo un título corto en la primera respuesta de la rama. La segunda opción da mejores resultados pero agrega una llamada extra, así que conviene hacerla en segundo plano.",
];

function cannedReply() {
  const a = CANNED[Math.floor(Math.random() * CANNED.length)];
  let b = CANNED[Math.floor(Math.random() * CANNED.length)];
  if (b === a) b = CANNED[(CANNED.indexOf(a) + 1) % CANNED.length];
  return a + "\n\n" + b;
}

function makeRoot() {
  const id = String(nextId++);
  return {
    id,
    parentId: null,
    title: "Chat principal",
    context: null,
    children: [],
    messages: [
      { role: "user", text: "Explicame cómo funciona la arquitectura de este proyecto." },
      {
        role: "assistant",
        text:
          "La arquitectura tiene tres piezas. El frontend en React dibuja los paneles de chat, detecta la selección de texto y muestra el botón de ramificar. El backend en Go recibe cada mensaje, ejecuta Claude Code en local con la sesión correspondiente y devuelve la respuesta por streaming. Por último, SQLite guarda el árbol de conversaciones para que las ramas persistan entre sesiones.\n\nCuando abrís una rama, el backend usa el fork de sesión del CLI: clona el historial del chat padre hasta ese punto y continúa en una sesión nueva. Así cada rama hereda el fragmento seleccionado y la respuesta completa de donde salió, sin mezclar los historiales.",
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Utilidades                                                         */
/* ------------------------------------------------------------------ */
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/* ------------------------------------------------------------------ */
/*  Componentes                                                        */
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
      <div style={{ color: C.text, fontStyle: "italic" }}>“{context.fragment}”</div>
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
            whiteSpace: "pre-wrap",
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {context.source}
        </div>
      )}
    </div>
  );
}

function Message({ msg, chatId }) {
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
        lineHeight: 1.65,
        margin: "12px 0 18px 0",
        whiteSpace: "pre-wrap",
      }}
    >
      {msg.text}
    </div>
  );
}

function ChatPanel({ chat, isActive, single, onSend, typing }) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat.messages.length, typing]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
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
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.faint }}>
            {isActive ? "actual" : "anterior"}
          </span>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
        <ContextChip context={chat.context} />
        {chat.messages.map((m, i) => (
          <Message key={i} msg={m} chatId={chat.id} />
        ))}
        {typing && (
          <div style={{ color: C.muted, fontFamily: MONO, fontSize: 12, margin: "8px 0" }}>
            escribiendo<span className="dots">…</span>
          </div>
        )}
      </div>

      <div style={{ padding: "10px 14px 14px", borderTop: `1px solid ${C.borderSoft}` }}>
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
              cursor: "pointer",
            }}
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function TreeModal({ chats, rootId, currentIds, onGo, onClose }) {
  const render = (id, depth) => {
    const c = chats[id];
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

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
export default function App() {
  const [chats, setChats] = useState(() => {
    const root = makeRoot();
    return { [root.id]: root };
  });
  const [path, setPath] = useState(() => [Object.keys({ 1: 1 })[0]]);
  const [focus, setFocus] = useState(0);
  const [selInfo, setSelInfo] = useState(null);
  const [typingIn, setTypingIn] = useState(null);
  const [treeOpen, setTreeOpen] = useState(false);

  const rootId = path[0];

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
  const branch = () => {
    if (!selInfo) return;
    const { chatId, text, source } = selInfo;
    setSelInfo(null);
    window.getSelection().removeAllRanges();

    branchCount += 1;
    const id = String(nextId++);
    const child = {
      id,
      parentId: chatId,
      title: `Rama ${branchCount}: “${trunc(text, 22)}”`,
      context: { fragment: text, source },
      children: [],
      messages: [
        {
          role: "assistant",
          text: `Abrimos esta rama para profundizar en el punto seleccionado. Contame qué querés explorar sobre esto y lo desarrollamos sin mezclarlo con el hilo principal.`,
        },
      ],
    };

    setChats((prev) => {
      const parent = { ...prev[chatId], children: [...prev[chatId].children, id] };
      return { ...prev, [chatId]: parent, [id]: child };
    });
    setPath((prev) => {
      const i = prev.indexOf(chatId);
      const np = [...prev.slice(0, i + 1), id];
      setFocus(Math.max(0, np.length - 2));
      return np;
    });
  };

  const sendMessage = (chatId, text) => {
    setChats((prev) => ({
      ...prev,
      [chatId]: { ...prev[chatId], messages: [...prev[chatId].messages, { role: "user", text }] },
    }));
    setTypingIn(chatId);
    setTimeout(() => {
      setChats((prev) => ({
        ...prev,
        [chatId]: {
          ...prev[chatId],
          messages: [...prev[chatId].messages, { role: "assistant", text: cannedReply() }],
        },
      }));
      setTypingIn(null);
    }, 900);
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
      cur = chats[cur].parentId;
    }
    setPath(chain);
    setFocus(Math.max(0, chain.length - 2));
    setTreeOpen(false);
  };

  /* ---- derivados ---- */
  const single = path.length === 1;
  const visible = single ? [path[0]] : [path[focus], path[focus + 1]];
  const leftRail = single ? [] : path.slice(0, focus);
  const rightRail = single ? [] : path.slice(focus + 2);

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
          onClick={() => setTreeOpen(true)}
          style={{
            marginLeft: "auto",
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
            typing={typingIn === id}
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
    </div>
  );
}
