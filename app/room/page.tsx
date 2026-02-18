"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef, useCallback } from "react";

type Message = { id: string; display_name: string; body: string; created_at: string; };
type Track   = { title: string; start: number; };

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
const ALBUM = { title: "Lonerism", artist: "Tame Impala", year: "2012", label: "Modular Recordings", genre: "Psychedelic Rock", tracks: 12 };

function getCurrentTrack(s: number) {
  let cur = TRACKS[0], idx = 0;
  for (let i = 0; i < TRACKS.length; i++) {
    if (s >= TRACKS[i].start) { cur = TRACKS[i]; idx = i; } else break;
  }
  return { track: cur, index: idx };
}
function fmt(s: number) { return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; }
function fmtTs(iso: string) { return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }

// Extract dominant color from image using canvas
function extractColor(imgUrl: string, cb: (r:number,g:number,b:number)=>void) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 50; canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, 50, 50);
    const data = ctx.getImageData(0, 0, 50, 50).data;
    let r=0, g=0, b=0, count=0;
    for (let i=0; i<data.length; i+=16) {
      r+=data[i]; g+=data[i+1]; b+=data[i+2]; count++;
    }
    cb(Math.floor(r/count), Math.floor(g/count), Math.floor(b/count));
  };
  img.src = imgUrl;
}

