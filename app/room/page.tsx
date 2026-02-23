"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Message = { id: string; display_name: string; body: string; created_at: string; };
type Track   = { title: string; start: number; };
type Phase   = "waiting" | "entering" | "live" | "finished";

// ── Constants ─────────────────────────────────────────────────────────────────
const TRACKS: Track[] = [
  { title: "Be Above It",                                                         start: 0    },
  { title: "Endors Toi",                                                          start: 202  },
  { title: "Apocalypse Dreams",                                                   start: 388  },
  { title: "Mind Mischief",                                                       start: 745  },
  { title: "Music to Walk Home By",                                               start: 1017 },
  { title: "Why Won't They Talk to Me?",                                          start: 1330 },
  { title: "Feels Like We Only Go Backwards",                                     start: 1616 },
  { title: "Keep on Lying",                                                       start: 1809 },
  { title: "Elephant",                                                            start: 2163 },
  { title: "She Just Won't Believe Me",                                           start: 2374 },
  { title: "Nothing That Has Happened So Far Has Been Anything We Could Control", start: 2431 },
  { title: "Sun's Coming Up",                                                     start: 2791 },
];
const ALBUM_DURATION = 3112;
const ALBUM = {
  title:  "Lonerism",
  artist: "Tame Impala",
  year:   "2012",
  label:  "Modular Recordings",
  genre:  "Psychedelic Rock",
};
const SHOWTIME_HOUR  = 20;
const PRE_SHOW_SECS  = 30;
const ROWS_PER_COL   = 3; // tracks per column in the wall listing

