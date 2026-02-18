"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef } from "react";

type Message = { id: string; display_name: string; body: string; created_at: string; };
type Track = { title: string; start: number; };

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
const ALBUM_COVER_URL = ""; // auto-fetched below

function getCurrentTrack(s: number) {
  let t = TRACKS[0]; let i = 0;
  for (let x = 0; x < TRACKS.length; x++) {
    if (s >= TRACKS[x].start) { t = TRACKS[x]; i = x; } else break;
  }
  return { track: t, index: i };
}

function fmt(s: number) {
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,"0")}`;
}

async function fetchCover(artist: string, title: string): Promise<{ front: string; back: string | null }> {
  const cacheKey = `cover_${artist}_${title}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
    const res = await fetch(`https://musicbrainz.org/ws/2/release/?query=artist:${encodeURIComponent(artist)}+release:${encodeURIComponent(title)}&limit=5&fmt=json`, { headers: { "User-Agent": "AlbumClub/1.0" } });
    const data = await res.json();
    for (const release of (data.releases || []).slice(0, 3)) {
      try {
        const cr = await fetch(`https://coverartarchive.org/release/${release.id}`);
        if (!cr.ok) continue;
        const cd = await cr.json();
        const images = cd.images || [];
        const front = images.find((i: any) => i.front)?.thumbnails?.large || "";
        const back = images.find((i: any) => i.back)?.thumbnails?.large || null;
        if (front) { const r = { front, back }; localStorage.setItem(cacheKey, JSON.stringify(r)); return r; }
      } catch {}
    }
  } catch {}
  return { front: "", back: null };
}

