"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef } from "react";

type Message = {
  id: string;
  display_name: string;
  body: string;
  created_at: string;
};

type Track = {
  title: string;
  start: number;
};

const TRACKS: Track[] = [
  { title: "Be Above It",                                                          start: 0    },
  { title: "Endors Toi",                                                           start: 202  },
  { title: "Apocalypse Dreams",                                                    start: 388  },
  { title: "Mind Mischief",                                                        start: 745  },
  { title: "Music to Walk Home By",                                                start: 1017 },
  { title: "Why Won't They Talk to Me?",                                           start: 1330 },
  { title: "Feels Like We Only Go Backwards",                                      start: 1616 },
  { title: "Keep on Lying",                                                        start: 1809 },
  { title: "Elephant",                                                             start: 2163 },
  { title: "She Just Won't Believe Me",                                            start: 2374 },
  { title: "Nothing That Has Happened So Far Has Been Anything We Could Control",  start: 2431 },
  { title: "Sun's Coming Up",                                                      start: 2791 },
];

const ALBUM_DURATION = 3112;

function getCurrentTrack(secondsPassed: number): { track: Track; index: number } {
  let current = TRACKS[0];
  let index = 0;
  for (let i = 0; i < TRACKS.length; i++) {
    if (secondsPassed >= TRACKS[i].start) { current = TRACKS[i]; index = i; }
    else break;
  }
  return { track: current, index };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function RoomPage() {
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [startedAt, setStartedAt]           = useState<string | null>(null);
  const [isLive, setIsLive]                 = useState(false);
  const [needleDrop, setNeedleDrop]         = useState(false);
  const [countdown, setCountdown]           = useState<number | null>(null);
  const [audioUnlocked, setAudioUnlocked]   = useState(false);
  const [elapsed, setElapsed]               = useState(0);
  const [chatOpen, setChatOpen]             = useState(true);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [chatInput, setChatInput]           = useState("");
  const [displayName, setDisplayName]       = useState("");
  const [nameInput, setNameInput]           = useState("");
  const [nameSet, setNameSet]               = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("ac_display_name");
    if (stored) { setDisplayName(stored); setNameSet(true); }
  }, []);

  useEffect(() => {
    const unlock = async () => {
      if (!audioRef.current) return;
      try { await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime = 0; setAudioUnlocked(true); } catch {}
    };
    window.addEventListener("click", unlock, { once: true });
    return () => window.removeEventListener("click", unlock);
  }, []);

  useEffect(() => {
    if (!isLive) return;
    setNeedleDrop(true);
    const t = setTimeout(() => setNeedleDrop(false), 600);
    return () => clearTimeout(t);
  }, [isLive]);

  useEffect(() => {
    supabase.from("messages").select("*").eq("room_id", "main").order("created_at", { ascending: true }).limit(100)
      .then(({ data }) => { if (data) setMessages(data as Message[]); });

    supabase.from("room_state").select("*").eq("room_id", "main").single()
      .then(({ data }) => {
        if (!data?.started_at) return;
        setStartedAt(data.started_at);
        const secondsLeft = Math.ceil((new Date(data.started_at).getTime() - Date.now()) / 1000);
        if (secondsLeft > 0) setCountdown(secondsLeft);
        else setIsLive(true);
      });

    const roomCh = supabase.channel("room-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_state" }, (payload: any) => {
        const row = payload.new as { is_live?: boolean; started_at?: string };
        if (row?.started_at) {
          setStartedAt(row.started_at);
          const secondsLeft = Math.ceil((new Date(row.started_at).getTime() - Date.now()) / 1000);
          if (secondsLeft > 0) setCountdown(secondsLeft);
          else { setCountdown(null); setIsLive(true); }
        }
        if (row?.is_live === false) {
          setIsLive(false); setCountdown(null); setStartedAt(null); setElapsed(0);
          if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
        }
      }).subscribe();

    const msgCh = supabase.channel("messages-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "room_id=eq.main" },
        (payload: any) => setMessages((prev) => [...prev, payload.new as Message])
      ).subscribe();

    return () => { supabase.removeChannel(roomCh); supabase.removeChannel(msgCh); };
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); setIsLive(true); return; }
    const interval = setInterval(() => setCountdown((p) => p !== null ? p - 1 : null), 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  useEffect(() => {
    if (!startedAt || !audioUnlocked || !audioRef.current) return;
    const secondsPassed = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000);
    audioRef.current.currentTime = secondsPassed;
    audioRef.current.play().catch(() => {});
  }, [startedAt, audioUnlocked]);

  useEffect(() => {
    if (!isLive || !startedAt) return;
    const tick = () => setElapsed(Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isLive, startedAt]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const saveName = () => {
    const name = nameInput.trim();
    if (!name) return;
    localStorage.setItem("ac_display_name", name);
    setDisplayName(name); setNameSet(true);
  };

  const triggerShowtime = async () => {
    if (audioRef.current) {
      try { await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime = 0; setAudioUnlocked(true); } catch {}
    }
    const startTime = new Date(Date.now() + 5000).toISOString();
    await supabase.from("room_state").update({ is_live: true, started_at: startTime }).eq("room_id", "main");
  };

  const stopShowtime = async () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    await supabase.from("room_state").update({ is_live: false, started_at: null }).eq("room_id", "main");
  };

  const sendMessage = async () => {
    const body = chatInput.trim();
    if (!body || !displayName) return;
    setChatInput("");
    await supabase.from("messages").insert({ room_id: "main", display_name: displayName, body });
  };

  const { track: currentTrack, index: trackIndex } = getCurrentTrack(elapsed);
  const nextTrack = TRACKS[trackIndex + 1] || null;
  const trackElapsed = elapsed - currentTrack.start;
  const trackDuration = nextTrack ? nextTrack.start - currentTrack.start : ALBUM_DURATION - currentTrack.start;
  const trackProgress = Math.min(100, (trackElapsed / trackDuration) * 100);

  return (
    <main className="relative min-h-screen text-[#F5E6C8] overflow-hidden">

      {countdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="text-[12rem] font-serif text-[#F5E6C8] opacity-90 leading-none">{countdown}</div>
        </div>
      )}

      {!nameSet && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border border-[#F5E6C8]/15 bg-black/60 p-8 w-80 text-center shadow-2xl">
            <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C] mb-3">Welcome</div>
            <h2 className="font-serif text-2xl mb-2">Who are you?</h2>
            <p className="text-sm text-[#F5E6C8]/60 mb-6">Pick a name for the chat</p>
            <input autoFocus value={nameInput} onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="w-full rounded-xl bg-black/30 border border-[#F5E6C8]/15 px-4 py-3 text-sm outline-none placeholder:text-[#F5E6C8]/30 focus:border-[#C47A2C]/50 mb-4"
              placeholder="Your name..." maxLength={24} />
            <button onClick={saveName} className="w-full rounded-xl bg-[#6B1F1F] hover:bg-[#8A2A2A] transition px-4 py-3 text-sm tracking-[0.2em] uppercase">
              Enter the Room
            </button>
          </div>
        </div>
      )}

      <img src="/room-bg.jpg" alt=""
        className={`absolute inset-0 w-full h-full object-cover animate-roomBreath transition-all duration-1000 ${isLive ? "brightness-75 scale-105" : "brightness-100 scale-100"}`}
      />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.75)_85%)]" />

      <header className={`relative z-10 w-full px-6 py-4 border-b transition-all duration-700 ${isLive ? "border-[#C47A2C]/50 shadow-[0_0_25px_rgba(196,122,44,0.2)]" : "border-[#F5E6C8]/20"}`}>
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">Now Showing</span>
            <h1 className="text-2xl md:text-3xl font-serif tracking-wide">The Album Club</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-xs uppercase tracking-[0.25em] text-[#F5E6C8]/70">Showtime</div>
              <div className="font-mono text-lg md:text-xl">8:00 PM</div>
            </div>
            {isLive ? (
              <button onClick={stopShowtime} className="rounded-xl bg-black/30 border border-red-500/30 px-4 py-2 text-xs tracking-[0.25em] uppercase hover:bg-red-900/20 transition text-red-400">End Session</button>
            ) : (
              <button onClick={triggerShowtime} className="rounded-xl bg-black/30 border border-[#F5E6C8]/15 px-4 py-2 text-xs tracking-[0.25em] uppercase hover:bg-black/40 transition">Start Showtime</button>
            )}
          </div>
        </div>
      </header>

      <section className="relative z-10 flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="mb-10">
          <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">Listening Room</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-serif">Russo&apos;s Lounge</h2>
          <p className="mt-3 text-[#F5E6C8]/70">Full-album experience. No skips. Just vibe.</p>
        </div>

        <div className={`relative w-[460px] h-[460px] flex items-center justify-center ${isLive ? "animate-stageGlow" : ""}`} style={{ transform: "translateX(-20px)" }}>
          <div className="absolute inset-0 rounded-2xl border border-[#F5E6C8]/15 bg-black/40 backdrop-blur-md shadow-2xl" />
          <div className={`relative w-72 h-72 rounded-full bg-black shadow-xl ${isLive ? "animate-vinylSpin" : ""}`}>
            <div className="absolute inset-4 rounded-full border border-white/10" />
            <div className="absolute inset-8 rounded-full border border-white/10" />
            <div className="absolute inset-12 rounded-full border border-white/10" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-[#C47A2C]/90 shadow-inner" />
            </div>
            <div className={`vinyl-sheen ${isLive ? "animate-vinylSheen" : ""}`} />
          </div>

          <div className={`absolute right-[24px] top-[34px] pointer-events-none ${isLive ? "tonearm-drop" : ""}`}>
            <div className="relative w-24 h-24">
              <div className="absolute right-0 top-0 w-16 h-16 rounded-full bg-[#F5E6C8]/10 border border-[#F5E6C8]/25 shadow-sm" />
              <div className="absolute right-[14px] top-[14px] w-8 h-8 rounded-full bg-[#F5E6C8]/12 border border-[#F5E6C8]/25" />
              <div className="absolute right-[2px] top-[46px] w-5 h-5 rounded-full bg-[#F5E6C8]/10 border border-[#F5E6C8]/20" />
              <div className="absolute right-[30px] top-[30px] origin-[100%_50%] rotate-[-70deg]">
                <div className="w-56 h-[6px] rounded-full bg-[#F5E6C8]/22 border border-[#F5E6C8]/15 shadow-sm" />
                <div className="absolute left-[-10px] top-[-2px] w-12 h-8 rounded-md bg-[#F5E6C8]/14 border border-[#F5E6C8]/20 shadow-sm rotate-[-10deg]" />
                <div className="absolute left-[2px] top-[4px] w-6 h-4 rounded bg-[#F5E6C8]/18 border border-[#F5E6C8]/20" />
                <div className="absolute left-[8px] top-[16px] w-2 h-2 rounded-full bg-[#C47A2C]/90 shadow" />
                {needleDrop && (
                  <div className="absolute left-[4px] top-[12px] w-5 h-5 needle-spark">
                    <div className="absolute inset-0 rounded-full bg-[#C47A2C]/35" />
                    <div className="absolute left-1/2 top-1/2 w-1 h-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/45 rounded" />
                    <div className="absolute left-1/2 top-1/2 h-1 w-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/45 rounded" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Track Display */}
        <div className="mt-8 w-[460px]" style={{ transform: "translateX(-20px)" }}>
          {isLive ? (
            <div className="rounded-2xl border border-[#F5E6C8]/15 bg-black/40 backdrop-blur-md px-6 py-5">
              <div className="flex items-start justify-between mb-3">
                <div className="text-left">
                  <div className="text-[10px] tracking-[0.3em] uppercase text-[#C47A2C] mb-1">
                    Track {trackIndex + 1} of {TRACKS.length}
                  </div>
                  <div className="font-serif text-lg leading-tight">{currentTrack.title}</div>
                  <div className="text-xs text-[#F5E6C8]/50 mt-1">Tame Impala — Lonerism</div>
                </div>
                <div className="text-right text-xs font-mono text-[#F5E6C8]/50 shrink-0 ml-4 pt-1">
                  <div>{formatTime(trackElapsed)}</div>
                  <div className="text-[#F5E6C8]/30">/ {formatTime(trackDuration)}</div>
                </div>
              </div>
              <div className="h-[2px] w-full bg-[#F5E6C8]/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#C47A2C]/70 rounded-full transition-all duration-1000" style={{ width: `${trackProgress}%` }} />
              </div>
              {nextTrack && (
                <div className="mt-3 text-xs text-[#F5E6C8]/35 text-left">Next: {nextTrack.title}</div>
              )}
            </div>
          ) : (
            <div className="text-sm tracking-[0.25em] uppercase text-[#F5E6C8]/40">Waiting for showtime</div>
          )}
        </div>
      </section>

      <div className="fixed bottom-6 right-6 z-30 max-w-[92vw]">
        {chatOpen ? (
          <div className="w-[360px] overflow-hidden rounded-2xl border border-[#F5E6C8]/15 bg-black/45 backdrop-blur-md shadow-2xl">
            <div className="px-4 py-3 border-b border-[#F5E6C8]/10 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <div className="font-serif text-lg">Chat</div>
                <div className="text-[10px] tracking-[0.25em] uppercase text-[#F5E6C8]/60">{isLive ? "Live" : "Lobby"}</div>
              </div>
              <button onClick={() => setChatOpen(false)} className="rounded-lg px-2 py-1 text-xs tracking-[0.25em] uppercase border border-[#F5E6C8]/15 bg-black/25 hover:bg-black/35 transition">Minimize</button>
            </div>
            <div className="px-4 py-3 h-52 overflow-y-auto text-sm text-[#F5E6C8]/80 space-y-2">
              {messages.length === 0 && <p className="text-[#F5E6C8]/30 text-xs text-center mt-8">No messages yet. Say something.</p>}
              {messages.map((msg) => (
                <div key={msg.id} className="group">
                  <span className="text-[#C47A2C] font-medium">{msg.display_name}:</span>{" "}
                  <span>{msg.body}</span>
                  <span className="ml-2 text-[10px] text-[#F5E6C8]/25 opacity-0 group-hover:opacity-100 transition">{formatTimestamp(msg.created_at)}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t border-[#F5E6C8]/10 flex gap-2">
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()} disabled={!nameSet}
                className="flex-1 rounded-xl bg-black/30 border border-[#F5E6C8]/15 px-3 py-2 text-sm outline-none placeholder:text-[#F5E6C8]/40 focus:border-[#C47A2C]/40 disabled:opacity-40"
                placeholder={nameSet ? "Type a message..." : "Set your name first…"} />
              <button onClick={sendMessage} disabled={!nameSet || !chatInput.trim()}
                className="rounded-xl bg-[#6B1F1F]/80 hover:bg-[#8A2A2A] transition px-4 py-2 text-sm disabled:opacity-40">Send</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setChatOpen(true)} className="flex items-center gap-3 rounded-full border border-[#F5E6C8]/15 bg-black/45 backdrop-blur-md shadow-2xl px-4 py-3 hover:bg-black/55 transition">
            <span className="font-serif">Chat</span>
            <span className="text-[10px] tracking-[0.25em] uppercase text-[#F5E6C8]/60">{isLive ? "Live" : "Lobby"}</span>
            {messages.length > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#C47A2C]/80 text-[10px] text-black">
                {messages.length > 99 ? "99+" : messages.length}
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
