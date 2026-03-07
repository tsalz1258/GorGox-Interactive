import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const store = window.storage || null;
const DATA_KEY = "grimoire-v3";
const uid = () => Math.random().toString(36).slice(2, 10);

const defaultData = {
  sessions: [], npcs: [], items: [], moments: [], initiatives: [], players: [],
  quests: [], locations: [], factions: [], loreChat: [],
  storyHelper: { premise: "", acts: ["", "", ""], themes: "", conflicts: "" },
  campaignName: "Untitled Campaign",
};

async function loadData() {
  try {
    if (store) {
      const r = await Promise.race([
        store.get(DATA_KEY).then(r => r ? JSON.parse(r.value) : null).catch(() => null),
        new Promise(res => setTimeout(() => res(null), 2000))
      ]);
      if (r) return r;
    }
  } catch {}
  return { ...defaultData };
}

async function saveData(d) {
  try { if (store) await store.set(DATA_KEY, JSON.stringify(d)); } catch {}
}

function rollDice(n) {
  const m = n.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  const c = parseInt(m[1] || "1"), s = parseInt(m[2]), mod = parseInt(m[3] || "0");
  const rolls = Array.from({ length: c }, () => Math.floor(Math.random() * s) + 1);
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + mod, notation: n };
}

async function askAI(prompt, sys) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: sys || "You are a creative D&D/TTRPG assistant. Be vivid, concise, and inspiring. Keep responses under 400 words.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d = await res.json();
    return d.content?.map((b) => b.text || "").join("\n") || "No response.";
  } catch {
    return "AI unavailable. Try again.";
  }
}

function doExport(data) {
  try {
    const j = JSON.stringify(data, null, 2);
    const b = new Blob([j], { type: "application/json" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u;
    a.download = (data.campaignName || "campaign").replace(/[^a-z0-9]/gi, "_") + "_backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
    return true;
  } catch { return false; }
}

function doImport(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => {
      try {
        const p = JSON.parse(e.target.result);
        if (p && typeof p === "object") resolve({ ...defaultData, ...p });
        else reject("Invalid format");
      } catch { reject("Bad JSON"); }
    };
    r.onerror = () => reject("Read error");
    r.readAsText(file);
  });
}

