import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, SkipForward, Loader2,
  X, ArrowDownToLine, Volume2,
} from "lucide-react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type SourceId = "jamendo" | "archive" | "netlabels" | "ccmixter" | "russian" | "audius";

interface Track {
  id: string;
  name: string;
  artist: string;
  audio: string;
  image: string;
  duration: number;
  source: SourceId;
  mixcloudKey?: string;
}

type ElectronAPI = {
  isElectron: true;
  minimize: () => void;
  hideToTray: () => void;
  close: () => void;
  dragStart: () => void;
  dragEnd: () => void;
  resizeStart: (edge?: string) => void;
  resizeEnd: () => void;
  toggleAlwaysOnTop?: () => void;
  onAlwaysOnTopChanged?: (cb: (on: boolean) => void) => () => void;
  musicFetch?: (source: string, tags: string[], limit?: number) => Promise<Track[]>;
};

function getElectron(): ElectronAPI | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI ?? null;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const SOURCES: { id: SourceId; label: string }[] = [
  { id: "jamendo",   label: "JAMENDO" },
  { id: "archive",   label: "INTERNET ARCHIVE" },
  { id: "netlabels", label: "NETLABELS" },
  { id: "ccmixter",  label: "CCMIXTER" },
  { id: "audius",    label: "AUDIUS" },
  { id: "russian",   label: "РУССКАЯ" },
];

// On the web build there is no Electron main process, so ccMixter (expired TLS +
// CORS + Referer requirement) can't play — hide it. Desktop keeps all sources.
const IS_ELECTRON = typeof window !== "undefined" && !!(window as unknown as { electronAPI?: unknown }).electronAPI;
const ACTIVE_SOURCES = IS_ELECTRON ? SOURCES : SOURCES.filter((s) => s.id !== "ccmixter");

const GENRES: Record<SourceId, { id: string; label: string }[]> = {
  jamendo: [
    { id: "rock",             label: "Rock" },
    { id: "alternative-rock", label: "Alt Rock" },
    { id: "pop",              label: "Pop" },
    { id: "electronic",       label: "Electronic" },
    { id: "hiphop",           label: "Hip-Hop" },
    { id: "jazz",             label: "Jazz" },
    { id: "classical",        label: "Classical" },
    { id: "ambient",          label: "Ambient" },
    { id: "chillout",         label: "Chillout" },
    { id: "lounge",           label: "Lounge" },
    { id: "house",            label: "House" },
    { id: "techno",           label: "Techno" },
    { id: "metal",            label: "Metal" },
    { id: "folk",             label: "Folk" },
    { id: "reggae",           label: "Reggae" },
    { id: "world",            label: "World" },
    { id: "soundtrack",       label: "Soundtrack" },
    { id: "synthwave",        label: "Synthwave" },
  ],
  archive: [
    { id: "rock",             label: "Rock" },
    { id: "alternative-rock", label: "Alt Rock" },
    { id: "electronic",       label: "Electronic" },
    { id: "jazz",             label: "Jazz" },
    { id: "blues",            label: "Blues" },
    { id: "classical",        label: "Classical" },
    { id: "folk",             label: "Folk" },
    { id: "ambient",          label: "Ambient" },
    { id: "chillout",         label: "Chillout" },
    { id: "lounge",           label: "Lounge" },
    { id: "house",            label: "House" },
    { id: "techno",           label: "Techno" },
    { id: "world",            label: "World" },
    { id: "reggae",           label: "Reggae" },
    { id: "hiphop",           label: "Hip-Hop" },
  ],
  netlabels: [
    { id: "electronic",  label: "Electronic" },
    { id: "ambient",     label: "Ambient" },
    { id: "idm",         label: "IDM" },
    { id: "techno",      label: "Techno" },
    { id: "house",       label: "House" },
    { id: "dnb",         label: "Drum & Bass" },
    { id: "breakbeat",   label: "Breakbeat" },
    { id: "downtempo",   label: "Downtempo" },
    { id: "chillout",    label: "Chillout" },
    { id: "dub",         label: "Dub" },
    { id: "experimental",label: "Experimental" },
    { id: "glitch",      label: "Glitch" },
    { id: "trance",      label: "Trance" },
    { id: "synthwave",   label: "Synthwave" },
  ],
  ccmixter: [
    { id: "electronic",  label: "Electronic" },
    { id: "ambient",     label: "Ambient" },
    { id: "techno",      label: "Techno" },
    { id: "house",       label: "House" },
    { id: "dnb",         label: "Drum & Bass" },
    { id: "breakbeat",   label: "Breakbeat" },
    { id: "downtempo",   label: "Downtempo" },
    { id: "chillout",    label: "Chillout" },
    { id: "trip hop",    label: "Trip-Hop" },
    { id: "hiphop",      label: "Hip-Hop" },
    { id: "jazz",        label: "Jazz" },
    { id: "funk",        label: "Funk" },
    { id: "rock",        label: "Rock" },
    { id: "pop",         label: "Pop" },
    { id: "experimental",label: "Experimental" },
    { id: "instrumental",label: "Instrumental" },
  ],
  audius: [
    { id: "electronic",  label: "Electronic" },
    { id: "house",       label: "House" },
    { id: "techno",      label: "Techno" },
    { id: "hip hop",     label: "Hip-Hop" },
    { id: "trap",        label: "Trap" },
    { id: "lo-fi",       label: "Lo-Fi" },
    { id: "dnb",         label: "Drum & Bass" },
    { id: "dubstep",     label: "Dubstep" },
    { id: "ambient",     label: "Ambient" },
    { id: "chill",       label: "Chill" },
    { id: "pop",         label: "Pop" },
    { id: "rock",        label: "Rock" },
    { id: "jazz",        label: "Jazz" },
    { id: "rap",         label: "Rap" },
    { id: "remix",       label: "Remix" },
    { id: "russian rap", label: "Русский рэп" },
  ],
  russian: [
    { id: "rock",        label: "Рок" },
    { id: "pop",         label: "Поп" },
    { id: "electronic",  label: "Электроника" },
    { id: "hiphop",      label: "Хип-хоп" },
    { id: "jazz",        label: "Джаз" },
    { id: "folk",        label: "Фолк" },
    { id: "punk",        label: "Панк" },
    { id: "metal",       label: "Метал" },
    { id: "ambient",     label: "Эмбиент" },
    { id: "techno",      label: "Техно" },
    { id: "house",       label: "Хаус" },
    { id: "indie",       label: "Инди" },
    { id: "chanson",     label: "Шансон" },
    { id: "classical",   label: "Классика" },
    { id: "soundtrack",  label: "Саундтреки" },
  ],
};