// Tonearm angles
const ARM_REST  = -38;
const ARM_START =  28;
const ARM_END   =  48;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCurrentTrack(s: number) {
  let cur = TRACKS[0], idx = 0;
  for (let i = 0; i < TRACKS.length; i++) {
    if (s >= TRACKS[i].start) { cur = TRACKS[i]; idx = i; } else break;
  }
  return { track: cur, index: idx };
}
function fmtTs(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RoomPage() {
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const msgEndRef      = useRef<HTMLDivElement | null>(null);
  const crackleRef     = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode } | null>(null);
  const slidePlayedRef = useRef(false);
  const prevIsLiveRef  = useRef(false);
  const needleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isAdmin] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("admin") === "1") { localStorage.setItem("ac_admin", "true"); return true; }
    } catch {}
    return localStorage.getItem("ac_admin") === "true";
  });
  const [phase, setPhase] = useState<Phase>(() => {
    if (typeof window === "undefined") return "waiting";
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("admin") === "1" || localStorage.getItem("ac_admin") === "true") return "live";
    } catch {}
    const n = new Date(); const st = new Date(); st.setHours(SHOWTIME_HOUR, 0, 0, 0);
    return n >= st ? "entering" : "waiting";
  });
  const [preCountdown, setPreCountdown] = useState(PRE_SHOW_SECS);
  const [now,          setNow]          = useState(() => new Date());

  // Playback
  const [startedAt,     setStartedAt]    = useState<string | null>(null);
  const [scheduledFor,  setScheduledFor] = useState<string | null>(null);
  const [scheduleDelay, setScheduleDelay]= useState(2);
  const [isLive,        setIsLive]       = useState(false);
  const [audioUnlocked, setAudioUnlocked]= useState(false);
  const [elapsed,       setElapsed]      = useState(0);
  const [albumFinished, setAlbumFinished]= useState(false);

  // UI
  const [volume,       setVolume]      = useState(0.8);
  const [showVolume,   setShowVolume]  = useState(false);
  const [listenerCount]                = useState(2);
  const [crackleOn,    setCrackleOn]  = useState(false);
  const [needleDrop,   setNeedleDrop] = useState(false);
  const [vinylSlideIn, setVinylSlideIn]= useState(false);
  const [albumCoverUrl,setAlbumCoverUrl]= useState("");

  // Tonearm
  const [tonearmAngle,      setTonearmAngle]      = useState(ARM_REST);
  const [tonearmTransition, setTonearmTransition] = useState("transform 0.8s ease");
  const [isPaused,          setIsPaused]          = useState(false);
  const pausedAtRef = useRef<number>(0);

  // Accent color
  const [rgb, setRgb] = useState<[number, number, number]>([72, 110, 130]);
  const [cr, cg, cb2] = rgb;

  // Chat
  const [chatOpen,     setChatOpen]    = useState(true);
  const [chatExpanded, setChatExpanded]= useState(false);
  const [messages,     setMessages]    = useState<Message[]>([]);
  const [chatInput,    setChatInput]   = useState("");
  const [displayName,  setDisplayName] = useState("");
  const [nameInput,    setNameInput]   = useState("");
  const [nameSet,      setNameSet]     = useState(false);

  // Accent helpers
  const accent     = `rgb(${cr},${cg},${cb2})`;
  const accentRgba = (a: number) => `rgba(${cr},${cg},${cb2},${a})`;
  const lighter    = `rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+30,255)},0.9)`;

  // ── Fetch album art from iTunes (no API key, no CORS issues) ─────────────
  useEffect(() => {
    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(ALBUM.artist + " " + ALBUM.title)}&entity=album&limit=5`)
      .then(r => r.json())
      .then(data => {
        const hit = data.results?.find((r: any) => r.collectionType === "Album") ?? data.results?.[0];
        if (hit?.artworkUrl100) {
          setAlbumCoverUrl(hit.artworkUrl100.replace("100x100bb", "600x600bb"));
        }
      })
      .catch(() => {});
  }, []);

  // ── Extract dominant color from cover ────────────────────────────────────
  useEffect(() => {
    if (!albumCoverUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = 50; c.height = 50;
        const ctx = c.getContext("2d"); if (!ctx) return;
        ctx.drawImage(img, 0, 0, 50, 50);
        const d = ctx.getImageData(0, 0, 50, 50).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
        setRgb([Math.floor(r/n), Math.floor(g/n), Math.floor(b/n)]);
      } catch {}
    };
    img.src = albumCoverUrl;
  }, [albumCoverUrl]);

  // ── Clock tick ────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Phase transition ──────────────────────────────────────────────────────
  useEffect(() => {
    // Admin bypasses waiting only when nothing is scheduled
    if (isAdmin && phase === "waiting" && !scheduledFor) { setPhase("live"); return; }

    const target = scheduledFor
      ? new Date(scheduledFor)
      : (() => { const st = new Date(); st.setHours(SHOWTIME_HOUR, 0, 0, 0); return st; })();

    const msToStart = target.getTime() - now.getTime();
    if (phase === "waiting" && msToStart <= PRE_SHOW_SECS * 1000) {
      setPhase("entering");
    }
  }, [now, phase, isAdmin, scheduledFor]);

  // ── Pre-show ceremony countdown ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== "entering") return;

    if (scheduledFor) {
      // Count down to exact scheduled timestamp
      const target = new Date(scheduledFor).getTime();
      const tick = () => {
        const remaining = Math.max(0, (target - Date.now()) / 1000);
        setPreCountdown(Math.ceil(remaining));
        if (remaining <= 0) setPhase("live");
      };
      tick();
      const iv = setInterval(tick, 500);
      return () => clearInterval(iv);
    } else {
      // Default fixed 30s countdown
      setPreCountdown(PRE_SHOW_SECS);
      const iv = setInterval(() => {
        setPreCountdown(p => {
          if (p <= 1) { clearInterval(iv); setPhase("live"); return 0; }
          return p - 1;
        });
      }, 1000);
      return () => clearInterval(iv);
    }
  }, [phase, scheduledFor]);

  // ── Admin auto-start: fires every second, triggers show when time arrives ─
  useEffect(() => {
    if (!isAdmin || !scheduledFor || isLive) return;
    if (Date.now() < new Date(scheduledFor).getTime()) return;

    // Time's up — push is_live:true and start audio
    const sp = Math.max(0, (Date.now() - new Date(scheduledFor).getTime()) / 1000);
    setStartedAt(scheduledFor);
    setIsLive(true);
    setAlbumFinished(false);
    slidePlayedRef.current = false;
    if (audioRef.current) {
      audioRef.current.currentTime = sp;
      audioRef.current.play().catch(e => console.error("[AlbumClub] scheduled play:", e));
    }
    supabase.from("room_state")
      .upsert({ room_id: "main", is_live: true, started_at: scheduledFor })
      .then(({ error }) => { if (error) console.error("[AlbumClub] auto-start:", error); });
    setScheduledFor(null);
  }, [now, scheduledFor, isAdmin, isLive]);

  // ── Jump to live phase when isLive fires mid-ceremony (realtime push) ────
  useEffect(() => {
    if (isLive && (phase === "waiting" || phase === "entering")) setPhase("live");
  }, [isLive, phase]);

  // ── Crackle ───────────────────────────────────────────────────────────────
  const startCrackle = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
      const d   = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++)
        d[i] = (Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.5 : 0) + (Math.random() * 2 - 1) * 0.008;
      const src  = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = ctx.createGain(); gain.gain.value = 0.13;
      src.connect(gain); gain.connect(ctx.destination); src.start();
      crackleRef.current = { ctx, source: src };
    } catch {}
  }, []);
  const stopCrackle = useCallback(() => {
    if (crackleRef.current) {
      try { crackleRef.current.source.stop(); crackleRef.current.ctx.close(); } catch {}
      crackleRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (crackleOn && isLive && !albumFinished) startCrackle();
    else stopCrackle();
    return () => stopCrackle();
  }, [crackleOn, isLive, albumFinished, startCrackle, stopCrackle]);

  // ── Display name ──────────────────────────────────────────────────────────
  useEffect(() => {
    const s = localStorage.getItem("ac_display_name");
    if (s) { setDisplayName(s); setNameSet(true); }
  }, []);

  // ── Audio unlock on any click ─────────────────────────────────────────────
  useEffect(() => {
    const unlock = async () => {
      if (!audioRef.current) return;
      try {
        await audioRef.current.play();
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setAudioUnlocked(true);
      } catch {}
    };
    window.addEventListener("click", unlock, { once: true });
    return () => window.removeEventListener("click", unlock);
  }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  // ── Needle drop + vinyl slide ─────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) return;
    setNeedleDrop(true);
    const t = setTimeout(() => setNeedleDrop(false), 700);
    if (!slidePlayedRef.current) { setVinylSlideIn(true); slidePlayedRef.current = true; }
    return () => clearTimeout(t);
  }, [isLive]);

  // ── Tonearm animation ─────────────────────────────────────────────────────
  useEffect(() => {
    const wasLive = prevIsLiveRef.current;
    prevIsLiveRef.current = isLive;
    if (isLive && !wasLive) {
      if (needleTimerRef.current) clearTimeout(needleTimerRef.current);
      setTonearmTransition("transform 1.5s cubic-bezier(0.4, 0, 0.2, 1)");
      setTonearmAngle(ARM_START);
      needleTimerRef.current = setTimeout(() => { needleTimerRef.current = null; }, 1600);
    } else if (!isLive && wasLive) {
      if (needleTimerRef.current) { clearTimeout(needleTimerRef.current); needleTimerRef.current = null; }
      setTonearmTransition("transform 1.2s ease-in");
      setTonearmAngle(ARM_REST);
    } else if (isLive && !needleTimerRef.current) {
      const target = ARM_START + (elapsed / ALBUM_DURATION) * (ARM_END - ARM_START);
      setTonearmTransition("transform 4s linear");
      setTonearmAngle(target);
    }
  }, [isLive, elapsed]);

  // ── Supabase realtime ─────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("messages").select("*").eq("room_id", "main")
      .order("created_at", { ascending: true }).limit(100)
      .then(({ data }) => { if (data) setMessages(data as Message[]); });

    supabase.from("room_state").select("*").eq("room_id", "main").single()
      .then(({ data }) => {
        if (!data) return;
        if (data.is_live && data.started_at) {
          const sp = (Date.now() - new Date(data.started_at).getTime()) / 1000;
          if (sp >= ALBUM_DURATION) { setAlbumFinished(true); setElapsed(ALBUM_DURATION); }
          else if (sp >= 0) { setIsLive(true); setStartedAt(data.started_at); }
        } else if (!data.is_live && data.started_at) {
          const fut = new Date(data.started_at).getTime();
          if (fut > Date.now()) setScheduledFor(data.started_at);
        }
      });

    const roomCh = supabase.channel("room-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_state" }, (p: any) => {
        const row = p.new as { is_live?: boolean; started_at?: string | null };
        if (row?.is_live === true && row?.started_at) {
          setScheduledFor(null);
          setStartedAt(row.started_at);
          const sp = (Date.now() - new Date(row.started_at).getTime()) / 1000;
          if (sp < ALBUM_DURATION) { setAlbumFinished(false); setIsLive(true); }
        } else if (row?.is_live === false) {
          setIsLive(false); setElapsed(0); setAlbumFinished(false);
          slidePlayedRef.current = false; setVinylSlideIn(false);
          if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
          if (row.started_at) {
            const fut = new Date(row.started_at).getTime();
            if (fut > Date.now()) { setScheduledFor(row.started_at); setStartedAt(null); }
            else { setStartedAt(null); setScheduledFor(null); }
          } else { setStartedAt(null); setScheduledFor(null); }
        }
      }).subscribe();

    const msgCh = supabase.channel("messages-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "room_id=eq.main" },
        (p: any) => setMessages(prev => [...prev, p.new as Message])).subscribe();

    return () => { supabase.removeChannel(roomCh); supabase.removeChannel(msgCh); };
  }, []);

  // ── Sync audio when startedAt or audioUnlocked changes ───────────────────
  useEffect(() => {
    if (!startedAt || !audioUnlocked || !audioRef.current) return;
    const sp = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000);
    if (sp >= ALBUM_DURATION) return;
    audioRef.current.currentTime = sp;
    audioRef.current.play().catch(e => console.error("[AlbumClub] sync play:", e));
  }, [startedAt, audioUnlocked]);

  // ── Elapsed ticker + album-end guard ─────────────────────────────────────
  useEffect(() => {
    if (!isLive || !startedAt) return;
    const tick = () => {
      const e = (Date.now() - new Date(startedAt).getTime()) / 1000;
      if (e >= ALBUM_DURATION) {
        setElapsed(ALBUM_DURATION); setAlbumFinished(true); setIsLive(false);
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = ALBUM_DURATION; }
        return;
      }
      setElapsed(Math.max(0, e));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isLive, startedAt]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const saveName = () => {
    const n = nameInput.trim(); if (!n) return;
    localStorage.setItem("ac_display_name", n); setDisplayName(n); setNameSet(true);
  };

  const scheduleShowtime = async (delayMin: number) => {
    // Unlock audio now — this is a user-gesture click
    if (audioRef.current) {
      try { await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {}
    }
    setAudioUnlocked(true);
    const started_at = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
    setScheduledFor(started_at);
    setAlbumFinished(false);
    slidePlayedRef.current = false;
    setPhase("waiting"); // admin goes through full waiting → entering → live experience
    const { error } = await supabase.from("room_state")
      .upsert({ room_id: "main", is_live: false, started_at });
    if (error) console.error("[AlbumClub] schedule upsert:", error);
  };

  const triggerShowtime = async () => {
    setAudioUnlocked(true);
    const started_at = new Date(Date.now() + 500).toISOString();
    slidePlayedRef.current = false;
    setAlbumFinished(false);
    setScheduledFor(null);
    setStartedAt(started_at);
    setIsLive(true);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.error("[AlbumClub] play failed:", e));
    }
    const { error } = await supabase.from("room_state")
      .upsert({ room_id: "main", is_live: true, started_at });
    if (error) console.error("[AlbumClub] room_state upsert:", error);
  };

  const stopShowtime = async () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setIsLive(false); setAlbumFinished(false); setElapsed(0); setStartedAt(null);
    setScheduledFor(null); setIsPaused(false); pausedAtRef.current = 0;
    slidePlayedRef.current = false; setVinylSlideIn(false);
    setPhase("live");
    const { error } = await supabase.from("room_state")
      .upsert({ room_id: "main", is_live: false, started_at: null });
    if (error) console.error("[AlbumClub] room_state stop:", error);
  };

  const pausePlayback = () => {
    pausedAtRef.current = elapsed;
    setIsPaused(true);
    if (audioRef.current) audioRef.current.pause();
  };

  const resumePlayback = () => {
    const newStartedAt = new Date(Date.now() - pausedAtRef.current * 1000).toISOString();
    setStartedAt(newStartedAt);
    setIsPaused(false);
    if (audioRef.current) {
      audioRef.current.currentTime = pausedAtRef.current;
      audioRef.current.play().catch(e => console.error("[AlbumClub] resume:", e));
    }
  };

  const sendMessage = async () => {
    const body = chatInput.trim(); if (!body || !displayName) return;
    setChatInput("");
    await supabase.from("messages").insert({ room_id: "main", display_name: displayName, body });
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const { index: tIdx } = getCurrentTrack(elapsed);

  // Column-major track layout: 3 tracks per column, columns left→right
  const numCols   = Math.ceil(TRACKS.length / ROWS_PER_COL);
  const wallCols  = Array.from({ length: numCols }, (_, col) =>
    TRACKS.slice(col * ROWS_PER_COL, (col + 1) * ROWS_PER_COL)
          .map((t, row) => ({ ...t, origIdx: col * ROWS_PER_COL + row }))
  );

  // ── Shared font CSS ───────────────────────────────────────────────────────
  const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400;1,700&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&display=swap');
.fp { font-family: 'Playfair Display', Georgia, serif; }
.fc { font-family: 'Cormorant Garamond', Georgia, serif; }`;

  // ══════════════════════════════════════════════════════════════════════════
  // WAITING SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === "waiting") {
    const target = scheduledFor
      ? new Date(scheduledFor)
      : (() => { const st = new Date(); st.setHours(SHOWTIME_HOUR, 0, 0, 0); if (new Date() > st) st.setDate(st.getDate() + 1); return st; })();
    const ms = Math.max(0, target.getTime() - now.getTime());
    const hh = Math.floor(ms / 3600000);
    const mm = Math.floor((ms % 3600000) / 60000);
    const ss = Math.floor((ms % 60000) / 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      <main className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[#060402]">
        <style>{FONTS}</style>
        <img src="/room-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "brightness(0.32)" }} />
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 50%,transparent 20%,rgba(0,0,0,0.85) 100%)" }} />
        <div className="relative z-10 text-center text-[#F5E6C8] px-6">
          <div className="fc text-xl text-white/50 mb-5 tracking-[0.45em] uppercase italic">
            {scheduledFor ? "Tonight's show begins in" : "The room opens in"}
          </div>
          <div className="fp font-black mb-8 tabular-nums leading-none"
            style={{ fontSize: "clamp(5rem,16vw,11rem)", color: accentRgba(0.9), textShadow: `0 0 90px ${accentRgba(0.45)}` }}>
            {pad(hh)}:{pad(mm)}:{pad(ss)}
          </div>
          <div className="fp text-4xl font-bold text-[#C47A2C] mb-3 tracking-wide">AlbumClub</div>
          {scheduledFor
            ? <div className="fc italic text-xl text-white/42">{ALBUM.title} — {ALBUM.artist}</div>
            : <div className="fc italic text-xl text-white/42">Tonight's showtime: 8:00 PM</div>}
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENTERING CEREMONY
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === "entering") {
    return (
      <main className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[#060402]">
        <style>{`
          ${FONTS}
          @keyframes coverDrop {
            from { transform: translateY(-90px) scale(0.82) rotate(-7deg); opacity: 0; }
            to   { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
          }
          .cover-drop { animation: coverDrop 1.5s cubic-bezier(0.22,1,0.36,1) both 0.15s; }
          @keyframes fadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
          .fade-up { animation: fadeUp 0.9s ease both; }
        `}</style>
        <img src="/room-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "brightness(0.52)" }} />
        <div className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 50% 45%,${accentRgba(0.12)} 0%,rgba(0,0,0,0.8) 100%)` }} />
        <div className="relative z-10 text-center text-[#F5E6C8] px-8" style={{ maxWidth: "480px" }}>
          {albumCoverUrl && (
            <div className="cover-drop mx-auto mb-8 rounded-2xl overflow-hidden"
              style={{ width: "190px", height: "190px", border: "1px solid rgba(255,255,255,0.14)", boxShadow: `0 35px 90px rgba(0,0,0,0.9), 0 0 70px ${accentRgba(0.3)}` }}>
              <img src={albumCoverUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="fade-up fp font-black text-5xl leading-none mb-2"
            style={{ animationDelay: "0.35s", textShadow: "0 4px 40px rgba(0,0,0,0.95)" }}>
            {ALBUM.title}
          </div>
          <div className="fade-up fp italic text-2xl mb-10"
            style={{ animationDelay: "0.5s", color: lighter }}>
            {ALBUM.artist}
          </div>
          <div className="fade-up relative mx-auto mb-7" style={{ width: "114px", height: "114px", animationDelay: "0.25s" }}>
            <svg className="absolute inset-0" width="114" height="114" viewBox="0 0 114 114">
              <circle cx="57" cy="57" r="50" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
              <circle cx="57" cy="57" r="50" fill="none" stroke={accent} strokeWidth="3"
                strokeDasharray={`${2 * Math.PI * 50}`}
                strokeDashoffset={`${2 * Math.PI * 50 * (preCountdown / PRE_SHOW_SECS)}`}
                strokeLinecap="round" transform="rotate(-90 57 57)"
                style={{ transition: "stroke-dashoffset 0.5s linear" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="fp font-black text-4xl text-white">{preCountdown}</span>
            </div>
          </div>
          <div className="fade-up fc italic text-xl text-white/52" style={{ animationDelay: "0.6s" }}>
            The needle drops in a moment…
          </div>
          <div className="fade-up fc text-base tracking-[0.5em] uppercase text-white/30 mt-2" style={{ animationDelay: "0.75s" }}>
            {listenerCount} people settling in
          </div>
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINISHED SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (albumFinished) {
    return (
      <main className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[#060402]">
        <style>{`
          ${FONTS}
          @keyframes fadeIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
          .fade-in { animation: fadeIn 1.8s ease both; }
        `}</style>
        <img src="/room-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "brightness(0.28)" }} />
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 50%,transparent 18%,rgba(0,0,0,0.9) 100%)" }} />
        <div className="fade-in relative z-10 text-center text-[#F5E6C8] px-6">
          <div className="fc italic text-xl text-white/42 mb-5 tracking-[0.35em] uppercase">That's a wrap</div>
          <div className="fp font-black text-6xl mb-2" style={{ textShadow: "0 4px 40px rgba(0,0,0,0.95)" }}>{ALBUM.title}</div>
          <div className="fp italic text-2xl text-[#C47A2C] mb-8">{ALBUM.artist}</div>
          <div className="fc italic text-xl text-white/42">Thanks for listening together.</div>
          {isAdmin && (
            <button onClick={stopShowtime}
              className="mt-10 px-10 py-3 fc text-base tracking-[0.35em] uppercase text-white border border-white/22 bg-black/42 hover:bg-black/62 transition rounded-lg"
              style={{ fontSize: "1.1rem" }}>
              Reset Room
            </button>
          )}
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIVE ROOM
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060402] text-[#F5E6C8]">
      <style>{`
        ${FONTS}
        @keyframes vSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes vSheen {
          0%   { transform: rotate(0deg);   opacity: .22; }
          50%  {                            opacity: .06; }
          100% { transform: rotate(360deg); opacity: .22; }
        }
        .v-sheen {
          position: absolute; inset: 0; border-radius: 9999px;
          background: conic-gradient(from 0deg,
            rgba(255,255,255,.15), rgba(255,255,255,0) 35%,
            rgba(255,255,255,.07) 55%, rgba(255,255,255,0) 75%,
            rgba(255,255,255,.12));
          mix-blend-mode: screen; pointer-events: none;
        }
        .v-sheen.on { animation: vSheen 1.8s linear infinite; }
        @keyframes pulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }
        @keyframes nSpark {
          0%   { transform: scale(.4); opacity: 0; }
          25%  { transform: scale(1);  opacity: 1; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        .nspark { animation: nSpark 600ms ease-out both; }
        @keyframes vinylSlide {
          0%   { transform: translate(-430px, 230px) scale(0.42) rotate(-12deg); opacity: 0; }
          25%  { opacity: 1; }
          100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
        }
        input[type=range].vsl {
          -webkit-appearance: none;
          background: rgba(255,255,255,.14); border-radius: 3px; height: 3px;
        }
        input[type=range].vsl::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 15px; height: 15px; border-radius: 50%; background: #C47A2C; cursor: pointer;
        }
      `}</style>

      {/* Ambient color wash */}
      <div className="absolute inset-0 pointer-events-none z-0"
        style={{ background: `radial-gradient(ellipse at 28% 38%, ${accentRgba(0.18)} 0%, transparent 55%), radial-gradient(ellipse at 72% 72%, ${accentRgba(0.08)} 0%, transparent 50%)`, transition: "background 3s ease" }} />

      {/* Name prompt overlay */}
      {!nameSet && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 backdrop-blur-md">
          <div className="rounded-2xl bg-black/82 p-10 text-center w-80 shadow-2xl"
            style={{ border: `1px solid ${accentRgba(0.28)}` }}>
            <div className="fp font-black text-4xl mb-1 text-white">Welcome</div>
            <div className="fc text-base tracking-[0.5em] uppercase mb-7" style={{ color: lighter, opacity: 0.72 }}>
              AlbumClub · Russo's Lounge
            </div>
            <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveName()}
              className="w-full rounded-lg bg-white/6 border border-white/15 px-4 py-3 text-lg outline-none placeholder:text-white/25 focus:border-white/30 mb-4 fc text-white"
              placeholder="Your name…" maxLength={24} />
            <button onClick={saveName}
              className="w-full rounded-lg px-4 py-3 fc text-lg tracking-[0.3em] uppercase text-white font-semibold"
              style={{ background: `linear-gradient(to bottom, ${accentRgba(0.65)}, rgba(${Math.floor(cr*.6)},${Math.floor(cg*.6)},${Math.floor(cb2*.6)},0.8))`, border: `1px solid ${accentRgba(0.38)}` }}>
              Enter the Room
            </button>
          </div>
        </div>
      )}

      {/* Photo background */}
      <img src="/room-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover z-0"
        style={{ filter: `brightness(${isLive ? 0.72 : 0.5})`, transition: "filter 2.5s ease" }} />
      <div className="absolute inset-0 z-[1]"
        style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 8%, rgba(0,0,0,0.6) 100%)" }} />
      <div className="absolute bottom-0 left-0 right-0 h-64 z-[1]"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.97) 0%, transparent 100%)" }} />
      {isLive && (
        <div className="absolute inset-0 z-[1] pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 55%, ${accentRgba(0.06)} 0%, transparent 60%)`, animation: "pulse 5s ease-in-out infinite" }} />
      )}

      {/* ── HEADER ── */}
      <header className="absolute top-0 left-0 right-0 z-20 px-8 py-4 flex items-center justify-between"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)" }}>

        <div>
          <div className="fc text-sm tracking-[0.55em] uppercase text-white/60 mb-0.5 font-semibold">Now Playing</div>
          <div className="fp font-black text-3xl text-white tracking-wide">AlbumClub</div>
        </div>

        <div className="flex items-center gap-3">
          {/* Listener count */}
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-sm"
            style={{ background: "rgba(0,0,0,0.68)", border: "1px solid rgba(255,255,255,0.18)" }}>
            <div className="w-2.5 h-2.5 rounded-full"
              style={isLive
                ? { background: accent, boxShadow: `0 0 8px ${accentRgba(0.9)}`, animation: "pulse 2s infinite" }
                : { background: "rgba(255,255,255,0.28)" }} />
            <span className="fc text-[17px] text-white font-semibold">{listenerCount} listening</span>
          </div>

          {/* Volume */}
          <div className="relative">
            <button onClick={() => setShowVolume(v => !v)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-sm"
              style={{ background: "rgba(0,0,0,0.68)", border: "1px solid rgba(255,255,255,0.18)" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {volume > 0   && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
                {volume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
              </svg>
              <span className="fc text-[17px] text-white font-semibold">{Math.round(volume * 100)}%</span>
            </button>
            {showVolume && (
              <div className="absolute top-14 right-0 rounded-xl p-5 w-48 z-30 backdrop-blur-xl"
                style={{ background: "rgba(0,0,0,0.92)", border: "1px solid rgba(255,255,255,0.16)" }}>
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))} className="vsl w-full" />
                <div className="text-center fc text-base text-white/55 mt-2">{Math.round(volume * 100)}%</div>
              </div>
            )}
          </div>

          {/* Crackle */}
          <button onClick={() => setCrackleOn(v => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-sm transition-all"
            style={{
              background: crackleOn ? accentRgba(0.28) : "rgba(0,0,0,0.68)",
              border:     crackleOn ? `1px solid ${accentRgba(0.5)}` : "1px solid rgba(255,255,255,0.18)",
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
            </svg>
            <span className="fc text-[17px] text-white font-semibold">{crackleOn ? "Crackle ✓" : "Crackle"}</span>
          </button>

          {/* Session controls — admin only */}
          {isAdmin && isLive && (<>
            <button onClick={isPaused ? resumePlayback : pausePlayback}
              className="px-5 py-2.5 rounded-lg fc font-semibold transition backdrop-blur-sm"
              style={{ fontSize: "1rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "white", background: isPaused ? accentRgba(0.38) : "rgba(0,0,0,0.55)", border: `1px solid ${isPaused ? accentRgba(0.55) : "rgba(255,255,255,0.24)"}` }}>
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button onClick={stopShowtime}
              className="px-5 py-2.5 rounded-lg fc font-semibold transition backdrop-blur-sm"
              style={{ fontSize: "1rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#fca5a5", background: "rgba(180,30,30,0.32)", border: "1px solid rgba(248,113,113,0.35)" }}>
              End Session
            </button>
          </>)}

          {/* Scheduled but not live yet */}
          {isAdmin && !isLive && scheduledFor && (
            <button onClick={stopShowtime}
              className="px-5 py-2.5 rounded-lg fc font-semibold transition backdrop-blur-sm"
              style={{ fontSize: "1rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#fcd34d", background: "rgba(120,80,0,0.35)", border: "1px solid rgba(252,211,77,0.3)" }}>
              Cancel Schedule
            </button>
          )}

          {/* Not live, nothing scheduled */}
          {isAdmin && !isLive && !scheduledFor && (<>
            <select value={scheduleDelay} onChange={e => setScheduleDelay(Number(e.target.value))}
              className="rounded-lg fc font-semibold px-3 py-2.5 text-white backdrop-blur-sm"
              style={{ fontSize: "1rem", background: "rgba(0,0,0,0.68)", border: "1px solid rgba(255,255,255,0.22)", outline: "none" }}>
              <option value={1}>In 1 min</option>
              <option value={2}>In 2 min</option>
              <option value={3}>In 3 min</option>
              <option value={5}>In 5 min</option>
              <option value={10}>In 10 min</option>
            </select>
            <button onClick={() => scheduleShowtime(scheduleDelay)}
              className="px-5 py-2.5 rounded-lg fc font-semibold transition backdrop-blur-sm"
              style={{ fontSize: "1rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "white", background: accentRgba(0.38), border: `1px solid ${accentRgba(0.55)}` }}>
              Schedule
            </button>
            <button onClick={triggerShowtime}
              className="px-5 py-2.5 rounded-lg fc font-semibold transition backdrop-blur-sm"
              style={{ fontSize: "1rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "white", background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.24)" }}>
              Start Now
            </button>
          </>)}
        </div>
      </header>

      {/* ── ALBUM INFO — left panel ── */}
      <div className="absolute z-20" style={{ left: "4%", top: "13%", width: "260px" }}>

        {/* Cover art */}
        <div className="relative mb-5">
          <div className="absolute -inset-6 rounded-2xl pointer-events-none"
            style={{ background: `radial-gradient(ellipse, ${accentRgba(0.35)} 0%, transparent 70%)`, filter: "blur(24px)" }} />
          {albumCoverUrl ? (
            <img src={albumCoverUrl} alt={ALBUM.title}
              className="relative rounded-xl w-full block"
              style={{ border: "1px solid rgba(255,255,255,0.12)", boxShadow: `0 30px 80px rgba(0,0,0,0.92), 0 0 50px ${accentRgba(0.22)}` }} />
          ) : (
            <div className="relative rounded-xl w-full aspect-square bg-white/5"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }} />
          )}
        </div>

        <div className="fp font-black leading-none mb-1.5 text-white"
          style={{ fontSize: "2.4rem", textShadow: "0 2px 40px rgba(0,0,0,0.99)" }}>
          {ALBUM.title}
        </div>
        <div className="fp italic mb-4" style={{ fontSize: "1.3rem", color: lighter }}>
          {ALBUM.artist}
        </div>

        <div className="space-y-1.5 mb-5">
          {([["Year", ALBUM.year],["Label", ALBUM.label],["Genre", ALBUM.genre]] as [string,string][]).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="fc text-xs tracking-[0.42em] uppercase text-white/28 w-12 shrink-0">{k}</span>
              <span className="fc text-[0.95rem] text-white/70">{v}</span>
            </div>
          ))}
        </div>

        {isLive && (
          <div className="flex items-center gap-2 mb-5">
            <div className="w-2.5 h-2.5 rounded-full"
              style={{ background: accent, boxShadow: `0 0 9px ${accent}`, animation: "pulse 1.5s infinite" }} />
            <span className="fc tracking-[0.38em] uppercase font-semibold"
              style={{ fontSize: "0.9rem", color: lighter }}>
              Live Now
            </span>
          </div>
        )}
      </div>

      {/* ── TURNTABLE — centered ── */}
      <div className="absolute z-20"
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "320px" }}>

        {/* Plinth */}
        <div className="relative rounded-2xl overflow-visible"
          style={{
            background: "linear-gradient(145deg, #1e1208 0%, #110a03 50%, #1b0f05 100%)",
            border:     "1px solid rgba(255,255,255,0.07)",
            boxShadow:  "0 35px 90px rgba(0,0,0,0.96), inset 0 1px 0 rgba(255,255,255,0.05)",
            padding:    "28px 28px 20px",
          }}>

          {/* Platter area */}
          <div className="relative mx-auto" style={{ width: "240px", height: "240px" }}>

            <div className="absolute inset-0 rounded-full"
              style={{ background: "linear-gradient(145deg,#2c1c0a,#1a0e04)", border: "2px solid rgba(255,255,255,0.05)", boxShadow: "inset 0 3px 10px rgba(0,0,0,0.92)" }} />
            <div className="absolute inset-[7px] rounded-full"
              style={{ background: "radial-gradient(circle at 40% 35%, #1c1c1c, #0d0d0d)", border: "1px solid rgba(255,255,255,0.03)" }} />

            {/* Vinyl record */}
            <div className="absolute inset-[12px] rounded-full"
              style={{
                background: "radial-gradient(circle at 50% 50%, #1c1c1c 0%, #0c0c0c 60%, #141414 100%)",
                animation: isLive
                  ? vinylSlideIn
                    ? `vinylSlide 1.4s cubic-bezier(0.22,1,0.36,1) both 0.05s, vSpin 1.8s linear 1.45s infinite`
                    : `vSpin 1.8s linear infinite`
                  : "none",
              }}>
              {[14,22,30,38,46,54,62,70,78,86].map(r2 => (
                <div key={r2} className="absolute rounded-full border border-white/[0.025]" style={{ inset: `${r2/2}%` }} />
              ))}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative rounded-full overflow-hidden flex items-center justify-center"
                  style={{ width: "35%", height: "35%", border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 0 12px rgba(0,0,0,0.8)" }}>
                  {albumCoverUrl && (
                    <img src={albumCoverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.8 }} />
                  )}
                  <div className="relative rounded-full bg-[#0a0a0a] z-10" style={{ width: "14%", height: "14%" }} />
                </div>
              </div>
              <div className={`v-sheen ${isLive ? "on" : ""}`} />
            </div>

            {/* Spindle */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full z-20"
              style={{ background: "linear-gradient(145deg,#999,#555)", boxShadow: "0 1px 4px rgba(0,0,0,0.92)" }} />

            {/* Tonearm */}
            <div className="absolute z-30" style={{ right: "-20px", top: "-14px" }}>
              <div className="relative" style={{ width: "56px", height: "56px" }}>
                <div className="absolute inset-0 rounded-full"
                  style={{ background: "linear-gradient(145deg,#3c2c1a,#1c1208)", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 5px 16px rgba(0,0,0,0.88)" }}>
                  <div className="absolute inset-[6px] rounded-full"
                    style={{ background: "linear-gradient(145deg,#2c200e,#160e04)", border: "1px solid rgba(255,255,255,0.05)" }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full"
                      style={{ background: "linear-gradient(145deg,#888,#3a3a3a)", boxShadow: "0 2px 8px rgba(0,0,0,0.92), inset 0 1px 2px rgba(255,255,255,0.18)" }} />
                  </div>
                </div>
                <div className="absolute z-10"
                  style={{ right: "24px", top: "24px", transformOrigin: "100% 50%", transform: `rotate(${tonearmAngle}deg)`, transition: tonearmTransition }}>
                  <div style={{ width: "200px", height: "7px", marginTop: "-3.5px", position: "relative" }}>
                    <div className="absolute inset-0 rounded-full"
                      style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 40%, rgba(0,0,0,0.3))", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 2px 10px rgba(0,0,0,0.72)" }} />
                    <div style={{ position: "absolute", left: "-26px", top: "50%", transform: "translateY(-50%) rotate(-12deg)", width: "26px", height: "18px", background: "linear-gradient(145deg,#5a5a5a,#2a2a2a)", borderRadius: "3px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 3px 12px rgba(0,0,0,0.82)" }}>
                      <div style={{ position: "absolute", bottom: "-2px", left: "7px", width: "11px", height: "9px", background: "linear-gradient(145deg,#3a3a3a,#111)", borderRadius: "1px", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ position: "absolute", left: "4px", bottom: "-7px", width: "2px", height: "8px", background: "linear-gradient(to bottom,#bbb,#555)", borderRadius: "0 0 1px 1px" }} />
                        <div style={{
                          position: "absolute", left: "3px", bottom: "-12px", width: "3px", height: "3px", borderRadius: "50%",
                          background: isLive ? accent : "#888",
                          boxShadow: isLive ? `0 0 6px ${accent}, 0 0 12px ${accentRgba(0.5)}` : "none",
                          transition: "background 0.5s, box-shadow 0.5s",
                        }} />
                      </div>
                    </div>
                    <div style={{ position: "absolute", right: "-6px", top: "50%", transform: "translateY(-50%)", width: "14px", height: "14px", borderRadius: "50%", background: "linear-gradient(145deg,#888,#444)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 2px 8px rgba(0,0,0,0.82)" }} />
                    <div style={{ position: "absolute", right: "22px", top: "-8px", width: "18px", height: "2px", background: "rgba(255,255,255,0.09)", borderRadius: "1px", transform: "rotate(-18deg)" }}>
                      <div style={{ position: "absolute", right: 0, top: "-2px", width: "5px", height: "5px", borderRadius: "50%", background: "linear-gradient(145deg,#666,#333)" }} />
                    </div>
                  </div>
                </div>
                <div style={{ position: "absolute", bottom: "-5px", right: "0", width: "8px", height: "16px", background: "linear-gradient(145deg,#555,#222)", borderRadius: "4px 4px 2px 2px", border: "1px solid rgba(255,255,255,0.07)" }} />
              </div>
            </div>

            {/* Needle drop spark */}
            {needleDrop && (
              <div className="absolute nspark z-40"
                style={{ left: "62%", top: "60%", width: "28px", height: "28px", transform: "translate(-50%,-50%)" }}>
                <div className="absolute inset-0 rounded-full" style={{ background: accentRgba(0.3) }} />
                <div className="absolute inset-0" style={{ background: `radial-gradient(circle, ${accentRgba(0.8)} 0%, transparent 70%)` }} />
              </div>
            )}
          </div>

          {/* Speed selector + power */}
          <div className="flex justify-between items-center mt-4 px-1">
            <div className="flex items-center gap-3">
              {["33⅓", "45"].map((s, i) => (
                <div key={s} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border"
                    style={i === 0
                      ? { background: accent, borderColor: accent, boxShadow: `0 0 7px ${accentRgba(0.7)}` }
                      : { borderColor: "rgba(255,255,255,0.18)" }} />
                  <span className="fc text-sm text-white/45">{s}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full"
                style={isLive
                  ? { background: "#4ade80", boxShadow: "0 0 7px rgba(74,222,128,0.9)" }
                  : { background: "rgba(255,255,255,0.14)" }} />
              <span className="fc text-sm text-white/38">{isLive ? "ON" : "STBY"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── TRACK WALL — centered, column-major order (1,2,3 per column) ── */}
      <div className="absolute z-10" style={{ left: "50%", transform: "translateX(-50%)", bottom: "22%", width: "min(680px, 56vw)" }}>
        <div className="fc mb-3 text-center" style={{ fontSize: "0.8rem", letterSpacing: "0.55em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)" }}>
          Tracklist
        </div>
        <div style={{ display: "flex", gap: "16px" }}>
          {wallCols.map((col, ci) => (
            <div key={ci} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
              {col.map(({ title, origIdx }) => {
                const isCurrentTrack = isLive && !isPaused && origIdx === tIdx;
                const isActive       = isCurrentTrack || (isPaused && origIdx === tIdx);
                return (
                  <div key={origIdx} className="flex items-baseline gap-2 min-w-0 w-full px-2 py-1 rounded-lg"
                    style={{
                      background:  isActive ? accentRgba(0.13) : "transparent",
                      border:      isActive ? `1px solid ${accentRgba(0.28)}` : "1px solid transparent",
                      boxShadow:   isCurrentTrack ? `0 0 18px ${accentRgba(0.18)}` : "none",
                      transition:  "all 0.7s ease",
                    }}>
                    <span className="fc shrink-0" style={{
                      fontSize: "1.1rem", fontWeight: 600,
                      color: isActive ? accentRgba(0.9) : "rgba(255,255,255,0.18)",
                      minWidth: "22px", textAlign: "right",
                      transition: "color 0.7s ease",
                    }}>
                      {origIdx + 1}
                    </span>
                    <span className="fp truncate" style={{
                      fontSize:    isActive ? "1.38rem" : "1.18rem",
                      fontWeight:  isActive ? 700 : 500,
                      fontStyle:   isActive ? "normal" : "italic",
                      color:       isActive ? lighter : "rgba(255,255,255,0.35)",
                      textShadow:  isCurrentTrack ? `0 0 22px ${accentRgba(0.7)}, 0 2px 12px rgba(0,0,0,0.9)` : "0 1px 6px rgba(0,0,0,0.8)",
                      transition:  "all 0.7s ease",
                      letterSpacing: isActive ? "0.02em" : "0.01em",
                    }}>
                      {title}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── CHAT ── */}
      <div className={`absolute right-0 top-0 bottom-0 z-20 transition-all duration-300 ${chatExpanded ? "w-[430px]" : "w-[350px]"}`}>
        {chatOpen ? (
          <div className="flex flex-col h-full"
            style={{ background: "linear-gradient(to left, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.52) 100%)", backdropFilter: "blur(14px)" }}>
            <div className="flex flex-col h-full pt-20 pb-4 px-6 min-h-0">
              <div className="flex items-center justify-between mb-5 shrink-0">
                <div className="flex items-baseline gap-3">
                  <div className="fp font-bold text-white" style={{ fontSize: "1.5rem" }}>Chat</div>
                  <div className="fc tracking-[0.45em] uppercase text-white/40" style={{ fontSize: "0.72rem" }}>{isLive ? "Live" : "Lobby"}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setChatExpanded(e => !e)}
                    className="px-3 py-1.5 rounded fc text-white border border-white/15 bg-black/25 hover:bg-black/45 transition"
                    style={{ fontSize: "0.9rem" }}>{chatExpanded ? "↙" : "↗"}</button>
                  <button onClick={() => setChatOpen(false)}
                    className="px-3 py-1.5 rounded fc text-white border border-white/15 bg-black/25 hover:bg-black/45 transition"
                    style={{ fontSize: "0.9rem" }}>✕</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
                {messages.length === 0 && (
                  <p className="fc italic text-white/22 text-center mt-16" style={{ fontSize: "1.05rem" }}>
                    The room is quiet.<br />Say something.
                  </p>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className="group">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="fc font-semibold shrink-0"
                        style={{ fontSize: "1rem", color: `rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+20,255)},0.9)` }}>
                        {msg.display_name}
                      </span>
                      <span className="fc text-white/18 opacity-0 group-hover:opacity-100 transition" style={{ fontSize: "0.78rem" }}>
                        {fmtTs(msg.created_at)}
                      </span>
                    </div>
                    <div className="fc text-white/80 leading-snug" style={{ fontSize: "1rem" }}>{msg.body}</div>
                  </div>
                ))}
                <div ref={msgEndRef} />
              </div>
              <div className="shrink-0 mt-4 pt-4 border-t border-white/10 flex gap-2">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendMessage()} disabled={!nameSet}
                  className="flex-1 rounded-lg bg-white/6 border border-white/12 px-4 py-3 outline-none placeholder:text-white/22 focus:border-white/26 disabled:opacity-22 fc text-white"
                  style={{ fontSize: "1rem" }}
                  placeholder={nameSet ? "Say something…" : "Set your name first…"} />
                <button onClick={sendMessage} disabled={!nameSet || !chatInput.trim()}
                  className="rounded-lg px-5 py-3 fc text-white font-semibold disabled:opacity-20 transition"
                  style={{ fontSize: "1rem", background: "linear-gradient(to bottom,#5a1a1a,#321010)", border: "1px solid rgba(200,60,60,0.35)" }}>
                  Send
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setChatOpen(true)}
            className="absolute right-4 top-20 flex items-center gap-2 rounded-full border border-white/18 bg-black/62 backdrop-blur-md px-4 py-2.5 hover:bg-black/82 transition">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="fc text-white font-semibold" style={{ fontSize: "1rem" }}>Chat</span>
            {messages.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-white" style={{ fontSize: "0.65rem" }}>
                {messages.length}
              </span>
            )}
          </button>
        )}
      </div>

      <audio ref={audioRef}
        src="https://obnhrzehigtbadynicss.supabase.co/storage/v1/object/public/Albums/Lonerism.mp3"
        preload="auto" crossOrigin="anonymous" />
    </main>
  );
}