// ════════════════════════════════
// MAIN APP
// ════════════════════════════════
export default function App() {
  const [data, setData] = useState(defaultData);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("loreforge");
  const [dice, setDice] = useState(false);
  const [diceR, setDiceR] = useState(null);
  const [diceN, setDiceN] = useState("1d20");
  const [sidebar, setSidebar] = useState(true);
  const [search, setSearch] = useState("");
  const [searchOn, setSearchOn] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    let ok = true;
    const t = setTimeout(() => { if (ok && !ready) { setReady(true); } }, 3000);
    loadData().then((d) => { if (ok) { setData(d); setReady(true); clearTimeout(t); } });
    return () => { ok = false; clearTimeout(t); };
  }, []);

  const persist = useCallback((fn) => {
    setData((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      saveData(next);
      return next;
    });
  }, []);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const r = [];
    (data.npcs || []).forEach((n) => { if ((n.name + n.role + n.notes).toLowerCase().includes(q)) r.push({ type: "NPC", name: n.name, icon: "👤", tab: "npcs" }); });
    (data.items || []).forEach((i) => { if ((i.name + i.description).toLowerCase().includes(q)) r.push({ type: "Item", name: i.name, icon: "🎒", tab: "items" }); });
    (data.quests || []).forEach((x) => { if ((x.title + x.description).toLowerCase().includes(q)) r.push({ type: "Quest", name: x.title, icon: "📋", tab: "quests" }); });
    (data.locations || []).forEach((l) => { if ((l.name + l.description).toLowerCase().includes(q)) r.push({ type: "Location", name: l.name, icon: "🏰", tab: "locations" }); });
    (data.sessions || []).forEach((s) => { if ((s.title + s.content).toLowerCase().includes(q)) r.push({ type: "Session", name: s.title, icon: "📜", tab: "story" }); });
    (data.factions || []).forEach((f) => { if ((f.name + f.description).toLowerCase().includes(q)) r.push({ type: "Faction", name: f.name, icon: "🏴", tab: "factions" }); });
    return r.slice(0, 12);
  }, [search, data]);

  const handleImport = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const d = await doImport(f);
      persist(d);
      setMsg("Imported!");
    } catch (err) {
      setMsg("Error: " + err);
    }
    setTimeout(() => setMsg(""), 3000);
    if (e.target) e.target.value = "";
  };

  if (!ready) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#1a1410" }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "radial-gradient(circle,#d4a574,#5a3e28)", animation: "orbPulse 1.5s ease infinite" }} />
      <p style={{ fontFamily: "'Cinzel',serif", color: "#d4a574", fontSize: 15, marginTop: 16 }}>Opening the Grimoire...</p>
    </div>
  );

  const tabs = [
    { id: "loreforge", label: "Lore Forge", icon: "🔮" },
    { id: "story", label: "Sessions", icon: "📜" },
    { id: "storyhelper", label: "Story Builder", icon: "✨" },
    { id: "quests", label: "Quests", icon: "📋" },
    { id: "npcs", label: "NPCs", icon: "👤" },
    { id: "locations", label: "Locations", icon: "🏰" },
    { id: "factions", label: "Factions", icon: "🏴" },
    { id: "items", label: "Items", icon: "🎒" },
    { id: "moments", label: "Key Moments", icon: "⭐" },
    { id: "loremap", label: "Lore Map", icon: "🗺️" },
    { id: "initiative", label: "Initiative", icon: "⚔️" },
    { id: "players", label: "Players", icon: "🎭" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#1a1410", color: "#c8b090", fontFamily: "'Crimson Text',serif", position: "relative" }}>
      <style>{CSS}</style>
      <input type="file" ref={fileRef} accept=".json" onChange={handleImport} style={{ display: "none" }} />

      <header style={{ background: "linear-gradient(to right,#221a12,#1a1410)", borderBottom: "2px solid #2a1f14", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSidebar(!sidebar)} style={{ background: "none", border: "1px solid #2a1f14", color: "#d4a574", fontSize: 16, padding: "3px 8px", borderRadius: 5, cursor: "pointer" }}>☰</button>
          <div>
            <h1 style={{ fontFamily: "'Cinzel',serif", fontSize: 20, fontWeight: 700, color: "#d4a574", margin: 0 }}>The Chronicler's Grimoire</h1>
            <input value={data.campaignName} onChange={(e) => persist((d) => ({ ...d, campaignName: e.target.value }))} style={{ background: "none", border: "none", borderBottom: "1px solid #2a1f14", color: "#8a6a4a", fontSize: 11, fontFamily: "'Crimson Text',serif", fontStyle: "italic", padding: "2px 0", outline: "none", width: 200 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {msg && <span style={{ fontSize: 11, color: "#4a9", fontFamily: "'Cinzel',serif" }}>{msg}</span>}
          <button onClick={() => doExport(data)} className="hb" style={hBtn}>💾 Export</button>
          <button onClick={() => fileRef.current?.click()} className="hb" style={hBtn}>📂 Import</button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setSearchOn(!searchOn)} className="hb" style={hBtn}>🔍</button>
            {searchOn && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#221a12", border: "1px solid #3a2a1a", borderRadius: 8, width: 300, maxHeight: 350, overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.6)", zIndex: 100 }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", background: "#0d0a07", border: "none", borderBottom: "1px solid #2a1f14", color: "#e8d5b7", padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} placeholder="Search lore..." autoFocus />
                {searchResults.map((r, i) => (
                  <div key={i} onClick={() => { setTab(r.tab); setSearchOn(false); setSearch(""); }} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #1a1410" }}>
                    <span>{r.icon}</span><span style={{ flex: 1 }}>{r.name}</span><span style={{ fontSize: 10, color: "#8a6a4a" }}>{r.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setDice(!dice)} className="hb" style={hBtn}>🎲</button>
        </div>
      </header>

      {dice && (
        <div style={{ position: "fixed", top: 56, right: 16, zIndex: 100, background: "linear-gradient(135deg,#221a12,#1a1410)", border: "1px solid #3a2a1a", borderRadius: 10, padding: 16, width: 260, boxShadow: "0 10px 40px rgba(0,0,0,0.6)" }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
            {["1d4", "1d6", "1d8", "1d10", "1d12", "1d20", "2d6", "1d100"].map((d) => (
              <button key={d} onClick={() => { setDiceN(d); setDiceR(rollDice(d)); }} className="hb" style={{ border: "1px solid #3a2a1a", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontFamily: "'Cinzel',serif", fontSize: 11, fontWeight: 600, background: diceN === d ? "#d4a574" : "rgba(212,165,116,0.12)", color: diceN === d ? "#1a1410" : "#d4a574" }}>{d}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={diceN} onChange={(e) => setDiceN(e.target.value)} style={inp} placeholder="2d8+3" />
            <button onClick={() => setDiceR(rollDice(diceN))} className="hb" style={{ background: "#d4a574", color: "#1a1410", border: "none", padding: "6px 14px", borderRadius: 5, cursor: "pointer", fontFamily: "'Cinzel',serif", fontWeight: 700, fontSize: 13 }}>Roll!</button>
          </div>
          {diceR && <div style={{ marginTop: 10, textAlign: "center", padding: 10, background: "rgba(212,165,116,0.06)", borderRadius: 6 }}><div style={{ fontSize: 36, fontWeight: 700, fontFamily: "'Cinzel',serif", color: "#d4a574" }}>{diceR.total}</div><div style={{ fontSize: 12, color: "#8a6a4a" }}>{diceR.notation} → [{diceR.rolls.join(", ")}]</div></div>}
        </div>
      )}

      <div style={{ display: "flex", minHeight: "calc(100vh - 56px)", position: "relative", zIndex: 1 }}>
        {sidebar && (
          <nav style={{ width: 175, background: "linear-gradient(to bottom,#1e1610,#1a1410)", borderRight: "1px solid #221a12", padding: "12px 6px", display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, overflowY: "auto" }}>
            <div style={{ textAlign: "center", color: "#2a1f14", fontSize: 16, padding: "4px 0" }}>❧</div>
            {tabs.map((t) => (
              <button key={t.id} className="tb" onClick={() => setTab(t.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: tab === t.id ? "rgba(212,165,116,0.1)" : "none", border: "none", borderLeft: tab === t.id ? "3px solid #d4a574" : "3px solid transparent", color: tab === t.id ? "#e8d5b7" : "#8a6a4a", fontFamily: "'Crimson Text',serif", fontSize: 13, cursor: "pointer", borderRadius: "0 5px 5px 0", textAlign: "left", width: "100%" }}>
                <span style={{ fontSize: 15 }}>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
            <div style={{ marginTop: "auto" }}>
              <button onClick={() => doExport(data)} className="hb" style={sBtn}>💾 Export</button>
              <button onClick={() => fileRef.current?.click()} className="hb" style={sBtn}>📂 Import</button>
              <button onClick={() => { if (confirm("Reset ALL data?")) persist({ ...defaultData }); }} style={{ ...sBtn, color: "#774444", borderColor: "#2a1a1a" }}>🗑 Reset</button>
            </div>
          </nav>
        )}
        <main style={{ flex: 1, padding: 20, overflowY: "auto", maxHeight: "calc(100vh - 56px)" }}>
          {tab === "loreforge" && <LoreForge data={data} persist={persist} />}
          {tab === "story" && <Sessions data={data} persist={persist} />}
          {tab === "storyhelper" && <StoryBuilder data={data} persist={persist} />}
          {tab === "quests" && <Quests data={data} persist={persist} />}
          {tab === "npcs" && <NPCs data={data} persist={persist} />}
          {tab === "locations" && <Locations data={data} persist={persist} />}
          {tab === "factions" && <Factions data={data} persist={persist} />}
          {tab === "items" && <Items data={data} persist={persist} />}
          {tab === "moments" && <Moments data={data} persist={persist} />}
          {tab === "loremap" && <LoreMap data={data} />}
          {tab === "initiative" && <Initiative data={data} persist={persist} />}
          {tab === "players" && <Players data={data} persist={persist} />}
        </main>
      </div>
    </div>
  );
}

// ════════ SHARED ════════
const hBtn = { background: "linear-gradient(135deg,#2a1f14,#1a1410)", border: "1px solid #3a2a1a", color: "#d4a574", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "'Cinzel',serif", fontSize: 11, fontWeight: 600 };
const aBtn = { background: "linear-gradient(135deg,#3a2a1a,#2a1f14)", border: "1px solid #5a3e28", color: "#d4a574", padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontFamily: "'Cinzel',serif", fontSize: 12, fontWeight: 600 };
const aiBtn = { background: "linear-gradient(135deg,#2a1f3a,#1a1420)", border: "1px solid #6a4ea0", color: "#c4a0f4", padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontFamily: "'Cinzel',serif", fontSize: 12, fontWeight: 600 };
const sBtn = { display: "block", width: "100%", background: "none", border: "1px solid #2a1f14", color: "#8a6a4a", padding: "4px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: "'Crimson Text',serif", marginBottom: 4 };
const inp = { width: "100%", background: "#0d0a07", border: "1px solid #1e1610", color: "#c8b090", padding: "5px 8px", borderRadius: 5, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'Crimson Text',serif" };
const ta = { width: "100%", background: "#0d0a07", border: "1px solid #1e1610", color: "#c8b090", padding: "6px 8px", borderRadius: 5, fontSize: 13, lineHeight: 1.5, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "'Crimson Text',serif" };
const sel = { width: "100%", background: "#0d0a07", border: "1px solid #1e1610", color: "#c8b090", padding: "5px 8px", borderRadius: 5, fontSize: 12, outline: "none", fontFamily: "'Crimson Text',serif" };
const card = { background: "linear-gradient(135deg,rgba(34,26,18,0.9),rgba(26,20,16,0.9))", border: "1px solid #2a1f14", borderRadius: 8, overflow: "hidden" };
const ml = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#6a5a4a", display: "block", marginBottom: 1, fontFamily: "'Cinzel',serif" };
const xBtn = { background: "none", border: "none", color: "#554444", fontSize: 13, cursor: "pointer", padding: "2px 5px" };

function Hdr({ icon, title, desc }) {
  return (<div style={{ borderBottom: "1px solid #2a1f14", paddingBottom: 10 }}>
    <h2 style={{ fontFamily: "'Cinzel',serif", color: "#e8d5b7", fontSize: 20, fontWeight: 600, margin: 0 }}>{icon} {title}</h2>
    <p style={{ color: "#8a6a4a", fontSize: 13, fontStyle: "italic", margin: "3px 0 0" }}>{desc}</p>
  </div>);
}
function F({ label, value, onChange, multi, placeholder }) {
  return (<div style={{ marginTop: 5 }}>
    <label style={ml}>{label}</label>
    {multi ? <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...ta, minHeight: 44 }} placeholder={placeholder} />
      : <input value={value || ""} onChange={(e) => onChange(e.target.value)} style={inp} placeholder={placeholder} />}
  </div>);
}
function Empty({ icon, text }) {
  return <div style={{ textAlign: "center", padding: 36, color: "#3a2a1a" }}><div style={{ fontSize: 44, marginBottom: 8 }}>{icon}</div><p style={{ fontStyle: "italic", color: "#5a3e28" }}>{text}</p></div>;
}

// ════════ LORE FORGE ════════
function LoreForge({ data, persist }) {
  const defaultMsg = { role: "assistant", content: "Greetings, Chronicler. I am the Lore Forge — your worldbuilding companion.\n\nI can see everything in your Grimoire: NPCs, locations, factions, quests, sessions, and story notes. Tell me what you're stuck on and I'll help.\n\n🌍 Worldbuilding — history, cultures, geography\n👤 Characters — backstories, dialogue, motivations\n📖 Plot — arcs, twists, consequences\n⚔️ Encounters — combat, puzzles, social\n🏰 Locations — vivid descriptions\n✍️ Writing — polish or expand any text\n\nWhat shall we forge?" };
  const msgs = (data.loreChat && data.loreChat.length > 0) ? data.loreChat : [defaultMsg];
  const setMsgs = (newMsgs) => {
    const resolved = typeof newMsgs === "function" ? newMsgs(msgs) : newMsgs;
    persist((d) => ({ ...d, loreChat: resolved }));
  };
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("general");
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const buildCtx = () => {
    const p = [`Campaign: "${data.campaignName}"`];
    const sh = data.storyHelper || {};
    if (sh.premise) p.push("Premise: " + sh.premise);
    if (sh.themes) p.push("Themes: " + sh.themes);
    if (sh.conflicts) p.push("Conflicts: " + sh.conflicts);
    if (data.npcs?.length) p.push("NPCs:\n" + data.npcs.map((n) => `- ${n.name} (${n.race || "?"} ${n.role || "?"}) ${n.disposition || ""} ${!n.alive ? "[DEAD]" : ""} ${n.personality?.slice(0, 80) || ""}`).join("\n"));
    if (data.locations?.length) p.push("Locations:\n" + data.locations.map((l) => `- ${l.name} (${l.type}) ${l.description?.slice(0, 80) || ""}`).join("\n"));
    if (data.factions?.length) p.push("Factions:\n" + data.factions.map((f) => `- ${f.name} (${f.type}) ${f.goals?.slice(0, 80) || ""}`).join("\n"));
    if (data.quests?.length) p.push("Quests:\n" + data.quests.map((q) => `- "${q.title}" [${q.status}] ${q.description?.slice(0, 80) || ""}`).join("\n"));
    if (data.items?.length) p.push("Items:\n" + data.items.map((i) => `- ${i.name} (${i.rarity} ${i.type})`).join("\n"));
    return p.join("\n\n");
  };

  const modeSys = {
    general: "You are the Lore Forge, an expert D&D worldbuilding AI. You have the DM's full campaign data. Be creative, specific, and reference existing NPCs/locations/quests by name. Under 500 words.",
    character: "You are a D&D character specialist. Develop NPCs with backstories, motivations, speech patterns, secrets. Reference existing campaign elements.",
    worldbuild: "You are an expert fantasy worldbuilder. Develop history, cultures, religions, geography. Include sensory details.",
    plot: "You are a D&D plot architect. Develop arcs, twists, consequences. Reference existing quests and unresolved threads.",
    writing: "You are a fantasy writing assistant. Help write vivid, atmospheric descriptions ready for the table.",
    encounter: "You are a D&D encounter designer. Create combats, puzzles, social encounters with tactical detail.",
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input };
    const withUser = [...msgs, userMsg];
    setMsgs(withUser);
    setInput("");
    setLoading(true);
    const sys = modeSys[mode] + "\n\n=== CAMPAIGN ===\n" + buildCtx();
    const hist = withUser.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: sys, messages: hist }),
      });
      const d = await res.json();
      const reply = d.content?.map((b) => b.text || "").join("\n") || "No response.";
      setMsgs([...withUser, { role: "assistant", content: reply }]);
    } catch {
      setMsgs([...withUser, { role: "assistant", content: "Connection lost. Try again." }]);
    }
    setLoading(false);
  };

  const quicks = ["Expand an NPC", "Describe a location", "Plot twist idea", "Connect the dots", "Write a prophecy", "Session hook", "Faction conflict", "Tavern encounter"];
  const modes = [
    { id: "general", l: "🔮 General" }, { id: "character", l: "👤 Character" }, { id: "worldbuild", l: "🌍 World" },
    { id: "plot", l: "📖 Plot" }, { id: "writing", l: "✍️ Writing" }, { id: "encounter", l: "⚔️ Encounter" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 96px)" }}>
      <Hdr icon="🔮" title="Lore Forge" desc="AI worldbuilding companion — knows your entire campaign" />
      <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
        {modes.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)} className="hb" style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: "'Cinzel',serif", cursor: "pointer", background: mode === m.id ? "rgba(140,80,200,0.2)" : "rgba(212,165,116,0.05)", border: mode === m.id ? "1px solid #8a50c8" : "1px solid #2a1f14", color: mode === m.id ? "#c4a0f4" : "#8a6a4a" }}>{m.l}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        {quicks.map((q, i) => (
          <button key={i} onClick={() => setInput("Help me: " + q.toLowerCase())} className="hb" style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, background: "rgba(212,165,116,0.06)", border: "1px solid #2a1f14", color: "#a08060", cursor: "pointer" }}>{q}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: m.role === "user" ? "linear-gradient(135deg,rgba(90,62,40,0.3),rgba(60,42,28,0.4))" : "linear-gradient(135deg,rgba(60,40,80,0.2),rgba(30,20,40,0.3))", border: m.role === "user" ? "1px solid #5a3e28" : "1px solid #3a2a4a" }}>
            <div style={{ fontSize: 10, color: m.role === "user" ? "#d4a574" : "#b490d4", marginBottom: 4, fontFamily: "'Cinzel',serif", textTransform: "uppercase", letterSpacing: 1 }}>{m.role === "user" ? "You" : "🔮 Lore Forge"}</div>
            <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "#c8b090" }}>{m.content}</div>
          </div>
        ))}
        {loading && <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "12px 12px 12px 2px", background: "linear-gradient(135deg,rgba(60,40,80,0.2),rgba(30,20,40,0.3))", border: "1px solid #3a2a4a" }}><span style={{ color: "#8a6aaa", fontStyle: "italic", fontSize: 13 }}>✦ Weaving lore... ✦</span></div>}
        <div ref={endRef} />
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask the Lore Forge..." style={{ ...ta, flex: 1, minHeight: 44, maxHeight: 120, padding: "10px 12px", fontSize: 14, borderRadius: 8 }} />
        <button onClick={send} className="hb" disabled={loading || !input.trim()} style={{ ...aiBtn, padding: "10px 18px", flexShrink: 0 }}>{loading ? "..." : "Send 🔮"}</button>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: "#3a2a1a", textAlign: "center", display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
        <span>📚 {data.npcs?.length || 0} NPCs · {data.locations?.length || 0} locations · {data.factions?.length || 0} factions · {data.quests?.length || 0} quests · {data.sessions?.length || 0} sessions</span>
        <button onClick={() => { if (confirm("Clear chat history?")) setMsgs([defaultMsg]); }} className="hb" style={{ fontSize: 10, background: "none", border: "1px solid #2a1f14", color: "#664444", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}>Clear Chat</button>
      </div>
    </div>
  );
}