// Tag fallback chains per genre id
const FALLBACKS: Record<string, string[][]> = {
  "alternative-rock": [["alternative rock"], ["alt rock"], ["alternative"], ["indie rock"]],
  rock:        [["rock"], ["classic rock"], ["indie rock"]],
  pop:         [["pop"], ["indie pop"]],
  electronic:  [["electronic"], ["electronica"], ["edm"]],
  hiphop:      [["hip hop"], ["hiphop"], ["rap"]],
  jazz:        [["jazz"], ["smooth jazz"], ["jazz fusion"]],
  classical:   [["classical"], ["orchestral"], ["piano"]],
  lounge:      [["lounge"], ["chillout"], ["downtempo"]],
  ambient:     [["ambient"], ["drone"], ["atmospheric"]],
  metal:       [["metal"], ["heavy metal"]],
  folk:        [["folk"], ["acoustic"]],
  house:       [["house"], ["deep house"], ["dance"]],
  techno:      [["techno"], ["minimal techno"], ["electronic"]],
  chillout:    [["chillout"], ["chill"], ["downtempo"]],
  soundtrack:  [["soundtrack"], ["score"], ["cinematic"]],
  world:       [["world"], ["world music"], ["folk"], ["ethnic"]],
  reggae:      [["reggae"], ["dub"], ["ska"]],
  idm:         [["idm"], ["experimental"], ["electronic"]],
  dnb:         [["drum and bass"], ["dnb"], ["jungle"]],
  breakbeat:   [["breakbeat"], ["breaks"]],
  downtempo:   [["downtempo"], ["chillout"], ["trip hop"]],
  dub:         [["dub"], ["reggae"]],
  experimental:[["experimental"], ["avant-garde"]],
  glitch:      [["glitch"], ["idm"], ["experimental"]],
  trance:      [["trance"], ["progressive trance"], ["psytrance"]],
  disco:       [["disco"], ["nu disco"], ["funk"]],
  synthwave:   [["synthwave"], ["retrowave"], ["outrun"], ["vaporwave"]],
  blues:       [["blues"], ["electric blues"], ["rhythm and blues"]],
};

function fallbacksFor(id: string): string[][] {
  return FALLBACKS[id] ?? [[id]];
}

// ─────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────

const TALK_RE =
  /\b(talk|talks|talking|podcast|podcasts|interview|interviews|speech|lecture|lectures|spoken[\s-]?word|sermon|audiobook|audio[\s-]?book|story|stories|radio[\s-]?show|radio[\s-]?talk|news|debate|smart\s*talk|conversation)\b/i;

const BAD_COLLECTIONS = new Set([
  "smarttalk","podcasts","radioprograms","oldtimeradio","audio_bookspoetry",
  "audio_religion","audio_news","audio_podcast","spokenword","librivoxaudio","audio_tech",
]);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}

function pickText(v: unknown, fb = ""): string {
  if (Array.isArray(v)) return String(v[0] ?? fb);
  if (typeof v === "string") return v;
  return fb;
}
function arrText(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return [];
}

function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(fb), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(fb); });
  });
}

function archiveTag(t: string): string {
  return t.toLowerCase()
    .replace(/^dnb$/, "drum and bass")
    .replace(/^hiphop$/, "hip hop");
}

// ─────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────