export default function RoomPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [startedAt, setStartedAt]         = useState<string | null>(null);
  const [isLive, setIsLive]               = useState(false);
  const [needleDrop, setNeedleDrop]       = useState(false);
  const [countdown, setCountdown]         = useState<number | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [chatOpen, setChatOpen]           = useState(true);
  const [messages, setMessages]           = useState<Message[]>([]);
  const [chatInput, setChatInput]         = useState("");
  const [displayName, setDisplayName]     = useState("");
  const [nameInput, setNameInput]         = useState("");
  const [nameSet, setNameSet]             = useState(false);
  const [cover, setCover]                 = useState<{ front: string; back: string | null } | null>(null);
  const [entered, setEntered]             = useState(false);

  // Page enter animation
  useEffect(() => { setTimeout(() => setEntered(true), 50); }, []);

  // Display name
  useEffect(() => {
    const s = localStorage.getItem("ac_display_name");
    if (s) { setDisplayName(s); setNameSet(true); }
  }, []);

  // Fetch cover art for Lonerism
  useEffect(() => {
    fetchCover("Tame Impala", "Lonerism").then(setCover);
  }, []);

  // Audio unlock
  useEffect(() => {
    const unlock = async () => {
      if (!audioRef.current) return;
      try { await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime = 0; setAudioUnlocked(true); } catch {}
    };
    window.addEventListener("click", unlock, { once: true });
    return () => window.removeEventListener("click", unlock);
  }, []);

  // Needle drop
  useEffect(() => {
    if (!isLive) return;
    setNeedleDrop(true);
    const t = setTimeout(() => setNeedleDrop(false), 600);
    return () => clearTimeout(t);
  }, [isLive]);

  // Supabase
  useEffect(() => {
    supabase.from("messages").select("*").eq("room_id","main").order("created_at",{ascending:true}).limit(100)
      .then(({data}) => { if (data) setMessages(data as Message[]); });

    supabase.from("room_state").select("*").eq("room_id","main").single()
      .then(({data}) => {
        if (!data?.started_at) return;
        setStartedAt(data.started_at);
        const sl = Math.ceil((new Date(data.started_at).getTime() - Date.now()) / 1000);
        if (sl > 0) setCountdown(sl); else setIsLive(true);
      });

    const roomCh = supabase.channel("room-state")
      .on("postgres_changes",{event:"*",schema:"public",table:"room_state"},(payload:any) => {
        const row = payload.new as {is_live?:boolean;started_at?:string};
        if (row?.started_at) {
          setStartedAt(row.started_at);
          const sl = Math.ceil((new Date(row.started_at).getTime()-Date.now())/1000);
          if (sl>0) setCountdown(sl); else {setCountdown(null);setIsLive(true);}
        }
        if (row?.is_live===false) {
          setIsLive(false);setCountdown(null);setStartedAt(null);setElapsed(0);
          if (audioRef.current){audioRef.current.pause();audioRef.current.currentTime=0;}
        }
      }).subscribe();

    const msgCh = supabase.channel("messages-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"room_id=eq.main"},
        (payload:any) => setMessages(p=>[...p,payload.new as Message])).subscribe();

    return () => {supabase.removeChannel(roomCh);supabase.removeChannel(msgCh);};
  }, []);

  useEffect(() => {
    if (countdown===null) return;
    if (countdown<=0){setCountdown(null);setIsLive(true);return;}
    const id = setInterval(()=>setCountdown(p=>p!==null?p-1:null),1000);
    return ()=>clearInterval(id);
  },[countdown]);

  useEffect(() => {
    if (!startedAt||!audioUnlocked||!audioRef.current) return;
    const sp = Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000);
    audioRef.current.currentTime=sp;
    audioRef.current.play().catch(()=>{});
  },[startedAt,audioUnlocked]);

  useEffect(() => {
    if (!isLive||!startedAt) return;
    const tick = ()=>setElapsed(Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000));
    tick();
    const id = setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[isLive,startedAt]);

  useEffect(()=>{messagesEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const saveName = () => {
    const n = nameInput.trim();
    if (!n) return;
    localStorage.setItem("ac_display_name",n);
    setDisplayName(n);setNameSet(true);
  };

  const triggerShowtime = async () => {
    if (audioRef.current) { try{await audioRef.current.play();audioRef.current.pause();audioRef.current.currentTime=0;setAudioUnlocked(true);}catch{} }
    const st = new Date(Date.now()+5000).toISOString();
    await supabase.from("room_state").update({is_live:true,started_at:st}).eq("room_id","main");
  };

  const stopShowtime = async () => {
    if (audioRef.current){audioRef.current.pause();audioRef.current.currentTime=0;}
    await supabase.from("room_state").update({is_live:false,started_at:null}).eq("room_id","main");
  };

  const sendMessage = async () => {
    const body = chatInput.trim();
    if (!body||!displayName) return;
    setChatInput("");
    await supabase.from("messages").insert({room_id:"main",display_name:displayName,body});
  };

  const {track:currentTrack,index:trackIndex} = getCurrentTrack(elapsed);
  const nextTrack = TRACKS[trackIndex+1]||null;
  const trackElapsed = elapsed-currentTrack.start;
  const trackDuration = nextTrack ? nextTrack.start-currentTrack.start : ALBUM_DURATION-currentTrack.start;
  const trackProgress = Math.min(100,(trackElapsed/trackDuration)*100);
  const albumProgress = Math.min(100,(elapsed/ALBUM_DURATION)*100);

  return (
    <main className="relative w-screen h-screen overflow-hidden font-serif">

      {/* ── Countdown overlay ── */}
      {countdown!==null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="text-[14rem] font-serif text-[#F5E6C8]/90 leading-none" style={{textShadow:"0 0 80px rgba(196,122,44,0.5)"}}>
            {countdown}
          </div>
        </div>
      )}

      {/* ── Name prompt ── */}
      {!nameSet && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-sm border border-[#6a4020]/50 bg-black/70 p-8 w-80 text-center shadow-2xl">
            <div className="text-[10px] tracking-[0.4em] uppercase text-[#C47A2C] mb-3">Welcome</div>
            <h2 className="font-serif text-2xl text-[#F5E6C8] mb-2">Who are you?</h2>
            <p className="text-sm text-[#F5E6C8]/50 mb-6">Your name for the chat</p>
            <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveName()}
              className="w-full rounded-sm bg-black/40 border border-[#6a4020]/40 px-4 py-3 text-sm text-[#F5E6C8] outline-none placeholder:text-[#F5E6C8]/30 focus:border-[#C47A2C]/50 mb-4"
              placeholder="Your name..." maxLength={24} />
            <button onClick={saveName}
              className="w-full rounded-sm px-4 py-3 text-sm tracking-[0.2em] uppercase text-[#F5E6C8] transition"
              style={{background:"linear-gradient(to bottom,#7a3318,#4a1e0a)",border:"1px solid rgba(196,122,44,0.4)"}}>
              Enter the Room
            </button>
          </div>
        </div>
      )}

      {/* ── Background ── */}
      <div
        className="absolute inset-0 transition-all duration-1000"
        style={{
          backgroundImage: "url('/room-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center center",
          transform: entered ? (isLive ? "scale(1.04)" : "scale(1.0)") : "scale(1.08)",
          opacity: entered ? 1 : 0,
          transition: "transform 1.2s cubic-bezier(0.2,0,0,1), opacity 0.8s ease",
          filter: isLive ? "brightness(0.8)" : "brightness(0.9)",
        }}
      />

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none"
        style={{background:"radial-gradient(ellipse at 50% 60%, transparent 20%, rgba(0,0,0,0.7) 100%)"}}/>

      {/* ── Header ── */}
      <header className={`absolute top-0 left-0 right-0 z-20 px-6 py-4 flex items-center justify-between transition-all duration-700 ${isLive?"border-b border-[#C47A2C]/30":""}`}
        style={{background:"linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)"}}>
        <div>
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#C47A2C]">Now Showing</div>
          <h1 className="text-xl font-serif text-[#F5E6C8] tracking-wide">The Album Club</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.25em] text-[#F5E6C8]/50">Showtime</div>
            <div className="font-mono text-base text-[#F5E6C8]">8:00 PM</div>
          </div>
          {isLive ? (
            <button onClick={stopShowtime}
              className="rounded-sm px-4 py-2 text-xs tracking-[0.2em] uppercase text-red-300 transition hover:brightness-110"
              style={{background:"rgba(80,20,10,0.6)",border:"1px solid rgba(200,60,40,0.3)"}}>
              End Session
            </button>
          ) : (
            <button onClick={triggerShowtime}
              className="rounded-sm px-4 py-2 text-xs tracking-[0.2em] uppercase text-[#F5E6C8] transition hover:brightness-110"
              style={{background:"rgba(30,15,5,0.7)",border:"1px solid rgba(196,122,44,0.3)"}}>
              Start Showtime
            </button>
          )}
        </div>
      </header>

      {/* ── Album art on wall (left side, above console) ── */}
      {cover?.front && (
        <div className="absolute z-10 transition-all duration-700"
          style={{
            left: "5%", top: "18%",
            opacity: entered ? 1 : 0,
            transform: entered ? "rotate(-2deg)" : "rotate(-2deg) translateY(10px)",
            transition: "opacity 1s ease 0.3s, transform 1s ease 0.3s",
          }}>
          {/* Frame */}
          <div style={{
            padding: "8px",
            background: "linear-gradient(135deg, #5a3515, #3a2008)",
            boxShadow: isLive
              ? "0 0 0 1px rgba(200,160,80,0.4), 0 20px 60px rgba(0,0,0,0.8), 0 0 40px rgba(196,122,44,0.12)"
              : "0 0 0 1px rgba(100,60,20,0.35), 0 12px 40px rgba(0,0,0,0.7)",
            transition: "box-shadow 1s ease",
          }}>
            <img src={cover.front} alt="Album cover"
              style={{width:"110px",height:"110px",objectFit:"cover",display:"block"}}/>
          </div>
          {/* Info below frame */}
          <div className="mt-1 text-center" style={{width:"126px"}}>
            <div className="text-[#F5E6C8]/70 text-[9px] font-serif truncate">Tame Impala</div>
            <div className="text-[#C47A2C]/60 text-[8px] tracking-wider uppercase">Lonerism · 2012</div>
          </div>
        </div>
      )}

      {/* ── Center: Vinyl turntable ── */}
      <div className="absolute z-10 flex flex-col items-center"
        style={{
          left: "50%", top: "30%",
          transform: "translateX(-50%)",
          opacity: entered ? 1 : 0,
          transition: "opacity 1s ease 0.2s",
        }}>

        {/* Turntable platter */}
        <div className={`relative flex items-center justify-center rounded-xl border border-[#F5E6C8]/10 bg-black/50 backdrop-blur-sm shadow-2xl ${isLive?"animate-stageGlow":""}`}
          style={{width:"280px",height:"280px"}}>

          {/* Vinyl */}
          <div className={`relative rounded-full bg-black shadow-xl ${isLive?"animate-vinylSpin":""}`}
            style={{width:"220px",height:"220px"}}>
            <div className="absolute inset-3 rounded-full border border-white/10"/>
            <div className="absolute inset-6 rounded-full border border-white/10"/>
            <div className="absolute inset-10 rounded-full border border-white/10"/>
            {/* Album art as label */}
            <div className="absolute inset-0 flex items-center justify-center">
              {cover?.front ? (
                <img src={cover.front} alt="" className="w-16 h-16 rounded-full object-cover opacity-80"/>
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#C47A2C]/80"/>
              )}
            </div>
            <div className={`vinyl-sheen ${isLive?"animate-vinylSheen":""}`}/>
          </div>

          {/* Tonearm */}
          <div className={`absolute right-[16px] top-[20px] pointer-events-none ${isLive?"tonearm-drop":""}`}>
            <div className="relative w-20 h-20">
              <div className="absolute right-0 top-0 w-14 h-14 rounded-full bg-[#F5E6C8]/10 border border-[#F5E6C8]/20"/>
              <div className="absolute right-[12px] top-[12px] w-7 h-7 rounded-full bg-[#F5E6C8]/10 border border-[#F5E6C8]/20"/>
              <div className="absolute right-[26px] top-[26px] origin-[100%_50%] rotate-[-70deg]">
                <div className="w-48 h-[5px] rounded-full bg-[#F5E6C8]/20 border border-[#F5E6C8]/10"/>
                <div className="absolute left-[-8px] top-[-2px] w-10 h-7 rounded-md bg-[#F5E6C8]/12 border border-[#F5E6C8]/15 rotate-[-10deg]"/>
                <div className="absolute left-[6px] top-[13px] w-2 h-2 rounded-full bg-[#C47A2C]/90"/>
                {needleDrop && (
                  <div className="absolute left-[2px] top-[10px] w-5 h-5 needle-spark">
                    <div className="absolute inset-0 rounded-full bg-[#C47A2C]/30"/>
                    <div className="absolute left-1/2 top-1/2 w-1 h-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/40 rounded"/>
                    <div className="absolute left-1/2 top-1/2 h-1 w-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/40 rounded"/>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Track info below turntable */}
        {isLive ? (
          <div className="mt-4 rounded-sm border border-[#F5E6C8]/10 bg-black/50 backdrop-blur-sm px-5 py-4"
            style={{width:"280px"}}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-[9px] tracking-[0.35em] uppercase text-[#C47A2C] mb-1">
                  Track {trackIndex+1} / {TRACKS.length}
                </div>
                <div className="font-serif text-[#F5E6C8] text-sm leading-snug">{currentTrack.title}</div>
              </div>
              <div className="text-right text-[10px] font-mono text-[#F5E6C8]/40 ml-3 shrink-0 pt-4">
                {fmt(trackElapsed)} / {fmt(trackDuration)}
              </div>
            </div>
            {/* Track progress */}
            <div className="h-[2px] w-full bg-[#F5E6C8]/10 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-[#C47A2C]/70 rounded-full transition-all duration-1000" style={{width:`${trackProgress}%`}}/>
            </div>
            {/* Album progress */}
            <div className="h-[1px] w-full bg-[#F5E6C8]/06 rounded-full overflow-hidden">
              <div className="h-full bg-[#F5E6C8]/20 rounded-full transition-all duration-1000" style={{width:`${albumProgress}%`}}/>
            </div>
            {nextTrack && <div className="mt-2 text-[9px] text-[#F5E6C8]/30">Next: {nextTrack.title}</div>}
          </div>
        ) : (
          <div className="mt-4 text-[10px] tracking-[0.3em] uppercase text-[#F5E6C8]/30">
            Waiting for showtime
          </div>
        )}
      </div>

      {/* ── Chat ── */}
      <div className="fixed bottom-5 right-5 z-30">
        {chatOpen ? (
          <div className="w-[320px] overflow-hidden rounded-sm border border-[#F5E6C8]/12 bg-black/55 backdrop-blur-md shadow-2xl">
            <div className="px-4 py-3 border-b border-[#F5E6C8]/08 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-[#F5E6C8] text-base">Chat</span>
                <span className="text-[9px] tracking-[0.25em] uppercase text-[#F5E6C8]/50">{isLive?"Live":"Lobby"}</span>
              </div>
              <button onClick={()=>setChatOpen(false)}
                className="text-[9px] tracking-[0.2em] uppercase text-[#F5E6C8]/40 hover:text-[#F5E6C8]/70 transition px-2 py-1 border border-[#F5E6C8]/10 rounded-sm">
                Min
              </button>
            </div>
            <div className="px-4 py-3 h-48 overflow-y-auto text-sm text-[#F5E6C8]/80 space-y-2">
              {messages.length===0 && <p className="text-[#F5E6C8]/25 text-xs text-center mt-6">No messages yet.</p>}
              {messages.map(msg=>(
                <div key={msg.id} className="group">
                  <span className="text-[#C47A2C] font-medium">{msg.display_name}:</span>{" "}
                  <span className="text-[#F5E6C8]/80">{msg.body}</span>
                </div>
              ))}
              <div ref={messagesEndRef}/>
            </div>
            <div className="p-3 border-t border-[#F5E6C8]/08 flex gap-2">
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&sendMessage()} disabled={!nameSet}
                className="flex-1 rounded-sm bg-black/30 border border-[#F5E6C8]/12 px-3 py-2 text-xs text-[#F5E6C8] outline-none placeholder:text-[#F5E6C8]/30 focus:border-[#C47A2C]/40 disabled:opacity-40"
                placeholder={nameSet?"Type...":"Set name first"}/>
              <button onClick={sendMessage} disabled={!nameSet||!chatInput.trim()}
                className="rounded-sm px-4 py-2 text-xs text-[#F5E6C8] disabled:opacity-40 transition hover:brightness-110"
                style={{background:"linear-gradient(to bottom,#6a2a14,#3a1508)",border:"1px solid rgba(196,122,44,0.3)"}}>
                Send
              </button>
            </div>
          </div>
        ) : (
          <button onClick={()=>setChatOpen(true)}
            className="flex items-center gap-3 rounded-full border border-[#F5E6C8]/12 bg-black/50 backdrop-blur-md px-4 py-3 hover:bg-black/60 transition shadow-xl">
            <span className="font-serif text-[#F5E6C8] text-sm">Chat</span>
            <span className="text-[9px] tracking-[0.2em] uppercase text-[#F5E6C8]/50">{isLive?"Live":"Lobby"}</span>
            {messages.length>0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#C47A2C]/80 text-[9px] text-black font-bold">
                {messages.length>99?"99+":messages.length}
              </span>
            )}
          </button>
        )}
      </div>

      <audio ref={audioRef}
        src="https://obnhrzehigtbadynicss.supabase.co/storage/v1/object/public/Albums/Lonerism.mp3"
        preload="auto" crossOrigin="anonymous"/>
    </main>
  );
}