// ════════ SESSIONS ════════
function Sessions({ data, persist }) {
  const [active, setActive] = useState(null);
  const [aiOut, setAiOut] = useState("");
  const [aiL, setAiL] = useState(false);
  const sessions = data.sessions || [];
  const upd = (fn) => persist((d) => ({ ...d, sessions: fn(d.sessions || []) }));
  const add = () => { const s = { id: uid(), title: "Session " + (sessions.length + 1), date: new Date().toLocaleDateString(), content: "", summary: "" }; upd((ss) => [...ss, s]); setActive(s.id); };
  const set = (id, f, v) => upd((ss) => ss.map((s) => (s.id === id ? { ...s, [f]: v } : s)));
  const del = (id) => { upd((ss) => ss.filter((s) => s.id !== id)); if (active === id) setActive(null); };
  const cur = sessions.find((s) => s.id === active);
  const genSum = async () => {
    if (!cur?.content) return;
    setAiL(true);
    const r = await askAI("Summarize this D&D session into: Key Events, NPC Interactions, Decisions, Unresolved Threads, Loot.\n\nNotes:\n" + cur.content);
    setAiOut(r); set(cur.id, "summary", r); setAiL(false);
  };

  return (<div>
    <Hdr icon="📜" title="Session Chronicles" desc="Record your adventures" />
    <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
      <div style={{ width: 190, flexShrink: 0 }}>
        <button onClick={add} className="hb" style={aBtn}>+ New Session</button>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {sessions.map((s) => (
            <div key={s.id} onClick={() => { setActive(s.id); setAiOut(s.summary || ""); }} style={{ padding: "8px 10px", background: active === s.id ? "rgba(212,165,116,0.08)" : "rgba(34,26,18,0.5)", border: "1px solid " + (active === s.id ? "#3a2a1a" : "#1e1610"), borderRadius: 6, cursor: "pointer", position: "relative" }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{s.title}</div>
              <div style={{ fontSize: 11, opacity: 0.5 }}>{s.date}</div>
              <button onClick={(e) => { e.stopPropagation(); del(s.id); }} style={xBtn}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        {cur ? (<>
          <input value={cur.title} onChange={(e) => set(cur.id, "title", e.target.value)} style={{ width: "100%", background: "none", border: "none", borderBottom: "2px solid #2a1f14", color: "#e8d5b7", fontSize: 18, fontFamily: "'Cinzel',serif", fontWeight: 600, padding: "6px 0", outline: "none", marginBottom: 10 }} />
          <textarea value={cur.content} onChange={(e) => set(cur.id, "content", e.target.value)} style={{ ...ta, minHeight: 260, fontSize: 14, lineHeight: 1.7, padding: 12 }} placeholder="Write session notes..." />
          <button onClick={genSum} className="hb" style={{ ...aiBtn, marginTop: 8 }} disabled={aiL}>{aiL ? "✨ Generating..." : "✨ AI Summary"}</button>
          {(aiOut || cur.summary) && <div style={{ marginTop: 12, padding: 14, background: "rgba(60,40,80,0.1)", border: "1px solid #3a2a4a", borderRadius: 8, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "#c8b090" }}>{aiOut || cur.summary}</div>}
        </>) : <Empty icon="📖" text="Select or create a session" />}
      </div>
    </div>
  </div>);
}

// ════════ STORY BUILDER ════════
function StoryBuilder({ data, persist }) {
  const sh = data.storyHelper || {};
  const [aiOut, setAiOut] = useState("");
  const [aiL, setAiL] = useState(false);
  const upd = (f, v) => persist((d) => ({ ...d, storyHelper: { ...d.storyHelper, [f]: v } }));
  const updAct = (i, v) => { const a = [...(sh.acts || ["", "", ""])]; a[i] = v; persist((d) => ({ ...d, storyHelper: { ...d.storyHelper, acts: a } })); };
  const sparks = ["What if the villain was once the hero's mentor?", "A cursed artifact — destroying it costs something precious.", "The kingdom has a dark secret.", "A trusted NPC betrays them sympathetically.", "The 'monster' protects something sacred.", "Two factions both have valid claims."];
  const [spark, setSpark] = useState(sparks[0 | Math.random() * sparks.length]);
  const aiHelp = async (section, content) => {
    setAiL(true);
    const ctx = `Campaign: ${data.campaignName}\nPremise: ${sh.premise || ""}\nNPCs: ${(data.npcs || []).map((n) => n.name).join(", ")}`;
    setAiOut(await askAI(`Expand this ${section} of my D&D story. Suggest hooks, twists, connections.\n\n${ctx}\n\nContent: ${content || "(empty)"}`));
    setAiL(false);
  };

  return (<div>
    <Hdr icon="✨" title="Story Builder" desc="Weave your narrative with AI" />
    <div style={{ marginTop: 14, padding: 16, background: "rgba(90,62,40,0.1)", border: "1px solid #2a1f14", borderRadius: 8, textAlign: "center" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "#d4a574", marginBottom: 6 }}>💡 Story Spark</div>
      <p style={{ fontStyle: "italic", fontSize: 15, color: "#e8d5b7" }}>"{spark}"</p>
      <button onClick={() => setSpark(sparks[0 | Math.random() * sparks.length])} className="hb" style={{ ...sBtn, width: "auto", display: "inline-block", marginTop: 8, color: "#d4a574" }}>New Spark</button>
    </div>
    <div style={{ marginTop: 16 }}><label style={{ ...ml, fontSize: 13, color: "#d4a574" }}>📌 Core Premise</label>
      <textarea value={sh.premise || ""} onChange={(e) => upd("premise", e.target.value)} style={{ ...ta, minHeight: 70 }} placeholder="Your campaign's one-sentence pitch..." />
      <button onClick={() => aiHelp("Premise", sh.premise)} className="hb" style={{ ...aiBtn, fontSize: 11, padding: "3px 10px", marginTop: 4 }} disabled={aiL}>✨ Expand</button>
    </div>
    <div style={{ marginTop: 16 }}><label style={{ ...ml, fontSize: 13, color: "#d4a574" }}>🎭 Three Acts</label>
      {["Act I — Setup", "Act II — Confrontation", "Act III — Resolution"].map((l, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#d4a574", fontFamily: "'Cinzel',serif" }}>{l}</div>
          <textarea value={(sh.acts || [])[i] || ""} onChange={(e) => updAct(i, e.target.value)} style={{ ...ta, minHeight: 60 }} placeholder={"Outline " + l + "..."} />
        </div>
      ))}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
      <div><label style={{ ...ml, fontSize: 13, color: "#d4a574" }}>🌿 Themes</label><textarea value={sh.themes || ""} onChange={(e) => upd("themes", e.target.value)} style={{ ...ta, minHeight: 70 }} placeholder="Redemption, sacrifice..." /></div>
      <div><label style={{ ...ml, fontSize: 13, color: "#d4a574" }}>⚡ Conflicts</label><textarea value={sh.conflicts || ""} onChange={(e) => upd("conflicts", e.target.value)} style={{ ...ta, minHeight: 70 }} placeholder="Who opposes whom?" /></div>
    </div>
    {aiOut && <div style={{ marginTop: 14, padding: 14, background: "rgba(60,40,80,0.1)", border: "1px solid #3a2a4a", borderRadius: 8, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "#c8b090" }}>{aiOut}</div>}
  </div>);
}

// ════════ QUESTS ════════
function Quests({ data, persist }) {
  const [filter, setFilter] = useState("All");
  const quests = data.quests || [];
  const upd = (fn) => persist((d) => ({ ...d, quests: fn(d.quests || []) }));
  const add = () => upd((q) => [...q, { id: uid(), title: "New Quest", status: "Active", giver: "", description: "", rewards: "", consequences: "", threads: "" }]);
  const set = (id, f, v) => upd((q) => q.map((x) => (x.id === id ? { ...x, [f]: v } : x)));
  const del = (id) => upd((q) => q.filter((x) => x.id !== id));
  const stCol = { Active: "#4a9", Completed: "#48f", Failed: "#c44", Paused: "#d4a574" };
  const filtered = filter === "All" ? quests : quests.filter((q) => q.status === filter);

  return (<div>
    <Hdr icon="📋" title="Quest Board" desc="Track quests and unresolved threads" />
    <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
      <button onClick={add} className="hb" style={aBtn}>+ New Quest</button>
      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        {["All", "Active", "Completed", "Failed", "Paused"].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className="hb" style={{ border: "1px solid #2a1f14", borderRadius: 5, padding: "4px 10px", fontSize: 11, fontFamily: "'Cinzel',serif", cursor: "pointer", background: filter === s ? "rgba(212,165,116,0.2)" : "transparent", color: filter === s ? "#d4a574" : "#8a6a4a" }}>{s}</button>
        ))}
      </div>
    </div>
    {quests.filter((q) => q.status === "Active" && q.threads).length > 0 && (
      <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(212,165,116,0.06)", border: "1px dashed #5a3e28", borderRadius: 8 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "#d4a574", marginBottom: 6 }}>🧵 Unresolved Threads</div>
        {quests.filter((q) => q.status === "Active" && q.threads).map((q) => <div key={q.id} style={{ fontSize: 13, color: "#c8b090", marginBottom: 4 }}>• <strong>{q.title}:</strong> {q.threads}</div>)}
      </div>
    )}
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {filtered.map((q) => (
        <div key={q.id} style={{ ...card, borderLeft: "3px solid " + (stCol[q.status] || "#888"), padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <input value={q.title} onChange={(e) => set(q.id, "title", e.target.value)} style={{ background: "none", border: "none", color: "#e8d5b7", fontFamily: "'Cinzel',serif", fontWeight: 600, fontSize: 15, outline: "none" }} />
            <button onClick={() => del(q.id)} style={xBtn}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
            <select value={q.status} onChange={(e) => set(q.id, "status", e.target.value)} style={{ ...sel, width: "auto", color: stCol[q.status] }}>{Object.keys(stCol).map((s) => <option key={s}>{s}</option>)}</select>
            <input value={q.giver || ""} onChange={(e) => set(q.id, "giver", e.target.value)} style={{ ...inp, width: 160 }} placeholder="Quest Giver" />
          </div>
          <F label="Description" value={q.description} onChange={(v) => set(q.id, "description", v)} multi />
          <F label="Rewards" value={q.rewards} onChange={(v) => set(q.id, "rewards", v)} />
          <F label="🧵 Unresolved Threads" value={q.threads} onChange={(v) => set(q.id, "threads", v)} placeholder="Open questions..." />
        </div>
      ))}
    </div>
    {filtered.length === 0 && <Empty icon="📋" text="No quests" />}
  </div>);
}

// ════════ NPCs ════════
function NPCs({ data, persist }) {
  const [srch, setSrch] = useState("");
  const [exp, setExp] = useState(null);
  const npcs = data.npcs || [];
  const upd = (fn) => persist((d) => ({ ...d, npcs: fn(d.npcs || []) }));
  const add = () => { const n = { id: uid(), name: "New NPC", race: "", role: "", location: "", disposition: "Neutral", personality: "", notes: "", relationships: "", alive: true, secret: "" }; upd((ns) => [...ns, n]); setExp(n.id); };
  const set = (id, f, v) => upd((ns) => ns.map((n) => (n.id === id ? { ...n, [f]: v } : n)));
  const del = (id) => upd((ns) => ns.filter((n) => n.id !== id));
  const filtered = npcs.filter((n) => (n.name + n.role).toLowerCase().includes(srch.toLowerCase()));
  const dc = { Friendly: "#4a9", Neutral: "#d4a574", Hostile: "#c44", Unknown: "#888" };

  return (<div>
    <Hdr icon="👤" title="NPC Codex" desc="Every soul in your world" />
    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <input value={srch} onChange={(e) => setSrch(e.target.value)} style={{ ...inp, flex: 1 }} placeholder="🔍 Search..." />
      <button onClick={add} className="hb" style={aBtn}>+ Add NPC</button>
    </div>
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {filtered.map((n) => (
        <div key={n.id} style={card}>
          <div onClick={() => setExp(exp === n.id ? null : n.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>{n.alive ? "👤" : "💀"}</span>
              <div><div style={{ fontFamily: "'Cinzel',serif", fontWeight: 600, color: "#e8d5b7", fontSize: 14 }}>{n.name}</div><div style={{ fontSize: 11, color: "#8a6a4a" }}>{[n.race, n.role, n.location].filter(Boolean).join(" · ")}</div></div>
            </div>
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: (dc[n.disposition] || "#888") + "22", color: dc[n.disposition], border: "1px solid " + (dc[n.disposition] || "#888") + "44" }}>{n.disposition}</span>
          </div>
          {exp === n.id && (
            <div style={{ padding: "0 14px 14px", borderTop: "1px solid #2a1f14" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                <F label="Name" value={n.name} onChange={(v) => set(n.id, "name", v)} />
                <F label="Race" value={n.race} onChange={(v) => set(n.id, "race", v)} />
                <F label="Role" value={n.role} onChange={(v) => set(n.id, "role", v)} />
                <F label="Location" value={n.location} onChange={(v) => set(n.id, "location", v)} />
                <div><label style={ml}>Disposition</label><select value={n.disposition} onChange={(e) => set(n.id, "disposition", e.target.value)} style={sel}>{["Friendly", "Neutral", "Hostile", "Unknown"].map((d) => <option key={d}>{d}</option>)}</select></div>
                <label style={{ ...ml, display: "flex", alignItems: "center", gap: 6, marginTop: 16, cursor: "pointer" }}><input type="checkbox" checked={n.alive} onChange={(e) => set(n.id, "alive", e.target.checked)} /> Alive</label>
              </div>
              <F label="Personality" value={n.personality} onChange={(v) => set(n.id, "personality", v)} multi />
              <F label="Relationships" value={n.relationships} onChange={(v) => set(n.id, "relationships", v)} multi />
              <F label="🔒 DM Secret" value={n.secret} onChange={(v) => set(n.id, "secret", v)} multi />
              <F label="Notes" value={n.notes} onChange={(v) => set(n.id, "notes", v)} multi />
              <button onClick={() => del(n.id)} style={{ background: "rgba(120,60,60,0.15)", border: "1px solid #554444", color: "#aa6666", padding: "4px 12px", borderRadius: 5, cursor: "pointer", fontSize: 11, marginTop: 8 }}>🗑 Remove</button>
            </div>
          )}
        </div>
      ))}
    </div>
    {filtered.length === 0 && <Empty icon="👤" text="No NPCs" />}
  </div>);
}

// ════════ LOCATIONS ════════
function Locations({ data, persist }) {
  const locs = data.locations || [];
  const upd = (fn) => persist((d) => ({ ...d, locations: fn(d.locations || []) }));
  const add = () => upd((l) => [...l, { id: uid(), name: "New Location", type: "Town", description: "", notes: "", npcsHere: "", danger: "Low" }]);
  const set = (id, f, v) => upd((l) => l.map((x) => (x.id === id ? { ...x, [f]: v } : x)));
  const del = (id) => upd((l) => l.filter((x) => x.id !== id));
  const ic = { Town: "🏘️", City: "🏙️", Dungeon: "⛏️", Forest: "🌲", Mountain: "⛰️", Castle: "🏰", Temple: "⛪", Tavern: "🍺", Cave: "🕳️", Other: "📍" };

  return (<div>
    <Hdr icon="🏰" title="Atlas of Places" desc="Map your world" />
    <button onClick={add} className="hb" style={{ ...aBtn, marginTop: 16 }}>+ Add Location</button>
    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: 10 }}>
      {locs.map((l) => (
        <div key={l.id} style={{ ...card, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 24 }}>{ic[l.type] || "📍"}</span><button onClick={() => del(l.id)} style={xBtn}>✕</button></div>
          <F label="Name" value={l.name} onChange={(v) => set(l.id, "name", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><label style={ml}>Type</label><select value={l.type} onChange={(e) => set(l.id, "type", e.target.value)} style={sel}>{Object.keys(ic).map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label style={ml}>Danger</label><select value={l.danger} onChange={(e) => set(l.id, "danger", e.target.value)} style={sel}>{["Low", "Medium", "High", "Deadly"].map((d) => <option key={d}>{d}</option>)}</select></div>
          </div>
          <F label="Description" value={l.description} onChange={(v) => set(l.id, "description", v)} multi />
          <F label="NPCs Here" value={l.npcsHere} onChange={(v) => set(l.id, "npcsHere", v)} />
          <F label="Notes" value={l.notes} onChange={(v) => set(l.id, "notes", v)} multi />
        </div>
      ))}
    </div>
    {locs.length === 0 && <Empty icon="🏰" text="No locations" />}
  </div>);
}

// ════════ FACTIONS ════════
function Factions({ data, persist }) {
  const factions = data.factions || [];
  const upd = (fn) => persist((d) => ({ ...d, factions: fn(d.factions || []) }));
  const add = () => upd((f) => [...f, { id: uid(), name: "New Faction", type: "Guild", alignment: "Neutral", leader: "", goals: "", description: "", members: "", relationships: "" }]);
  const set = (id, f, v) => upd((fs) => fs.map((x) => (x.id === id ? { ...x, [f]: v } : x)));
  const del = (id) => upd((f) => f.filter((x) => x.id !== id));

  return (<div>
    <Hdr icon="🏴" title="Factions & Orders" desc="Powers that shape your world" />
    <button onClick={add} className="hb" style={{ ...aBtn, marginTop: 16 }}>+ Add Faction</button>
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {factions.map((f) => (
        <div key={f.id} style={{ ...card, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <input value={f.name} onChange={(e) => set(f.id, "name", e.target.value)} style={{ background: "none", border: "none", color: "#e8d5b7", fontFamily: "'Cinzel',serif", fontWeight: 600, fontSize: 15, outline: "none" }} />
            <button onClick={() => del(f.id)} style={xBtn}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
            <div><label style={ml}>Type</label><select value={f.type} onChange={(e) => set(f.id, "type", e.target.value)} style={sel}>{["Guild", "Religion", "Military", "Criminal", "Political", "Arcane", "Other"].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label style={ml}>Alignment</label><select value={f.alignment} onChange={(e) => set(f.id, "alignment", e.target.value)} style={sel}>{["Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "Neutral", "Chaotic Neutral", "Lawful Evil", "Neutral Evil", "Chaotic Evil"].map((a) => <option key={a}>{a}</option>)}</select></div>
            <F label="Leader" value={f.leader} onChange={(v) => set(f.id, "leader", v)} />
          </div>
          <F label="Goals" value={f.goals} onChange={(v) => set(f.id, "goals", v)} multi />
          <F label="Description" value={f.description} onChange={(v) => set(f.id, "description", v)} multi />
          <F label="Key Members" value={f.members} onChange={(v) => set(f.id, "members", v)} />
          <F label="Relationships" value={f.relationships} onChange={(v) => set(f.id, "relationships", v)} multi />
        </div>
      ))}
    </div>
    {factions.length === 0 && <Empty icon="🏴" text="No factions" />}
  </div>);
}

// ════════ ITEMS ════════
function Items({ data, persist }) {
  const items = data.items || [];
  const upd = (fn) => persist((d) => ({ ...d, items: fn(d.items || []) }));
  const add = () => upd((i) => [...i, { id: uid(), name: "New Item", type: "Weapon", rarity: "Common", holder: "", description: "", magical: false }]);
  const set = (id, f, v) => upd((i) => i.map((x) => (x.id === id ? { ...x, [f]: v } : x)));
  const del = (id) => upd((i) => i.filter((x) => x.id !== id));
  const rc = { Common: "#aaa", Uncommon: "#4a9", Rare: "#48f", "Very Rare": "#a4f", Legendary: "#fa4", Artifact: "#f44" };

  return (<div>
    <Hdr icon="🎒" title="Item Vault" desc="Treasures and curiosities" />
    <button onClick={add} className="hb" style={{ ...aBtn, marginTop: 16 }}>+ Add Item</button>
    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 10 }}>
      {items.map((i) => (
        <div key={i.id} style={{ ...card, borderLeft: "3px solid " + (rc[i.rarity] || "#aaa"), padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>{i.magical ? "✨" : "🔹"} {i.name}</span><button onClick={() => del(i.id)} style={xBtn}>✕</button></div>
          <F label="Name" value={i.name} onChange={(v) => set(i.id, "name", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><label style={ml}>Type</label><select value={i.type} onChange={(e) => set(i.id, "type", e.target.value)} style={sel}>{["Weapon", "Armor", "Potion", "Scroll", "Ring", "Wondrous", "Tool", "Other"].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label style={ml}>Rarity</label><select value={i.rarity} onChange={(e) => set(i.id, "rarity", e.target.value)} style={{ ...sel, color: rc[i.rarity] }}>{Object.keys(rc).map((r) => <option key={r}>{r}</option>)}</select></div>
          </div>
          <F label="Held By" value={i.holder} onChange={(v) => set(i.id, "holder", v)} />
          <F label="Description" value={i.description} onChange={(v) => set(i.id, "description", v)} multi />
          <label style={{ ...ml, display: "flex", alignItems: "center", gap: 6, marginTop: 6, cursor: "pointer" }}><input type="checkbox" checked={i.magical} onChange={(e) => set(i.id, "magical", e.target.checked)} /> Magical</label>
        </div>
      ))}
    </div>
    {items.length === 0 && <Empty icon="💎" text="No items" />}
  </div>);
}

// ════════ MOMENTS ════════
function Moments({ data, persist }) {
  const moments = data.moments || [];
  const upd = (fn) => persist((d) => ({ ...d, moments: fn(d.moments || []) }));
  const add = () => upd((m) => [{ id: uid(), title: "", session: "", description: "", impact: "Low", type: "Story" }, ...m]);
  const set = (id, f, v) => upd((m) => m.map((x) => (x.id === id ? { ...x, [f]: v } : x)));
  const del = (id) => upd((m) => m.filter((x) => x.id !== id));
  const ic = { Low: "#888", Medium: "#d4a574", High: "#fa4", Critical: "#f44" };
  const ti = { Story: "📖", Combat: "⚔️", Social: "🗣️", Discovery: "🔮", Death: "💀", Betrayal: "🗡️" };

  return (<div>
    <Hdr icon="⭐" title="Key Moments" desc="Turning points" />
    <button onClick={add} className="hb" style={{ ...aBtn, marginTop: 16 }}>+ Record Moment</button>
    <div style={{ marginTop: 16, paddingLeft: 28, position: "relative" }}>
      <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2, background: "linear-gradient(to bottom,#d4a574,transparent)" }} />
      {moments.map((m) => (
        <div key={m.id} style={{ ...card, marginBottom: 10, marginLeft: 6, position: "relative", padding: 12 }}>
          <div style={{ position: "absolute", left: -22, top: 14, width: 12, height: 12, borderRadius: "50%", background: ic[m.impact], border: "2px solid #1a1410", zIndex: 1 }} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span>{ti[m.type] || "📖"}</span>
              <input value={m.title} onChange={(e) => set(m.id, "title", e.target.value)} style={{ background: "none", border: "none", color: "#e8d5b7", fontFamily: "'Cinzel',serif", fontWeight: 600, outline: "none" }} placeholder="What happened?" />
            </div>
            <button onClick={() => del(m.id)} style={xBtn}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, margin: "6px 0" }}>
            <select value={m.type} onChange={(e) => set(m.id, "type", e.target.value)} style={{ ...sel, width: "auto" }}>{Object.keys(ti).map((t) => <option key={t}>{t}</option>)}</select>
            <select value={m.impact} onChange={(e) => set(m.id, "impact", e.target.value)} style={{ ...sel, width: "auto", color: ic[m.impact] }}>{Object.keys(ic).map((i) => <option key={i}>{i}</option>)}</select>
          </div>
          <textarea value={m.description} onChange={(e) => set(m.id, "description", e.target.value)} style={{ ...ta, minHeight: 50 }} placeholder="Describe..." />
        </div>
      ))}
    </div>
    {moments.length === 0 && <Empty icon="⭐" text="No moments" />}
  </div>);
}

// ════════ LORE MAP ════════
function LoreMap({ data }) {
  const entities = useMemo(() => {
    const e = [];
    (data.npcs || []).forEach((n) => e.push({ type: "NPC", name: n.name, icon: "👤", color: "#4a9", links: (n.relationships || "") + " " + (n.location || "") }));
    (data.locations || []).forEach((l) => e.push({ type: "Loc", name: l.name, icon: "🏰", color: "#48f", links: l.npcsHere || "" }));
    (data.factions || []).forEach((f) => e.push({ type: "Fac", name: f.name, icon: "🏴", color: "#a4f", links: f.leader + " " + f.members + " " + f.relationships }));
    (data.quests || []).forEach((q) => e.push({ type: "Quest", name: q.title, icon: "📋", color: "#fa4", links: q.giver + " " + q.threads }));
    return e;
  }, [data]);

  const conns = useMemo(() => {
    const c = [];
    entities.forEach((e, i) => entities.forEach((o, j) => {
      if (i >= j || !e.name || !o.name) return;
      if (e.links.toLowerCase().includes(o.name.toLowerCase()) || o.links.toLowerCase().includes(e.name.toLowerCase())) c.push([i, j]);
    }));
    return c;
  }, [entities]);

  const cx = 400, cy = 300, r = 220;
  const pos = entities.map((_, i) => { const a = (2 * Math.PI * i) / (entities.length || 1) - Math.PI / 2; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; });

  return (<div>
    <Hdr icon="🗺️" title="Lore Map" desc="See how your world connects" />
    {entities.length === 0 ? <Empty icon="🗺️" text="Add entities to see connections" /> : (
      <div style={{ marginTop: 12, background: "rgba(13,10,7,0.6)", border: "1px solid #2a1f14", borderRadius: 12, overflow: "hidden" }}>
        <svg width="100%" viewBox="0 0 800 600">
          {conns.map(([a, b], i) => <line key={i} x1={pos[a]?.x} y1={pos[a]?.y} x2={pos[b]?.x} y2={pos[b]?.y} stroke="rgba(212,165,116,0.2)" strokeWidth="1.5" strokeDasharray="4,4" />)}
          {entities.map((e, i) => (
            <g key={i}><circle cx={pos[i].x} cy={pos[i].y} r={26} fill={e.color + "22"} stroke={e.color} strokeWidth="1.5" />
              <text x={pos[i].x} y={pos[i].y + 5} textAnchor="middle" fontSize="18">{e.icon}</text>
              <text x={pos[i].x} y={pos[i].y + 44} textAnchor="middle" fontSize="9" fill="#c8b090" fontFamily="Cinzel,serif">{e.name.length > 16 ? e.name.slice(0, 14) + "…" : e.name}</text>
            </g>
          ))}
          <text x="400" y="20" textAnchor="middle" fontSize="12" fill="#5a3e28" fontFamily="Cinzel,serif">{conns.length} connections</text>
        </svg>
      </div>
    )}
  </div>);
}

// ════════ INITIATIVE ════════
function Initiative({ data, persist }) {
  const inits = data.initiatives || [];
  const [round, setRound] = useState(1);
  const [idx, setIdx] = useState(0);
  const upd = (fn) => persist((d) => ({ ...d, initiatives: fn(d.initiatives || []) }));
  const add = () => upd((i) => [...i, { id: uid(), name: "", init: 0, hp: 0, maxHp: 0, ac: 0, isNpc: false }]);
  const set = (id, f, v) => { upd((i) => { let n = i.map((x) => (x.id === id ? { ...x, [f]: v } : x)); if (f === "init") n.sort((a, b) => b.init - a.init); return n; }); };
  const rem = (id) => upd((i) => i.filter((x) => x.id !== id));
  const next = () => { if (!inits.length) return; const n = (idx + 1) % inits.length; if (n === 0) setRound((r) => r + 1); setIdx(n); };

  return (<div>
    <Hdr icon="⚔️" title="Initiative Tracker" desc="Order of battle" />
    <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
      <button onClick={add} className="hb" style={aBtn}>+ Combatant</button>
      <button onClick={next} className="hb" style={{ ...aBtn, background: "#2a4a3a", borderColor: "#4a9" }}>Next ▶</button>
      <button onClick={() => { upd(() => []); setRound(1); setIdx(0); }} className="hb" style={{ ...aBtn, background: "#4a2a2a", borderColor: "#c44" }}>Clear</button>
      <span style={{ marginLeft: "auto", fontFamily: "'Cinzel',serif", color: "#d4a574" }}>Round {round}</span>
    </div>
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      {inits.map((e, i) => (
        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", background: i === idx ? "rgba(212,165,116,0.08)" : "rgba(34,26,18,0.5)", border: "1px solid " + (i === idx ? "#3a2a1a" : "#1e1610"), borderRadius: 6, flexWrap: "wrap" }}>
          {i === idx && <span>▶</span>}
          <input value={e.name} onChange={(ev) => set(e.id, "name", ev.target.value)} style={{ ...inp, flex: 1, fontWeight: 600, minWidth: 80 }} placeholder="Name" />
          <label style={{ fontSize: 10, color: "#8a6a4a", display: "flex", alignItems: "center", gap: 3 }}><input type="checkbox" checked={e.isNpc} onChange={(ev) => set(e.id, "isNpc", ev.target.checked)} /> NPC</label>
          {[["Init", "init"], ["HP", "hp"], ["Max", "maxHp"], ["AC", "ac"]].map(([l, f]) => (
            <div key={f} style={{ textAlign: "center" }}><div style={{ fontSize: 8, color: "#8a6a4a", textTransform: "uppercase" }}>{l}</div><input value={e[f]} onChange={(ev) => set(e.id, f, parseInt(ev.target.value) || 0)} style={{ ...inp, width: 45, textAlign: "center", padding: "2px 3px" }} /></div>
          ))}
          <button onClick={() => rem(e.id)} style={xBtn}>✕</button>
        </div>
      ))}
    </div>
    {inits.length === 0 && <Empty icon="⚔️" text="Add combatants" />}
  </div>);
}

// ════════ PLAYERS ════════
function Players({ data, persist }) {
  const players = data.players || [];
  const [code] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const upd = (fn) => persist((d) => ({ ...d, players: fn(d.players || []) }));
  const add = () => upd((p) => [...p, { id: uid(), name: "", character: "", class: "", level: 1, race: "", notes: "", present: true }]);
  const set = (id, f, v) => upd((p) => p.map((x) => (x.id === id ? { ...x, [f]: v } : x)));
  const del = (id) => upd((p) => p.filter((x) => x.id !== id));

  return (<div>
    <Hdr icon="🎭" title="The Party" desc="Your adventurers" />
    <div style={{ marginTop: 12, padding: "8px 14px", background: "rgba(212,165,116,0.05)", border: "1px dashed #3a2a1a", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12 }}>📡 Session Code:</span>
      <span style={{ fontFamily: "monospace", fontSize: 15, color: "#d4a574", fontWeight: 700 }}>{code}</span>
    </div>
    <button onClick={add} className="hb" style={{ ...aBtn, marginTop: 12 }}>+ Add Player</button>
    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
      {players.map((p) => (
        <div key={p.id} style={{ ...card, padding: 14, opacity: p.present ? 1 : 0.5 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 24 }}>🎭</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label style={{ fontSize: 10, color: "#8a6a4a", display: "flex", alignItems: "center", gap: 3 }}><input type="checkbox" checked={p.present} onChange={(e) => set(p.id, "present", e.target.checked)} /> Here</label>
              <button onClick={() => del(p.id)} style={xBtn}>✕</button>
            </div>
          </div>
          <F label="Player" value={p.name} onChange={(v) => set(p.id, "name", v)} />
          <F label="Character" value={p.character} onChange={(v) => set(p.id, "character", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <F label="Class" value={p.class} onChange={(v) => set(p.id, "class", v)} />
            <F label="Race" value={p.race} onChange={(v) => set(p.id, "race", v)} />
            <F label="Level" value={p.level} onChange={(v) => set(p.id, "level", v)} />
          </div>
          <F label="DM Notes" value={p.notes} onChange={(v) => set(p.id, "notes", v)} multi />
        </div>
      ))}
    </div>
    {players.length === 0 && <Empty icon="🎭" text="No players" />}
  </div>);
}

// ════════ CSS ════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#1a1410}::-webkit-scrollbar-thumb{background:#3a2a1a;border-radius:3px}
textarea,input,select{font-family:'Crimson Text',serif}
@keyframes orbPulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.15);opacity:1}}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.hb{transition:all .2s ease;cursor:pointer}.hb:hover{transform:translateY(-1px);filter:brightness(1.15)}.hb:disabled{opacity:.5;transform:none;cursor:not-allowed}
.tb{transition:all .2s}.tb:hover{background:rgba(212,165,116,.1)!important}
`;