async function fetchArchiveTracks(
  tags: string[],
  source: "archive" | "netlabels" | "russian",
  limit = 10,
): Promise<Track[]> {
  const qTags = tags.map(archiveTag).filter(Boolean).slice(0, 4);
  if (!qTags.length) return [];

  const tagQuery = qTags.map((t) => `(subject:"${t}" OR title:"${t}")`).join(" OR ");
  const colFilter = source === "netlabels" ? "collection:netlabels" : "mediatype:audio";
  const russian = source === "russian"
    ? ' AND (subject:"russian" OR subject:"russia" OR subject:"русская" OR subject:"русский" OR language:"rus" OR language:"Russian")'
    : "";
  const exclude = Array.from(BAD_COLLECTIONS).map((c) => `-collection:${c}`).join(" ");
  const params = new URLSearchParams({
    q: `${colFilter} AND (${tagQuery})${russian} ${exclude}`,
    output: "json",
    rows: "24",
    sort: "random desc",
  });
  ["identifier","title","creator","subject","collection","description"].forEach((f) =>
    params.append("fl[]", f),
  );

  try {
    const res = await fetch(`https://archive.org/advancedsearch.php?${params}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { response?: { docs?: Array<Record<string, unknown>> } };

    const docs = (json.response?.docs ?? []).filter((d) => {
      const title   = pickText(d.title);
      const creator = pickText(d.creator);
      const subj    = arrText(d.subject).join(" ");
      const colls   = arrText(d.collection).map((c) => c.toLowerCase());
      if (colls.some((c) => BAD_COLLECTIONS.has(c))) return false;
      if (TALK_RE.test(title) || TALK_RE.test(creator) || TALK_RE.test(subj)) return false;
      return true;
    });

    const out: Track[] = [];
    await Promise.allSettled(
      docs.slice(0, 10).map(async (d) => {
        if (out.length >= limit) return;
        const id = String(d.identifier ?? "");
        if (!id) return;
        const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}/files`);
        if (!r.ok) return;
        const j = (await r.json()) as { result?: Array<{ name: string; format?: string; length?: string; title?: string }> };
        const files = j.result ?? [];
        const mp3 =
          files.find((f) => /vbr mp3/i.test(f.format ?? "")) ||
          files.find((f) => /mp3/i.test(f.format ?? "")) ||
          files.find((f) => /\.mp3$/i.test(f.name));
        if (!mp3?.name) return;
        const name = mp3.title || pickText(d.title, id);
        if (TALK_RE.test(name)) return;
        const audio = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURI(mp3.name)}`;
        if (out.some((t) => t.audio === audio)) return;
        out.push({
          id: `ia:${id}:${mp3.name}`,
          name,
          artist: pickText(d.creator, source === "netlabels" ? "Netlabels" : "Internet Archive"),
          audio,
          image: "",
          duration: Number(mp3.length ?? 0) || 0,
          source,
        });
      }),
    );
    return shuffle(out).slice(0, limit);
  } catch {
    return [];
  }
}

async function fetchAudiusTracks(tags: string[]): Promise<Track[]> {
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const t of tags.slice(0, 3)) {
    try {
      const params = new URLSearchParams({ query: t, limit: "200", app_name: "Outspace" });
      const res = await fetch(`https://api.audius.co/v1/tracks/search?${params}`);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: Array<{ id?: string; title?: string; duration?: number;
          user?: { name?: string; handle?: string }; artwork?: Record<string, string> }>;
      };
      for (const tr of json.data ?? []) {
        const id = tr.id;
        if (!id || seen.has(id)) continue;
        const name = tr.title || "Audius";
        const artist = tr.user?.name || tr.user?.handle || "Audius";
        if (TALK_RE.test(name) || TALK_RE.test(artist)) continue;
        seen.add(id);
        out.push({
          id: `au:${id}`, name, artist,
          audio: `https://api.audius.co/v1/tracks/${id}/stream?app_name=Outspace`,
          image: tr.artwork?.["480x480"] || "", duration: Number(tr.duration) || 0, source: "audius",
        });
      }
    } catch { /* ignore */ }
  }
  return shuffle(out);
}

async function fetchMixcloudTracks(tags: string[], limit = 12): Promise<Track[]> {
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const t of tags.slice(0, 3)) {
    try {
      const params = new URLSearchParams({ q: archiveTag(t), type: "cloudcast", limit: "20" });
      const res = await fetch(`https://api.mixcloud.com/search/?${params}`);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: Array<{
          key?: string; name?: string; audio_length?: number;
          user?: { name?: string; username?: string };
          pictures?: Record<string, string>;
        }>;
      };
      for (const c of json.data ?? []) {
        if (!c.key || !c.name || seen.has(c.key)) continue;
        const artist = c.user?.name || c.user?.username || "Mixcloud";
        if (TALK_RE.test(c.name) || TALK_RE.test(artist)) continue;
        seen.add(c.key);
        out.push({
          id: `mx:${c.key}`,
          name: c.name,
          artist,
          audio: "",
          image: c.pictures?.["640wx640h"] || c.pictures?.large || c.pictures?.medium || "",
          duration: c.audio_length ?? 0,
          source: "mixcloud",
          mixcloudKey: c.key,
        });
        if (out.length >= limit) return shuffle(out);
      }
    } catch { /* next tag */ }
  }
  return shuffle(out);
}