export default function RoomPage() {
  const audioRef    = useRef<HTMLAudioElement|null>(null);
  const msgEndRef   = useRef<HTMLDivElement|null>(null);
  const crackleRef  = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode; gain: GainNode } | null>(null);

  const [startedAt, setStartedAt]         = useState<string|null>(null);
  const [isLive, setIsLive]               = useState(false);
  const [needleDrop, setNeedleDrop]       = useState(false);
  const [countdown, setCountdown]         = useState<number|null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [volume, setVolume]               = useState(0.8);
  const [showVolume, setShowVolume]       = useState(false);
  const [listenerCount]                   = useState(2);
  const [coverUrl, setCoverUrl]           = useState("");
  const [dominantColor, setDominantColor] = useState<[number,number,number]>([80,50,20]);
  const [crackleOn, setCrackleOn]         = useState(false);
  const [vinylSlide, setVinylSlide]       = useState(false); // trigger slide animation

  const [chatOpen, setChatOpen]       = useState(true);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameInput, setNameInput]     = useState("");
  const [nameSet, setNameSet]         = useState(false);

  // ── Cover art + dominant color ────────────────────────────────────────────
  useEffect(() => {
    const cached = localStorage.getItem("ac_cover_lonerism");
    if (cached) {
      setCoverUrl(cached);
      extractColor(cached, (r,g,b) => setDominantColor([r,g,b]));
      return;
    }
    fetch("https://musicbrainz.org/ws/2/release/?query=lonerism+tame+impala&fmt=json&limit=3")
      .then(r=>r.json()).then(d=>{
        const mbid = d?.releases?.[0]?.id;
        if (!mbid) return;
        return fetch(`https://coverartarchive.org/release/${mbid}`).then(r=>r.json());
      }).then((art:any)=>{
        const url = art?.images?.find((i:any)=>i.front)?.thumbnails?.large||art?.images?.[0]?.image||"";
        if (url) {
          setCoverUrl(url);
          localStorage.setItem("ac_cover_lonerism", url);
          extractColor(url, (r,g,b) => setDominantColor([r,g,b]));
        }
      }).catch(()=>{});
  },[]);

  // ── Vinyl crackle via Web Audio API ──────────────────────────────────────
  const startCrackle = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const bufferSize = ctx.sampleRate * 3;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        // Sparse random clicks + low continuous hiss
        const click = Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 0.6 : 0;
        const hiss  = (Math.random() * 2 - 1) * 0.012;
        data[i] = click + hiss;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.18;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      crackleRef.current = { ctx, source, gain };
    } catch {}
  }, []);

  const stopCrackle = useCallback(() => {
    if (crackleRef.current) {
      try {
        crackleRef.current.source.stop();
        crackleRef.current.ctx.close();
      } catch {}
      crackleRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (crackleOn && isLive) startCrackle();
    else stopCrackle();
    return () => stopCrackle();
  }, [crackleOn, isLive, startCrackle, stopCrackle]);

  // ── Display name ──────────────────────────────────────────────────────────
  useEffect(() => {
    const s = localStorage.getItem("ac_display_name");
    if (s) { setDisplayName(s); setNameSet(true); }
  }, []);

  // ── Audio unlock ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unlock = async () => {
      if (!audioRef.current) return;
      try { await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime=0; setAudioUnlocked(true); } catch {}
    };
    window.addEventListener("click", unlock, {once:true});
    return () => window.removeEventListener("click", unlock);
  }, []);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  useEffect(() => {
    if (!isLive) return;
    setNeedleDrop(true);
    setVinylSlide(true);
    const t = setTimeout(() => setNeedleDrop(false), 600);
    return () => clearTimeout(t);
  }, [isLive]);

  // ── Supabase ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("messages").select("*").eq("room_id","main").order("created_at",{ascending:true}).limit(100)
      .then(({data}) => { if(data) setMessages(data as Message[]); });
    supabase.from("room_state").select("*").eq("room_id","main").single()
      .then(({data}) => {
        if (!data?.started_at) return;
        setStartedAt(data.started_at);
        const sl = Math.ceil((new Date(data.started_at).getTime()-Date.now())/1000);
        if (sl>0) setCountdown(sl); else { setIsLive(true); setVinylSlide(true); }
      });
    const roomCh = supabase.channel("room-state")
      .on("postgres_changes",{event:"*",schema:"public",table:"room_state"},(p:any) => {
        const row = p.new as {is_live?:boolean;started_at?:string};
        if (row?.started_at) {
          setStartedAt(row.started_at);
          const sl = Math.ceil((new Date(row.started_at).getTime()-Date.now())/1000);
          if (sl>0) setCountdown(sl); else { setCountdown(null); setIsLive(true); }
        }
        if (row?.is_live===false) {
          setIsLive(false); setCountdown(null); setStartedAt(null); setElapsed(0); setVinylSlide(false);
          if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime=0; }
        }
      }).subscribe();
    const msgCh = supabase.channel("messages-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"room_id=eq.main"},
        (p:any) => setMessages(prev=>[...prev, p.new as Message])).subscribe();
    return () => { supabase.removeChannel(roomCh); supabase.removeChannel(msgCh); };
  }, []);

  useEffect(() => {
    if (countdown===null) return;
    if (countdown<=0) { setCountdown(null); setIsLive(true); return; }
    const iv = setInterval(() => setCountdown(p=>p!==null?p-1:null), 1000);
    return () => clearInterval(iv);
  }, [countdown]);

  useEffect(() => {
    if (!startedAt||!audioUnlocked||!audioRef.current) return;
    const sp = Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000);
    audioRef.current.currentTime = sp;
    audioRef.current.play().catch(()=>{});
  }, [startedAt, audioUnlocked]);

  useEffect(() => {
    if (!isLive||!startedAt) return;
    const tick = () => setElapsed(Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isLive, startedAt]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);

  const saveName = () => {
    const n = nameInput.trim(); if (!n) return;
    localStorage.setItem("ac_display_name",n); setDisplayName(n); setNameSet(true);
  };
  const triggerShowtime = async () => {
    if (audioRef.current) { try { await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime=0; setAudioUnlocked(true); } catch {} }
    await supabase.from("room_state").update({is_live:true,started_at:new Date(Date.now()+5000).toISOString()}).eq("room_id","main");
  };
  const stopShowtime = async () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime=0; }
    await supabase.from("room_state").update({is_live:false,started_at:null}).eq("room_id","main");
  };
  const sendMessage = async () => {
    const body = chatInput.trim(); if (!body||!displayName) return;
    setChatInput("");
    await supabase.from("messages").insert({room_id:"main",display_name:displayName,body});
  };

  const {track:cur, index:tIdx} = getCurrentTrack(elapsed);
  const next = TRACKS[tIdx+1]||null;
  const tElapsed   = elapsed - cur.start;
  const tDuration  = next ? next.start-cur.start : ALBUM_DURATION-cur.start;
  const tProgress  = Math.min(100,(tElapsed/tDuration)*100);

  // Tonearm: clamped between -32deg (outer groove) and 8deg (inner groove), never outside record
  const tonearmAngle = isLive
    ? Math.min(8, -32 + (elapsed / ALBUM_DURATION) * 40)
    : -38;

  const [r,g,b] = dominantColor;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060402] text-[#F5E6C8]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&display=swap');
        .font-playfair  { font-family:'Playfair Display',Georgia,serif; }
        .font-cormorant { font-family:'Cormorant Garamond',Georgia,serif; }

        @keyframes vinylSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .vinyl-spin { animation: vinylSpin 1.8s linear infinite; }

        @keyframes vinylSheen { 0%{transform:rotate(0deg);opacity:.22} 50%{opacity:.07} 100%{transform:rotate(360deg);opacity:.22} }
        .vinyl-sheen {
          position:absolute;inset:0;border-radius:9999px;
          background:conic-gradient(from 0deg,rgba(255,255,255,.16),rgba(255,255,255,0) 35%,rgba(255,255,255,.07) 55%,rgba(255,255,255,0) 75%,rgba(255,255,255,.13));
          mix-blend-mode:screen;pointer-events:none;
        }
        .vinyl-sheen.spinning { animation: vinylSheen 1.8s linear infinite; }

        @keyframes softPulse { 0%,100%{opacity:.55} 50%{opacity:1} }
        @keyframes needleSpark { 0%{transform:scale(.5);opacity:0} 25%{transform:scale(1);opacity:1} 100%{transform:scale(1.8);opacity:0} }
        .needle-spark { animation: needleSpark 500ms ease-out both; }

        /* Vinyl slide: cover art position → turntable */
        @keyframes vinylSlideIn {
          0%   { transform: translate(-520px, 180px) scale(0.55) rotate(-8deg); opacity:0; }
          30%  { opacity: 1; }
          100% { transform: translate(0,0) scale(1) rotate(0deg); opacity:1; }
        }
        .vinyl-slide-in { animation: vinylSlideIn 1.2s cubic-bezier(0.22,1,0.36,1) both; }

        input[type=range].vol-slider { -webkit-appearance:none; background:rgba(245,230,200,.12); border-radius:4px; height:3px; }
        input[type=range].vol-slider::-webkit-slider-thumb { -webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#C47A2C;cursor:pointer; }
      `}</style>

      {/* ── AMBIENT COLOR WASH from album cover ── */}
      <div className="absolute inset-0 pointer-events-none z-0 transition-all duration-[3000ms]"
        style={{background:`radial-gradient(ellipse at 30% 40%, rgba(${r},${g},${b},0.28) 0%, transparent 55%), radial-gradient(ellipse at 70% 70%, rgba(${r},${g},${b},0.14) 0%, transparent 50%)`}}/>

      {/* Countdown */}
      {countdown!==null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="font-playfair text-[14rem] leading-none"
            style={{color:`rgba(${r},${g},${b},0.9)`,textShadow:`0 0 120px rgba(${r},${g},${b},0.6), 0 0 40px rgba(0,0,0,0.8)`}}>
            {countdown}
          </div>
        </div>
      )}

      {/* Name prompt */}
      {!nameSet && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="rounded-2xl border border-white/10 bg-black/75 p-10 text-center shadow-2xl" style={{maxWidth:"360px",borderColor:`rgba(${r},${g},${b},0.3)`}}>
            <div className="font-playfair text-4xl font-bold mb-1">Welcome</div>
            <div className="text-[11px] tracking-[0.5em] uppercase mb-8 font-cormorant" style={{color:`rgba(${r+50},${g+30},${b+10},0.8)`}}>AlbumClub · Russo's Lounge</div>
            <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveName()}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-lg outline-none placeholder:text-white/20 focus:border-white/25 mb-4 font-cormorant"
              placeholder="Your name..." maxLength={24}/>
            <button onClick={saveName}
              className="w-full rounded-lg px-4 py-3 font-cormorant text-lg tracking-[0.3em] uppercase"
              style={{background:`linear-gradient(to bottom, rgba(${r},${g},${b},0.7), rgba(${Math.floor(r*0.6)},${Math.floor(g*0.6)},${Math.floor(b*0.6)},0.8))`,border:`1px solid rgba(${r},${g},${b},0.4)`,boxShadow:`0 0 30px rgba(${r},${g},${b},0.25)`}}>
              Enter the Room
            </button>
          </div>
        </div>
      )}

      {/* Background */}
      <img src="/room-bg.jpg" alt=""
        className="absolute inset-0 w-full h-full object-cover z-0"
        style={{filter:`brightness(${isLive?0.72:0.52})`, transition:"filter 2s ease"}}/>
      <div className="absolute inset-0 z-[1]" style={{background:"radial-gradient(ellipse at 50% 40%,transparent 10%,rgba(0,0,0,0.6) 100%)"}}/>
      <div className="absolute bottom-0 left-0 right-0 h-72 z-[1]" style={{background:"linear-gradient(to top,rgba(0,0,0,0.96) 0%,transparent 100%)"}}/>
      {isLive && <div className="absolute inset-0 z-[1] pointer-events-none transition-all duration-[3000ms]"
        style={{background:`radial-gradient(ellipse at 50% 55%, rgba(${r},${g},${b},0.07) 0%, transparent 60%)`, animation:"softPulse 5s ease-in-out infinite"}}/>}

      {/* ── HEADER ── */}
      <header className="absolute top-0 left-0 right-0 z-20 px-8 py-5 flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.55em] uppercase font-cormorant mb-0.5" style={{color:`rgba(${r+60},${g+40},${b+10},0.75)`}}>Now Playing</div>
          <div className="font-playfair font-black text-3xl tracking-wide">AlbumClub</div>
        </div>
        <div className="flex items-center gap-4">
          {/* Listeners */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full" style={isLive?{background:`rgb(${r},${g},${b})`,boxShadow:`0 0 7px rgba(${r},${g},${b},0.9)`,animation:"softPulse 2s infinite"}:{background:"rgba(255,255,255,0.2)"}}/>
            <span className="font-cormorant text-base">{listenerCount} listening</span>
          </div>
          {/* Volume */}
          <div className="relative">
            <button onClick={()=>setShowVolume(v=>!v)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 border border-white/10 hover:border-white/20 transition backdrop-blur-sm">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                {volume>0&&<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>}
                {volume>0.5&&<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>}
              </svg>
              <span className="font-cormorant text-base">{Math.round(volume*100)}%</span>
            </button>
            {showVolume && (
              <div className="absolute top-12 right-0 bg-black/90 border border-white/10 rounded-xl p-4 w-44 z-30 backdrop-blur-xl">
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={e=>setVolume(parseFloat(e.target.value))} className="vol-slider w-full"/>
                <div className="text-center font-cormorant text-base text-white/40 mt-2">{Math.round(volume*100)}%</div>
              </div>
            )}
          </div>
          {/* Vinyl crackle toggle */}
          <button onClick={()=>setCrackleOn(v=>!v)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 backdrop-blur-sm transition"
            style={{background:crackleOn?`rgba(${r},${g},${b},0.25)`:"rgba(0,0,0,0.4)",borderColor:crackleOn?`rgba(${r},${g},${b},0.4)`:"rgba(255,255,255,0.1)"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
            <span className="font-cormorant text-base">{crackleOn?"Crackle On":"Crackle"}</span>
          </button>
          {/* Showtime */}
          <div className="text-right">
            <div className="text-[10px] tracking-[0.4em] uppercase text-white/35 font-cormorant">Showtime</div>
            <div className="font-cormorant text-xl">8:00 PM</div>
          </div>
          {isLive ? (
            <button onClick={stopShowtime}
              className="px-5 py-2 rounded-lg text-sm tracking-[0.3em] uppercase text-red-400 border border-red-500/30 bg-black/40 hover:bg-red-900/20 transition font-cormorant backdrop-blur-sm">
              End Session
            </button>
          ) : (
            <button onClick={triggerShowtime}
              className="px-5 py-2 rounded-lg text-sm tracking-[0.3em] uppercase border border-white/15 bg-black/40 hover:bg-black/60 transition font-cormorant backdrop-blur-sm">
              Start Showtime
            </button>
          )}
        </div>
      </header>

      {/* ── ALBUM INFO — LEFT ── */}
      <div className="absolute left-8 z-20" style={{top:"13%", maxWidth:"260px"}}>
        {/* Cover with glow */}
        <div className="relative mb-6">
          <div className="absolute -inset-6 rounded-2xl pointer-events-none transition-all duration-[2000ms]"
            style={{background:`radial-gradient(ellipse, rgba(${r},${g},${b},0.45) 0%, transparent 70%)`,filter:"blur(20px)"}}/>
          <div className="absolute -inset-2 rounded-xl pointer-events-none"
            style={{boxShadow:`0 30px 90px rgba(0,0,0,0.85), 0 0 60px rgba(${r},${g},${b},0.2)`}}/>
          {coverUrl ? (
            <img src={coverUrl} alt={ALBUM.title}
              className="relative rounded-xl w-full shadow-2xl"
              style={{border:"1px solid rgba(255,255,255,0.1)",boxShadow:`0 35px 90px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)`}}/>
          ) : (
            <div className="relative rounded-xl aspect-square flex items-center justify-center border border-white/8"
              style={{background:`linear-gradient(135deg, rgba(${r},${g},${b},0.3), rgba(0,0,0,0.8))`,boxShadow:"0 30px 80px rgba(0,0,0,0.85)"}}>
              <div className="font-playfair text-7xl text-white/15">L</div>
            </div>
          )}
        </div>

        {/* Title — big */}
        <div className="font-playfair font-black text-5xl leading-none mb-2"
          style={{textShadow:"0 2px 40px rgba(0,0,0,0.95)"}}>
          {ALBUM.title}
        </div>
        <div className="font-playfair italic text-2xl mb-4" style={{color:`rgba(${Math.min(r+80,255)},${Math.min(g+60,255)},${Math.min(b+30,255)},0.9)`}}>
          {ALBUM.artist}
        </div>

        {/* Meta */}
        <div className="space-y-2 font-cormorant text-base">
          {[["Year",ALBUM.year],["Label",ALBUM.label],["Genre",ALBUM.genre],["Tracks",`${ALBUM.tracks} tracks`]].map(([k,v])=>(
            <div key={k} className="flex items-center gap-3">
              <span className="text-[10px] tracking-[0.4em] uppercase text-white/25 w-14 shrink-0">{k}</span>
              <span className="text-white/65">{v}</span>
            </div>
          ))}
        </div>

        {isLive && (
          <div className="mt-5 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{background:`rgb(${r},${g},${b})`,boxShadow:`0 0 9px rgba(${r},${g},${b},1)`,animation:"softPulse 1.5s infinite"}}/>
            <span className="font-cormorant text-base tracking-[0.35em] uppercase" style={{color:`rgba(${Math.min(r+60,255)},${Math.min(g+40,255)},${Math.min(b+10,255)},0.9)`}}>Live Now</span>
          </div>
        )}
      </div>

      {/* ── TURNTABLE — CENTER ── */}
      <div className="absolute left-1/2 -translate-x-1/2 z-20" style={{top:"12%", width:"340px"}}>

        {/* Turntable body */}
        <div className="relative rounded-2xl overflow-visible"
          style={{
            background:"linear-gradient(145deg, #1e1208 0%, #120b04 50%, #1c1006 100%)",
            border:"1px solid rgba(255,255,255,0.07)",
            boxShadow:"0 35px 90px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.05)",
            padding:"30px 30px 22px",
          }}>

          {/* Platter area */}
          <div className="relative mx-auto" style={{width:"240px",height:"240px"}}>
            {/* Platter outer */}
            <div className="absolute inset-0 rounded-full"
              style={{background:"linear-gradient(145deg,#2c1c0a,#1a0e04)",border:"2px solid rgba(255,255,255,0.05)",boxShadow:"inset 0 3px 10px rgba(0,0,0,0.9), 0 0 0 1px rgba(0,0,0,0.6)"}}/>
            {/* Felt mat */}
            <div className="absolute inset-[6px] rounded-full"
              style={{background:"radial-gradient(circle at 40% 35%, #1a1a1a, #0e0e0e)",border:"1px solid rgba(255,255,255,0.03)"}}/>

            {/* Vinyl record — with slide animation on first go-live */}
            <div className={`absolute inset-[10px] rounded-full ${isLive?"vinyl-spin":""} ${vinylSlide&&isLive?"vinyl-slide-in":""}`}
              style={{background:"radial-gradient(circle at 50% 50%, #1c1c1c 0%, #0c0c0c 60%, #141414 100%)"}}>
              {[14,22,30,38,46,54,62,70,78,86].map(r2=>(
                <div key={r2} className="absolute rounded-full border border-white/[0.028]" style={{inset:`${r2/2}%`}}/>
              ))}
              {/* Label */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-20 h-20 rounded-full overflow-hidden flex items-center justify-center"
                  style={{border:"1px solid rgba(255,255,255,0.08)",boxShadow:"inset 0 2px 8px rgba(0,0,0,0.7)"}}>
                  {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-75"/>}
                  <div className="relative w-3 h-3 rounded-full bg-[#0a0a0a] z-10" style={{boxShadow:"inset 0 1px 3px rgba(0,0,0,0.9)"}}/>
                </div>
              </div>
              <div className={`vinyl-sheen ${isLive?"spinning":""}`}/>
            </div>

            {/* Spindle */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full z-20"
              style={{background:"linear-gradient(145deg,#999,#555)",boxShadow:"0 1px 4px rgba(0,0,0,0.9)"}}/>

            {/* ── Tonearm ── */}
            <div className="absolute z-30" style={{right:"-22px",top:"-18px"}}>
              <div className="relative" style={{width:"60px",height:"60px"}}>
                {/* Bearing housing */}
                <div className="absolute inset-0 rounded-full"
                  style={{background:"linear-gradient(145deg,#3c2c1a,#1c1208)",border:"1px solid rgba(255,255,255,0.1)",boxShadow:"0 5px 15px rgba(0,0,0,0.85)"}}>
                  <div className="absolute inset-[6px] rounded-full"
                    style={{background:"linear-gradient(145deg,#2c200e,#160e04)",border:"1px solid rgba(255,255,255,0.05)"}}/>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full"
                      style={{background:"linear-gradient(145deg,#777,#3a3a3a)",boxShadow:"0 2px 8px rgba(0,0,0,0.9),inset 0 1px 2px rgba(255,255,255,0.15)"}}/>
                  </div>
                </div>

                {/* Arm — rotates with tonearmAngle */}
                <div className="absolute z-10"
                  style={{right:"24px",top:"24px",transformOrigin:"100% 50%",
                    transform:`rotate(${tonearmAngle}deg)`,
                    transition:isLive?"transform 12s linear":"transform 0.6s ease",
                  }}>
                  <div style={{width:"200px",height:"7px",marginTop:"-3.5px",position:"relative"}}>
                    {/* Tube */}
                    <div className="absolute inset-0 rounded-full"
                      style={{background:"linear-gradient(to bottom,rgba(255,255,255,0.18),rgba(255,255,255,0.04) 40%,rgba(0,0,0,0.35))",border:"1px solid rgba(255,255,255,0.09)",boxShadow:"0 2px 10px rgba(0,0,0,0.7)"}}/>
                    {/* Headshell */}
                    <div className="absolute rotate-[-14deg]"
                      style={{left:"-30px",top:"50%",transform:"translateY(-50%) rotate(-14deg)",width:"30px",height:"20px",background:"linear-gradient(145deg,#5a5a5a,#2a2a2a)",borderRadius:"3px",border:"1px solid rgba(255,255,255,0.1)",boxShadow:"0 3px 12px rgba(0,0,0,0.8)"}}>
                      {/* Cartridge body */}
                      <div className="absolute bottom-[-3px] left-[6px]"
                        style={{width:"12px",height:"9px",background:"linear-gradient(145deg,#3a3a3a,#111)",borderRadius:"1px",border:"1px solid rgba(255,255,255,0.07)"}}>
                        {/* Cantilever */}
                        <div style={{position:"absolute",left:"5px",bottom:"-7px",width:"2px",height:"8px",background:"linear-gradient(to bottom,#aaa,#555)",borderRadius:"0 0 1px 1px"}}/>
                        {/* Stylus diamond */}
                        <div style={{position:"absolute",left:"3.5px",bottom:"-12px",width:"3px",height:"3px",borderRadius:"50%",background:`rgb(${r},${g},${b})`,boxShadow:`0 0 5px rgba(${r},${g},${b},0.9)`}}/>
                      </div>
                    </div>
                    {/* Counterweight */}
                    <div className="absolute right-[-4px] top-1/2 -translate-y-1/2"
                      style={{width:"12px",height:"12px",borderRadius:"50%",background:"linear-gradient(145deg,#888,#444)",border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 2px 8px rgba(0,0,0,0.8)"}}/>
                    {/* Anti-skate arm */}
                    <div className="absolute" style={{right:"18px",top:"-6px",width:"24px",height:"2px",background:"rgba(255,255,255,0.1)",borderRadius:"1px",transform:"rotate(-15deg)"}}>
                      <div style={{position:"absolute",right:0,top:"-2px",width:"5px",height:"5px",borderRadius:"50%",background:"linear-gradient(145deg,#666,#333)"}}/>
                    </div>
                  </div>
                </div>

                {/* Cueing lever */}
                <div className="absolute" style={{bottom:"-4px",right:"-2px",width:"8px",height:"16px",background:"linear-gradient(145deg,#555,#222)",borderRadius:"4px 4px 2px 2px",border:"1px solid rgba(255,255,255,0.07)"}}/>
              </div>
            </div>

            {needleDrop && (
              <div className="absolute left-[38%] top-[38%] w-7 h-7 needle-spark z-40">
                <div className="absolute inset-0 rounded-full" style={{background:`rgba(${r},${g},${b},0.3)`}}/>
                <div className="absolute left-1/2 top-1/2 w-0.5 h-7 -translate-x-1/2 -translate-y-1/2 rounded" style={{background:`rgba(${r},${g},${b},0.5)`}}/>
                <div className="absolute left-1/2 top-1/2 h-0.5 w-7 -translate-x-1/2 -translate-y-1/2 rounded" style={{background:`rgba(${r},${g},${b},0.5)`}}/>
              </div>
            )}
          </div>

          {/* Plinth details row */}
          <div className="flex justify-between items-center mt-4 px-1">
            <div className="flex items-center gap-3">
              {["33⅓","45"].map((s,i)=>(
                <div key={s} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border"
                    style={i===0?{background:`rgb(${r},${g},${b})`,borderColor:`rgb(${r},${g},${b})`,boxShadow:`0 0 7px rgba(${r},${g},${b},0.7)`}:{borderColor:"rgba(255,255,255,0.18)",background:"transparent"}}/>
                  <span className="font-cormorant text-sm text-white/35">{s}</span>
                </div>
              ))}
            </div>
            {/* On indicator */}
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={isLive?{background:"#4ade80",boxShadow:"0 0 7px rgba(74,222,128,0.9)"}:{background:"rgba(255,255,255,0.12)"}}/>
              <span className="font-cormorant text-sm text-white/30">{isLive?"ON":"STBY"}</span>
            </div>
          </div>
        </div>

        {/* Track info */}
        {isLive ? (
          <div className="mt-5 rounded-xl border border-white/8 bg-black/60 backdrop-blur-md px-6 py-5"
            style={{boxShadow:`0 10px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(${r},${g},${b},0.08)`}}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="font-cormorant text-xs tracking-[0.45em] uppercase mb-2" style={{color:`rgba(${Math.min(r+60,255)},${Math.min(g+40,255)},${Math.min(b+10,255)},0.65)`}}>
                  Track {tIdx+1} of {TRACKS.length}
                </div>
                <div className="font-playfair text-xl font-bold leading-tight">{cur.title}</div>
              </div>
              <div className="text-right font-cormorant text-base text-white/40 shrink-0 ml-4">
                <div>{fmt(tElapsed)}</div>
                <div className="text-white/20">/ {fmt(tDuration)}</div>
              </div>
            </div>
            <div className="h-[1px] bg-white/8 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000"
                style={{width:`${tProgress}%`,background:`linear-gradient(to right, rgba(${r},${g},${b},0.5), rgba(${r},${g},${b},0.85))`}}/>
            </div>
            {next && <div className="mt-2.5 font-cormorant text-sm text-white/25">Up next — {next.title}</div>}
          </div>
        ) : (
          <div className="mt-5 text-center font-cormorant text-base tracking-[0.4em] uppercase text-white/20">
            Waiting for showtime
          </div>
        )}
      </div>

      {/* ── CHAT — RIGHT ── */}
      <div className={`absolute right-0 top-0 bottom-0 z-20 transition-all duration-300 ${chatExpanded?"w-[420px]":"w-[340px]"}`}>
        {chatOpen ? (
          <div className="flex flex-col h-full"
            style={{background:"linear-gradient(to left,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0.55) 100%)",backdropFilter:"blur(12px)"}}>
            <div className="flex flex-col h-full pt-20 pb-4 px-6 min-h-0">
              <div className="flex items-center justify-between mb-5 shrink-0">
                <div className="flex items-baseline gap-3">
                  <div className="font-playfair text-2xl font-bold">Chat</div>
                  <div className="font-cormorant text-xs tracking-[0.45em] uppercase text-white/45">{isLive?"Live":"Lobby"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={()=>setChatExpanded(e=>!e)}
                    className="px-3 py-1 rounded font-cormorant text-sm tracking-[0.25em] uppercase border border-white/10 bg-black/20 hover:bg-black/40 transition">
                    {chatExpanded?"↙":"↗"}
                  </button>
                  <button onClick={()=>setChatOpen(false)}
                    className="px-3 py-1 rounded font-cormorant text-sm border border-white/10 bg-black/20 hover:bg-black/40 transition">✕</button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
                {messages.length===0 && (
                  <p className="font-cormorant italic text-white/20 text-center text-base mt-16">
                    The room is quiet.<br/>Say something.
                  </p>
                )}
                {messages.map(msg=>(
                  <div key={msg.id} className="group">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-cormorant font-semibold text-base shrink-0" style={{color:`rgba(${Math.min(r+80,255)},${Math.min(g+60,255)},${Math.min(b+20,255)},0.9)`}}>{msg.display_name}</span>
                      <span className="font-cormorant text-xs text-white/15 opacity-0 group-hover:opacity-100 transition">{fmtTs(msg.created_at)}</span>
                    </div>
                    <div className="font-cormorant text-[#F5E6C8]/80 text-base leading-snug">{msg.body}</div>
                  </div>
                ))}
                <div ref={msgEndRef}/>
              </div>

              <div className="shrink-0 mt-4 pt-4 border-t border-white/8 flex gap-2">
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&sendMessage()} disabled={!nameSet}
                  className="flex-1 rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-base outline-none placeholder:text-white/20 focus:border-white/20 disabled:opacity-25 font-cormorant"
                  placeholder={nameSet?"Say something...":"Enter your name first…"}/>
                <button onClick={sendMessage} disabled={!nameSet||!chatInput.trim()}
                  className="rounded-lg px-5 py-3 font-cormorant text-base disabled:opacity-20 transition"
                  style={{background:"linear-gradient(to bottom,#5a1a1a,#321010)",border:"1px solid rgba(180,60,60,0.3)"}}>
                  Send
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={()=>setChatOpen(true)}
            className="absolute right-4 top-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/55 backdrop-blur-md px-4 py-2.5 hover:bg-black/75 transition">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="font-cormorant text-base">Chat</span>
            {messages.length>0 && (
              <span className="w-5 h-5 rounded-full bg-white/20 text-[10px] flex items-center justify-center">{messages.length}</span>
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