// Jamendo: tries direct browser request using VITE_JAMENDO_CLIENT_ID env var.
// Falls back to Archive if unavailable.
async function fetchJamendoTracks(tags: string[], limit = 12): Promise<Track[]> {
  const clientId = import.meta.env.VITE_JAMENDO_CLIENT_ID as string | undefined;
  if (!clientId) return fetchArchiveTracks(tags, "archive", limit);
  try {
    const normalized = tags.map((t) => t.toLowerCase().replace(/\s+/g, "")).join("+");
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(limit),
      tags: normalized,
      include: "musicinfo",
      audioformat: "mp32",
      order: "popularity_total",
    });
    const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params}`);
    if (!res.ok) throw new Error("Jamendo error");
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const out: Track[] = [];
    for (const r of json.results ?? []) {
      if (typeof r.audio !== "string" || !r.audio) continue;
      const name   = String(r.name ?? "");
      const artist = String(r.artist_name ?? "");
      if (TALK_RE.test(name) || TALK_RE.test(artist)) continue;
      out.push({
        id: String(r.id ?? Math.random()),
        name,
        artist,
        audio: r.audio,
        image: String(r.image ?? ""),
        duration: Number(r.duration ?? 0),
        source: "jamendo",
      });
    }
    return out.length ? out : fetchArchiveTracks(tags, "archive", limit);
  } catch {
    return fetchArchiveTracks(tags, "archive", limit);
  }
}

async function fetchTracks(source: SourceId, tags: string[]): Promise<Track[]> {
  // In Electron, route through main process to avoid CORS on file://
  const api = getElectron();
  if (api?.musicFetch) {
    try {
      const tracks = await api.musicFetch(source, tags, 12);
      if (Array.isArray(tracks) && tracks.length) return tracks;
    } catch { /* fall through to browser fetch */ }
  }
  // Browser fallback (works in dev / web)
  if (source === "mixcloud")  return fetchMixcloudTracks(tags);
  if (source === "audius")    return fetchAudiusTracks(tags);
  if (source === "ccmixter")  return [];  // ccMixter is main-process only (expired TLS / CORS)
  if (source === "jamendo")   return fetchJamendoTracks(tags);
  if (source === "netlabels") return fetchArchiveTracks(tags, "netlabels");
  if (source === "russian")   return fetchArchiveTracks(tags, "russian");
  return fetchArchiveTracks(tags, "archive");
}

// ─────────────────────────────────────────────
// Mixcloud widget
// ─────────────────────────────────────────────

type MixcloudWidget = {
  ready: Promise<void>;
  events: { ended: { on: (cb: () => void) => void; off: (cb: () => void) => void } };
};
declare global {
  interface Window { Mixcloud?: { PlayerWidget: (i: HTMLIFrameElement) => MixcloudWidget } }
}

let mcScriptPromise: Promise<void> | null = null;
function loadMixcloudScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Mixcloud) return Promise.resolve();
  if (mcScriptPromise) return mcScriptPromise;
  mcScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://widget.mixcloud.com/media/js/widgetApi.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Mixcloud widget API failed"));
    document.head.appendChild(s);
  });
  return mcScriptPromise;
}

function MixcloudPlayer({ mixcloudKey, onEnded }: { mixcloudKey: string; onEnded: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);

  useEffect(() => {
    let cancelled = false;
    let widget: MixcloudWidget | null = null;
    const cb = () => { if (!cancelled) onEndedRef.current(); };
    void loadMixcloudScript().then(() => {
      if (cancelled) return;
      const iframe = iframeRef.current;
      if (!iframe || !window.Mixcloud) return;
      widget = window.Mixcloud.PlayerWidget(iframe);
      widget.ready.then(() => { if (!cancelled && widget) widget.events.ended.on(cb); });
    });
    return () => {
      cancelled = true;
      try { widget?.events.ended.off(cb); } catch { /**/ }
    };
  }, [mixcloudKey]);

  return (
    <iframe
      ref={iframeRef}
      key={mixcloudKey}
      title="Mixcloud"
      width="100%"
      height="120"
      frameBorder="0"
      allow="autoplay"
      src={`https://www.mixcloud.com/widget/iframe/?hide_cover=1&autoplay=1&feed=${encodeURIComponent(mixcloudKey)}`}
      className="w-full rounded-md"
    />
  );
}

// ─────────────────────────────────────────────
// Window chrome
// ─────────────────────────────────────────────

function WindowChrome() {
  const [api, setApi] = useState<ElectronAPI | null>(null);
  const [overStatus, setOverStatus] = useState("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const el = getElectron();
    setApi(el);
    const show = (on: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      setOverStatus(on ? "over on" : "over off");
      timer.current = window.setTimeout(() => setOverStatus(""), 2600);
    };
    const cleanup = el?.onAlwaysOnTopChanged?.(show);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault(); e.stopPropagation();
        el?.toggleAlwaysOnTop?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { cleanup?.(); window.removeEventListener("keydown", onKey, true); if (timer.current) clearTimeout(timer.current); };
  }, []);

  if (!api) return null;

  const btn = "grid h-6 w-6 place-items-center rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition backdrop-blur cursor-pointer";

  return (
    <>
      {overStatus && (
        <div className="pointer-events-none fixed top-5 right-28 z-50 font-pixel text-[10px] uppercase tracking-widest text-white/45">
          {overStatus}
        </div>
      )}
      <div
        data-window-controls
        className="fixed top-2 right-2 z-50 flex items-center gap-1.5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className={btn} onClick={() => api.minimize()} title="Свернуть">
          <span className="block h-px w-2.5 bg-current" />
        </button>
        <button className={btn} onClick={() => api.hideToTray()} title="В трей">
          <ArrowDownToLine className="h-3 w-3" />
        </button>
        <button className={btn} onClick={() => api.close()} title="Закрыть">
          <X className="h-3 w-3" />
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// Resize zones (invisible edge handles)
// ─────────────────────────────────────────────

function EdgeResizeZones() {
  const [api, setApi] = useState<ElectronAPI | null>(null);
  useEffect(() => setApi(getElectron()), []);
  if (!api) return null;

  const startResize = (edge: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    api.dragEnd();
    api.resizeStart(edge);
    const up = () => { api.resizeEnd(); window.removeEventListener("mouseup", up, true); window.removeEventListener("blur", up); };
    window.addEventListener("mouseup", up, true);
    window.addEventListener("blur", up);
  };

  const base: React.CSSProperties = { position: "fixed", zIndex: 40, opacity: 0 };
  const E = 12, C = 26, R = 180;

  return (
    <>
      <div style={{ ...base, left:0, top:C, bottom:C, width:E, cursor:"ew-resize" }} onMouseDown={startResize("w")} onContextMenu={(e)=>e.preventDefault()} />
      <div style={{ ...base, right:0, top:44, bottom:C, width:E, cursor:"ew-resize" }} onMouseDown={startResize("e")} onContextMenu={(e)=>e.preventDefault()} />
      <div style={{ ...base, top:0, left:C, right:R, height:E, cursor:"ns-resize" }} onMouseDown={startResize("n")} onContextMenu={(e)=>e.preventDefault()} />
      <div style={{ ...base, bottom:0, left:C, right:C, height:E, cursor:"ns-resize" }} onMouseDown={startResize("s")} onContextMenu={(e)=>e.preventDefault()} />
      <div style={{ ...base, left:0, top:0, width:C, height:C, cursor:"nwse-resize" }} onMouseDown={startResize("nw")} onContextMenu={(e)=>e.preventDefault()} />
      <div style={{ ...base, right:R, top:0, width:C, height:C, cursor:"nesw-resize" }} onMouseDown={startResize("ne")} onContextMenu={(e)=>e.preventDefault()} />
      <div style={{ ...base, left:0, bottom:0, width:C, height:C, cursor:"nesw-resize" }} onMouseDown={startResize("sw")} onContextMenu={(e)=>e.preventDefault()} />
      <div style={{ ...base, right:0, bottom:0, width:C, height:C, cursor:"nwse-resize" }} onMouseDown={startResize("se")} onContextMenu={(e)=>e.preventDefault()} />
    </>
  );
}

// ─────────────────────────────────────────────
// Right-click drag
// ─────────────────────────────────────────────

function useRightClickDrag() {
  useEffect(() => {
    const api = getElectron();
    if (!api) return;
    const endDrag = () => api.dragEnd();
    const down = (e: MouseEvent) => {
      if (e.button !== 2) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-window-controls], input, textarea, select, iframe, button")) return;
      e.preventDefault(); e.stopPropagation();
      api.resizeEnd(); api.dragStart();
    };
    const up = (e: MouseEvent) => { if (e.button === 2) endDrag(); };
    const ctx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("mousedown", down, true);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("blur", endDrag);
    window.addEventListener("mouseleave", endDrag);
    window.addEventListener("contextmenu", ctx, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("blur", endDrag);
      window.removeEventListener("mouseleave", endDrag);
      window.removeEventListener("contextmenu", ctx, true);
    };
  }, []);
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────

const MAX_ERRORS = 5;

export default function App() {
  // ── Persistent state (read synchronously on first render → no flash) ──
  const [hydrated, setHydrated]   = useState(false);
  const [source, setSource]       = useState<SourceId>(() => {
    try {
      const s = localStorage.getItem("op:source") as SourceId | null;
      if (s && ACTIVE_SOURCES.some((x) => x.id === s)) return s;
    } catch { /* ignore */ }
    return "jamendo";
  });
  const [volume, setVolume]       = useState(() => {
    try { const v = Number(localStorage.getItem("op:vol")); if (isFinite(v) && v >= 0 && v <= 1) return v; } catch { /* */ }
    return 0.8;
  });
  const [bgOpacity, setBgOpacity] = useState(() => {
    try { const o = Number(localStorage.getItem("op:bg")); if (isFinite(o) && o >= 0.1 && o <= 1) return o; } catch { /* */ }
    return 1;
  });

  // ── Player state ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [started,  setStarted]  = useState(false);
  const [track,    setTrack]    = useState<Track | null>(null);
  const [playing,  setPlaying]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volVisible, setVolVisible] = useState(false);

  const audioRef        = useRef<HTMLAudioElement | null>(null);
  const poolRef         = useRef<Track[]>([]);
  const playedRef       = useRef<Set<string>>(new Set());
  const prefetchingRef  = useRef(false);
  const errorsRef       = useRef(0);
  const volTimerRef     = useRef<number | null>(null);

  useRightClickDrag();

  // ── Hydrate from localStorage ──
  useEffect(() => {
    const s = localStorage.getItem("op:source") as SourceId | null;
    if (s && ACTIVE_SOURCES.some((x) => x.id === s)) setSource(s);
    const v = Number(localStorage.getItem("op:vol"));
    if (isFinite(v) && v >= 0 && v <= 1) setVolume(v);
    const o = Number(localStorage.getItem("op:bg"));
    if (isFinite(o) && o > 0) setBgOpacity(Math.max(0.1, Math.min(1, o)));
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) localStorage.setItem("op:source", source); }, [source, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem("op:vol", String(volume)); if (audioRef.current) audioRef.current.volume = volume; }, [volume, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem("op:bg", String(bgOpacity)); }, [bgOpacity, hydrated]);

  // Reset pool on source/genre change
  useEffect(() => {
    setSelected(new Set());
    poolRef.current = [];
  }, [source]);

  // ── Volume HUD ──
  const bumpVol = useCallback((d: number) => {
    setVolume((v) => Math.min(1, Math.max(0, Math.round((v + d) * 100) / 100)));
    setVolVisible(true);
    if (volTimerRef.current) clearTimeout(volTimerRef.current);
    volTimerRef.current = window.setTimeout(() => setVolVisible(false), 900);
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " " || e.code === "Space") {
        // Space toggles play/pause (only meaningful once a track is playing).
        if (!started || !track) return;
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setBgOpacity((o) => Math.min(1, Math.round((o + 0.1) * 10) / 10));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setBgOpacity((o) => Math.max(0.1, Math.round((o - 0.1) * 10) / 10));
      } else if (e.key === "+" || e.key === "=" || (e.key === "ArrowRight" && e.shiftKey)) {
        e.preventDefault(); bumpVol(0.05);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault(); bumpVol(-0.05);
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.shiftKey) {
        const a = audioRef.current;
        if (!a || !isFinite(a.duration) || a.duration <= 0) return;
        e.preventDefault();
        const next = Math.max(0, Math.min(a.duration, a.currentTime + (e.key === "ArrowRight" ? 5 : -5)));
        a.currentTime = next; setProgress(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bumpVol, started, track]);

  // ── Wheel = volume ──
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [data-scroll]")) return;
      e.preventDefault(); bumpVol(e.deltaY < 0 ? 0.05 : -0.05);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [bumpVol]);

  // ── Fetch pool ──
  // fast=true → return as soon as the first batch yields any track (start playing
  // ASAP). fast=false → keep going until TARGET tracks are pooled (background fill).
  const refillPool = useCallback(async (fast = false): Promise<Track[]> => {
    const ids = Array.from(selected);
    if (!ids.length) return [];
    const TARGET = 6;
    const seen = new Set<string>();
    const out: Track[] = [];

    type Job = { tags: string[] };
    const jobs: Job[] = [];
    const fbLists = ids.map(fallbacksFor);
    const maxD = Math.max(...fbLists.map((f) => f.length));
    for (let d = 0; d < maxD; d++) {
      ids.forEach((_, i) => { const g = fbLists[i][d]; if (g) jobs.push({ tags: g }); });
    }

    const raw: Track[] = [];          // everything fetched (pre play-history filter)
    const rawSeen = new Set<string>();
    const add = (tracks: Track[]) => {
      for (const t of tracks) {
        if (TALK_RE.test(t.name) || TALK_RE.test(t.artist)) continue;
        if (!rawSeen.has(t.id)) { rawSeen.add(t.id); raw.push(t); }
        if (out.length >= TARGET * 2) continue;
        if (seen.has(t.id) || playedRef.current.has(t.id)) continue;
        seen.add(t.id); out.push(t);
      }
    };

    for (let i = 0; i < jobs.length; i += 2) {
      if (out.length >= TARGET) break;
      const results = await Promise.all(
        jobs.slice(i, i + 2).map((j) => withTimeout(fetchTracks(source, j.tags), 20000, [] as Track[])),
      );
      results.forEach(add);
      if (fast && out.length) break;   // got something — play it now, fill the rest later
    }
    // Catalog exhausted (everything already played) → loop instead of erroring.
    if (!out.length && raw.length) {
      playedRef.current = new Set();
      return shuffle(raw);
    }
    return shuffle(out);
  }, [selected, source]);

  const ensurePool = useCallback(async () => {
    if (poolRef.current.length >= 3 || prefetchingRef.current) return;
    prefetchingRef.current = true;
    try { const more = await refillPool(); poolRef.current = [...poolRef.current, ...more]; }
    finally { prefetchingRef.current = false; }
  }, [refillPool]);

  // Prefetch when genres change
  useEffect(() => {
    poolRef.current = []; errorsRef.current = 0; setError(null);
    if (!selected.size) return;
    const t = window.setTimeout(() => {
      if (prefetchingRef.current) return;
      prefetchingRef.current = true;
      refillPool().then((tracks) => { poolRef.current = tracks; }).finally(() => { prefetchingRef.current = false; });
    }, 10);
    return () => clearTimeout(t);
  }, [selected, source, refillPool]);

  // ── Play next ──
  const playNext = useCallback(async () => {
    setError(null);
    if (!poolRef.current.length) {
      setLoading(true);
      const r = await refillPool(true);   // fast: return on first track for instant start
      poolRef.current = r;
      setLoading(false);
      if (!r.length) { setError("Треков не найдено. Попробуй другие жанры."); setPlaying(false); return; }
    }
    const next = poolRef.current.shift()!;
    playedRef.current.add(next.id);
    setProgress(0); setDuration(0);   // reset bar so it doesn't flash the previous track's time
    setTrack(next);
    setPlaying(true);
    void ensurePool();
  }, [refillPool, ensurePool]);

  const startMix = useCallback(async () => {
    if (!selected.size) return;
    playedRef.current = new Set();
    errorsRef.current = 0;
    setStarted(true);
    await playNext();
  }, [selected.size, playNext]);

  // ── Audio play/pause sync ──
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume;
    if (!playing) { a.pause(); return; }
    let cancelled = false;
    const p = a.play();
    if (p && typeof p.catch === "function") {
      p.catch((err: DOMException) => {
        // src changed mid-play (AbortError) or autoplay race — don't kill playback,
        // a fresh effect run for the new src will start it.
        if (cancelled || err?.name === "AbortError" || err?.name === "NotAllowedError") return;
        setPlaying(false);
      });
    }
    return () => { cancelled = true; };
  }, [playing, track?.id, volume]);

  // ── Stall watchdog: archive.org mp3s sometimes never start (huge/slow files).
  //    If playback hasn't begun within 8s, skip to the next (faster) track. ──
  useEffect(() => {
    if (!track || !playing) return;
    const id = window.setTimeout(() => {
      const a = audioRef.current;
      if (!a || !playing) return;
      if (a.currentTime < 0.5 && a.readyState < 3) {
        errorsRef.current += 1;
        if (errorsRef.current >= MAX_ERRORS) {
          setError("Источник медленно отдаёт треки. Попробуй другие жанры.");
          setPlaying(false);
          return;
        }
        void playNext();
      }
    }, 8000);
    return () => clearTimeout(id);
  }, [track?.id, playing, playNext]);

  // ── Seek (click progress bar) ──
  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration || !isFinite(duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration;
    setProgress(a.currentTime);
  };

  // ── Touch swipe seek (web): drag horizontally in empty area to scrub ──
  const swipe = useRef<{ x: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("button, [data-seekbar], [data-window-controls], a, input")) return;
    const a = audioRef.current;
    if (!a || !duration || !isFinite(duration)) return;
    swipe.current = { x: e.touches[0].clientX, t: a.currentTime };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const a = audioRef.current;
    if (!swipe.current || !a || !duration) return;
    const dx = e.touches[0].clientX - swipe.current.x;
    // Full screen width drag ≈ whole track.
    const next = Math.min(duration, Math.max(0, swipe.current.t + (dx / window.innerWidth) * duration));
    a.currentTime = next;
    setProgress(next);
  };
  const onTouchEnd = () => { swipe.current = null; };

  // ── Source cycling ──
  const cycleSource = () => {
    const idx = ACTIVE_SOURCES.findIndex((s) => s.id === source);
    setProgress(0); setDuration(0);
    setSource(ACTIVE_SOURCES[(idx + 1) % ACTIVE_SOURCES.length].id);
  };

  const genres = GENRES[source];
  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;
  const hasSelection = selected.size > 0;
  const isMixcloud = track?.source === "mixcloud" && !!track.mixcloudKey;

  const bg = { backgroundColor: `rgba(0,0,0,${bgOpacity})` };

  const scanlines = (
    <>
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-screen"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent 0,transparent 2px,rgba(255,255,255,0.6) 2px,rgba(255,255,255,0.6) 3px)" }} />
      <div className="pointer-events-none absolute inset-0 animate-glitch-flicker bg-white/[0.015]" />
    </>
  );

  const volHUD = !isMixcloud && (
    <div className={`fixed left-1/2 -translate-x-1/2 top-3 z-40 flex items-center gap-2 font-pixel text-xs text-white/70 transition-opacity ${volVisible ? "opacity-100" : "opacity-0"}`}>
      <Volume2 className="h-3 w-3" />
      <div className="w-40 h-1 bg-white/15 rounded-full overflow-hidden">
        <div className="h-full bg-white/80" style={{ width: `${Math.round(volume * 100)}%` }} />
      </div>
      <span className="tabular-nums w-8 text-right">{Math.round(volume * 100)}%</span>
    </div>
  );

  // ════════ PLAYER VIEW ════════
  if (started && track) {
    return (
      <div
        className="relative flex flex-col items-center justify-center text-white px-6 overflow-hidden"
        style={{ ...bg, height: "100dvh", borderRadius: IS_ELECTRON ? "26px" : 0 }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <WindowChrome />
        <EdgeResizeZones />
        {scanlines}
        {volHUD}

        <div className="relative w-full max-w-md flex flex-col items-center">
          {/* Track info — fixed height so only this area changes; the bar,
              controls and "сменить жанры" below never shift. */}
          <div className="w-full px-2 flex flex-col items-center justify-center text-center" style={{ height: "7rem" }}>
            <div
              className="font-pixel text-xl md:text-2xl leading-tight tracking-widest uppercase text-white/85 glitch break-words line-clamp-2"
              data-text={track.name}
            >
              {track.name}
            </div>
            <div className="mt-3 font-pixel text-xs md:text-sm text-white/55 tracking-widest uppercase glitch" data-text={track.artist}>
              {track.artist}
            </div>
          </div>

          {/* Progress bar */}
          {!isMixcloud && (
            <div className="mt-12 w-full">
              <div onClick={onSeek} data-seekbar className="relative h-6 w-full flex items-center cursor-pointer">
                <div className="h-px w-full bg-white/20" />
                <div className="absolute h-[3px] w-[3px] bg-white"
                  style={{ left:`${progressPct}%`, top:"50%", transform:"translate(-50%,-50%)", boxShadow:"0 0 6px rgba(255,255,255,.9),0 0 12px rgba(255,255,255,.4)" }} />
              </div>
              <div className="mt-2 flex justify-between font-pixel text-[11px] text-white/50 tabular-nums">
                <span>{formatTime(progress)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          {/* Mixcloud widget */}
          {isMixcloud && (
            <div className="mt-8 w-full">
              <MixcloudPlayer mixcloudKey={track.mixcloudKey!} onEnded={playNext} />
            </div>
          )}

          {/* Controls */}
          <div className="mt-10 flex items-center justify-center gap-8">
            {!isMixcloud && (
              <button
                onClick={() => setPlaying((p) => !p)}
                disabled={loading}
                className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 pl-0.5" />}
              </button>
            )}
            <button
              onClick={playNext}
              disabled={loading}
              className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition disabled:opacity-60"
            >
              <SkipForward className="h-5 w-5" />
            </button>
          </div>

          {error && <div className="mt-6 font-pixel text-xs text-white/50 text-center">{error}</div>}

          <button
            onClick={() => { setStarted(false); setPlaying(false); setTrack(null); }}
            className="mt-10 font-pixel text-[11px] text-white/40 hover:text-white/70 transition tracking-widest"
          >
            СМЕНИТЬ ЖАНРЫ
          </button>
        </div>

        {!isMixcloud && (
          <audio
            key={track.id}
            ref={audioRef}
            src={track.audio}
            preload="auto"
            autoPlay
            onTimeUpdate={(e) => setProgress((e.target as HTMLAudioElement).currentTime)}
            onLoadedMetadata={(e) => {
              const el = e.target as HTMLAudioElement;
              el.volume = volume;
              setDuration(el.duration);
              errorsRef.current = 0;
              setError(null);
            }}
            onCanPlay={(e) => {
              // Loaded & seekable but silent (play() was rejected/raced) — resync.
              const el = e.target as HTMLAudioElement;
              if (playing && el.paused) el.play().catch(() => {});
            }}
            onEnded={playNext}
            onError={() => {
              errorsRef.current += 1;
              if (errorsRef.current >= MAX_ERRORS) {
                setError("Не удалось воспроизвести треки. Попробуй другие жанры.");
                setPlaying(false);
                return;
              }
              void playNext();
            }}
          />
        )}
      </div>
    );
  }

  // ════════ GENRE PICKER ════════
  return (
    <div className="relative text-white overflow-hidden" style={{ ...bg, height: "100dvh", borderRadius: IS_ELECTRON ? "26px" : 0 }}>
      <WindowChrome />
      <EdgeResizeZones />
      {scanlines}

      {/* Volume HUD */}
      <div className={`fixed left-1/2 -translate-x-1/2 top-3 z-40 flex items-center gap-2 font-pixel text-xs text-white/70 transition-opacity ${volVisible ? "opacity-100" : "opacity-0"}`}>
        <Volume2 className="h-3 w-3" />
        <div className="w-40 h-1 bg-white/15 rounded-full overflow-hidden">
          <div className="h-full bg-white/80" style={{ width: `${Math.round(volume * 100)}%` }} />
        </div>
        <span className="tabular-nums w-8 text-right">{Math.round(volume * 100)}%</span>
      </div>

      {/* ── Content block — centered with fixed gaps; whole block scrolls if
              the window is too small (never clips, never stretches to edges). ── */}
      <div
        className="absolute inset-0 overflow-y-auto px-6"
        data-scroll
        style={{
          paddingTop: "calc(0.5rem + env(safe-area-inset-top))",
          paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="min-h-full flex flex-col items-center justify-center w-full max-w-md mx-auto">

          {/* Title */}
          <div className="flex flex-col items-center">
            <div
              className="font-pixel text-3xl tracking-widest uppercase glitch glitch-fast"
              data-text="OUTSPACE"
            >
              <span className="text-white">OUT</span><span className="text-white/50">SPACE</span>
            </div>
          </div>

          {/* Source name — fixed gap below title */}
          <div className="flex items-center justify-center mt-3">
            <button
              onClick={cycleSource}
              onMouseDown={(e) => e.preventDefault()}
              className="font-pixel text-xl tracking-[0.3em] text-white/50 hover:text-white/80 transition focus:outline-none"
              style={{ whiteSpace: "nowrap" }}
            >
              {(ACTIVE_SOURCES.find((s) => s.id === source) ?? SOURCES.find((s) => s.id === source))!.label}
            </button>
          </div>

          {/* Genres — FIXED-height zone so title/source/play stay put across
              sources; only this area's contents change (centered, shrinks). */}
          <div className="w-full mt-8 flex items-center justify-center overflow-hidden" style={{ height: "200px" }}>
            <div className="flex flex-wrap gap-1.5 justify-center w-full">
              {genres.map((g) => {
                const active = selected.has(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        active ? next.delete(g.id) : next.add(g.id);
                        return next;
                      })
                    }
                    className={`font-pixel rounded-full px-3 py-1 text-sm tracking-wider transition-all ${
                      active
                        ? "bg-white/40 text-black/80 hover:bg-white/50"
                        : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Play — fixed gap below genres */}
          <div className="flex flex-col items-center mt-8">
            <button
              onClick={startMix}
              disabled={!hasSelection || loading}
              className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 pl-0.5" />}
            </button>
          </div>

          {error && <div className="font-pixel text-xs text-white/50 text-center mt-1">{error}</div>}
        </div>
      </div>
    </div>
  );
}
