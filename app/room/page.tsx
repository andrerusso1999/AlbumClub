"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = { id: string; display_name: string; body: string; created_at: string; };
type Track   = { title: string; start: number; };

// ─── Tracklist ────────────────────────────────────────────────────────────────

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
const ALBUM_META = { title: "Lonerism", artist: "Tame Impala", year: "2012", cover: "" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentTrack(s: number) {
  let cur = TRACKS[0], idx = 0;
  for (let i = 0; i < TRACKS.length; i++) {
    if (s >= TRACKS[i].start) { cur = TRACKS[i]; idx = i; } else break;
  }
  return { track: cur, index: idx };
}
function fmt(s: number) { return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; }
function fmtTs(iso: string) { return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoomPage() {
  const audioRef       = useRef<HTMLAudioElement|null>(null);
  const msgEndRef      = useRef<HTMLDivElement|null>(null);

  const [startedAt, setStartedAt]         = useState<string|null>(null);
  const [isLive, setIsLive]               = useState(false);
  const [needleDrop, setNeedleDrop]       = useState(false);
  const [countdown, setCountdown]         = useState<number|null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [volume, setVolume]               = useState(0.8);
  const [showVolume, setShowVolume]       = useState(false);
  const [listenerCount, setListenerCount] = useState(1);

  // Chat
  const [chatOpen, setChatOpen]       = useState(true);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameInput, setNameInput]     = useState("");
  const [nameSet, setNameSet]         = useState(false);

  // Album cover
  const [coverUrl, setCoverUrl]       = useState<string>("");

  // ── Fetch album cover from Cover Art Archive ──────────────────────────────
  useEffect(() => {
    const cached = localStorage.getItem("ac_cover_lonerism");
    if (cached) { setCoverUrl(cached); return; }
    fetch("https://musicbrainz.org/ws/2/release/?query=lonerism+tame+impala&fmt=json&limit=3")
      .then(r => r.json()).then(data => {
        const mbid = data?.releases?.[0]?.id;
        if (!mbid) return;
        return fetch(`https://coverartarchive.org/release/${mbid}`).then(r => r.json());
      }).then((art: any) => {
        const url = art?.images?.find((i: any) => i.front)?.thumbnails?.large || art?.images?.[0]?.image;
        if (url) { setCoverUrl(url); localStorage.setItem("ac_cover_lonerism", url); }
      }).catch(() => {});
  }, []);

  // ── Simulated listener count (replace with Supabase Presence later) ───────
  useEffect(() => {
    const id = setInterval(() => setListenerCount(Math.floor(Math.random() * 3) + 2), 30000);
    return () => clearInterval(id);
  }, []);

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
    window.addEventListener("click", unlock, { once: true });
    return () => window.removeEventListener("click", unlock);
  }, []);

  // ── Volume ────────────────────────────────────────────────────────────────
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  // ── Needle drop ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) return;
    setNeedleDrop(true);
    const t = setTimeout(() => setNeedleDrop(false), 600);
    return () => clearTimeout(t);
  }, [isLive]);

  // ── Supabase ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("messages").select("*").eq("room_id","main").order("created_at",{ascending:true}).limit(100)
      .then(({data}) => { if (data) setMessages(data as Message[]); });

    supabase.from("room_state").select("*").eq("room_id","main").single()
      .then(({data}) => {
        if (!data?.started_at) return;
        setStartedAt(data.started_at);
        const sl = Math.ceil((new Date(data.started_at).getTime()-Date.now())/1000);
        if (sl>0) setCountdown(sl); else setIsLive(true);
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
          setIsLive(false); setCountdown(null); setStartedAt(null); setElapsed(0);
          if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime=0; }
        }
      }).subscribe();

    const msgCh = supabase.channel("messages-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"room_id=eq.main"},
        (p:any) => setMessages(prev=>[...prev,p.new as Message])).subscribe();

    return () => { supabase.removeChannel(roomCh); supabase.removeChannel(msgCh); };
  }, []);

  useEffect(() => {
    if (countdown===null) return;
    if (countdown<=0) { setCountdown(null); setIsLive(true); return; }
    const iv = setInterval(()=>setCountdown(p=>p!==null?p-1:null),1000);
    return ()=>clearInterval(iv);
  }, [countdown]);

  useEffect(() => {
    if (!startedAt||!audioUnlocked||!audioRef.current) return;
    const sp = Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000);
    audioRef.current.currentTime=sp;
    audioRef.current.play().catch(()=>{});
  }, [startedAt, audioUnlocked]);

  useEffect(() => {
    if (!isLive||!startedAt) return;
    const tick = ()=>setElapsed(Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000));
    tick();
    const id = setInterval(tick,1000);
    return ()=>clearInterval(id);
  }, [isLive, startedAt]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);

  // ── Actions ───────────────────────────────────────────────────────────────
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
    const body=chatInput.trim(); if (!body||!displayName) return;
    setChatInput("");
    await supabase.from("messages").insert({room_id:"main",display_name:displayName,body});
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const {track:cur, index:tIdx} = getCurrentTrack(elapsed);
  const next = TRACKS[tIdx+1]||null;
  const tElapsed  = elapsed - cur.start;
  const tDuration = next ? next.start-cur.start : ALBUM_DURATION-cur.start;
  const tProgress = Math.min(100,(tElapsed/tDuration)*100);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0806] text-[#F5E6C8]"
      style={{fontFamily:"'Georgia', 'Times New Roman', serif"}}>

      {/* ── Google Font: Playfair Display ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:wght@300;400;600&display=swap');
        .font-playfair { font-family: 'Playfair Display', Georgia, serif; }
        .font-cormorant { font-family: 'Cormorant Garamond', Georgia, serif; }
      `}</style>

      {/* ── Countdown overlay ── */}
      {countdown!==null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="font-playfair text-[16rem] text-[#F5E6C8]/90 leading-none" style={{textShadow:"0 0 80px rgba(196,122,44,0.4)"}}>{countdown}</div>
        </div>
      )}

      {/* ── Name prompt ── */}
      {!nameSet && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="rounded-2xl border border-[#C47A2C]/30 bg-black/70 p-10 w-88 text-center shadow-2xl" style={{maxWidth:"340px"}}>
            <div className="font-playfair text-3xl mb-2">Welcome</div>
            <div className="text-[10px] tracking-[0.4em] uppercase text-[#C47A2C] mb-6">AlbumClub · Russo&apos;s Lounge</div>
            <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveName()}
              className="w-full rounded-xl bg-black/40 border border-[#F5E6C8]/15 px-4 py-3 text-sm outline-none placeholder:text-[#F5E6C8]/30 focus:border-[#C47A2C]/50 mb-4 font-cormorant text-base"
              placeholder="Your name..." maxLength={24}/>
            <button onClick={saveName} className="w-full rounded-xl px-4 py-3 text-sm tracking-[0.3em] uppercase transition font-cormorant"
              style={{background:"linear-gradient(to bottom,#8a3a1a,#5a2010)",border:"1px solid #C47A2C",boxShadow:"0 0 20px rgba(196,122,44,0.2)"}}>
              Enter the Room
            </button>
          </div>
        </div>
      )}

      {/* ── Background photo ── */}
      <img src="/room-bg.jpg" alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{filter:isLive?"brightness(0.72)":"brightness(0.6)", transition:"filter 1.5s ease"}}/>

      {/* Cinematic vignette */}
      <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 40%, transparent 20%, rgba(0,0,0,0.7) 100%)"}}/>
      {/* Dark bottom for UI */}
      <div className="absolute bottom-0 left-0 right-0 h-48" style={{background:"linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)"}}/>

      {/* ── HEADER ── */}
      <header className="absolute top-0 left-0 right-0 z-20 px-8 py-5 flex items-start justify-between">
        <div>
          <div className="text-[9px] tracking-[0.5em] uppercase text-[#C47A2C]/80 mb-1">Now Playing</div>
          <div className="font-playfair text-2xl font-bold tracking-wide">AlbumClub</div>
        </div>
        <div className="flex items-center gap-5">
          {/* Listener count */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 border border-[#F5E6C8]/10">
            <div className={`w-1.5 h-1.5 rounded-full ${isLive?"bg-[#C47A2C]":"bg-[#F5E6C8]/30"}`}
              style={isLive?{boxShadow:"0 0 6px rgba(196,122,44,0.8)",animation:"pulse 2s infinite"}:{}}/>
            <span className="text-xs font-cormorant tracking-wider">{listenerCount} listening</span>
          </div>
          {/* Volume */}
          <div className="relative">
            <button onClick={()=>setShowVolume(v=>!v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 border border-[#F5E6C8]/10 hover:border-[#C47A2C]/30 transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                {volume>0&&<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>}
                {volume>0.5&&<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>}
              </svg>
              <span className="text-xs font-cormorant">{Math.round(volume*100)}%</span>
            </button>
            {showVolume && (
              <div className="absolute top-10 right-0 bg-black/80 border border-[#F5E6C8]/15 rounded-xl p-4 w-36 z-30 backdrop-blur-md">
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={e=>setVolume(parseFloat(e.target.value))}
                  className="w-full accent-[#C47A2C]"/>
                <div className="text-center text-xs text-[#F5E6C8]/50 mt-1 font-cormorant">{Math.round(volume*100)}%</div>
              </div>
            )}
          </div>
          {/* Showtime control */}
          <div className="text-right">
            <div className="text-[9px] tracking-[0.4em] uppercase text-[#F5E6C8]/50 mb-1">Showtime</div>
            <div className="font-cormorant text-lg">8:00 PM</div>
          </div>
          {isLive ? (
            <button onClick={stopShowtime}
              className="px-4 py-2 rounded-lg text-[10px] tracking-[0.3em] uppercase text-red-400 border border-red-500/30 bg-black/30 hover:bg-red-900/20 transition font-cormorant">
              End Session
            </button>
          ) : (
            <button onClick={triggerShowtime}
              className="px-4 py-2 rounded-lg text-[10px] tracking-[0.3em] uppercase border border-[#F5E6C8]/15 bg-black/30 hover:bg-black/50 transition font-cormorant">
              Start Showtime
            </button>
          )}
        </div>
      </header>

      {/* ── ALBUM INFO (left side) ── */}
      <div className="absolute left-8 z-20" style={{top:"50%",transform:"translateY(-50%)"}}>
        {/* Cover art */}
        <div className="relative mb-5" style={{width:"200px"}}>
          <div className="rounded-lg overflow-hidden shadow-2xl border border-[#F5E6C8]/10"
            style={{boxShadow:"0 20px 60px rgba(0,0,0,0.7), 0 0 30px rgba(196,122,44,0.1)"}}>
            {coverUrl ? (
              <img src={coverUrl} alt={ALBUM_META.title} className="w-full aspect-square object-cover"/>
            ) : (
              <div className="w-full aspect-square bg-gradient-to-br from-[#1a1a3a] to-[#0a0a1a] flex items-center justify-center">
                <div className="text-[#5a5aaa]/50 font-playfair text-4xl">L</div>
              </div>
            )}
          </div>
          {/* Cover shadow */}
          <div className="absolute -bottom-3 left-3 right-3 h-6 rounded-full opacity-40"
            style={{background:"radial-gradient(ellipse,rgba(0,0,0,0.8) 0%,transparent 70%)",filter:"blur(8px)"}}/>
        </div>

        {/* Album title — big bold */}
        <div style={{maxWidth:"200px"}}>
          <div className="font-playfair font-black text-3xl leading-none mb-2" style={{textShadow:"0 2px 20px rgba(0,0,0,0.8)"}}>
            {ALBUM_META.title}
          </div>
          <div className="font-cormorant text-lg text-[#C47A2C] tracking-wide mb-1">{ALBUM_META.artist}</div>
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#F5E6C8]/40 font-cormorant">{ALBUM_META.year}</div>
        </div>
      </div>

      {/* ── TURNTABLE (center) ── */}
      <div className="absolute left-1/2 -translate-x-1/2 z-20" style={{top:"18%",width:"260px"}}>
        <div className="relative rounded-xl border border-[#F5E6C8]/10 bg-black/50 backdrop-blur-sm p-6 shadow-2xl">
          {/* Vinyl */}
          <div className={`relative w-44 h-44 mx-auto rounded-full bg-black shadow-xl ${isLive?"animate-vinylSpin":""}`}>
            <div className="absolute inset-3 rounded-full border border-white/10"/>
            <div className="absolute inset-6 rounded-full border border-white/10"/>
            <div className="absolute inset-9 rounded-full border border-white/10"/>
            {/* Album art on label */}
            <div className="absolute inset-0 flex items-center justify-center">
              {coverUrl ? (
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-black/50">
                  <img src={coverUrl} alt="" className="w-full h-full object-cover"/>
                </div>
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#C47A2C]/80"/>
              )}
            </div>
            <div className={`vinyl-sheen ${isLive?"animate-vinylSheen":""}`}/>
          </div>
          {/* Tonearm */}
          <div className={`absolute right-4 top-4 pointer-events-none ${isLive?"tonearm-drop":""}`}>
            <div className="relative w-20 h-20">
              <div className="absolute right-0 top-0 w-14 h-14 rounded-full bg-[#F5E6C8]/10 border border-[#F5E6C8]/25"/>
              <div className="absolute right-3 top-3 w-7 h-7 rounded-full bg-[#F5E6C8]/12 border border-[#F5E6C8]/25"/>
              <div className="absolute right-[26px] top-[26px] origin-[100%_50%] rotate-[-70deg]">
                <div className="w-44 h-[5px] rounded-full bg-[#F5E6C8]/25 border border-[#F5E6C8]/15"/>
                <div className="absolute left-[-8px] top-[-2px] w-10 h-7 rounded-md bg-[#F5E6C8]/14 border border-[#F5E6C8]/20 rotate-[-10deg]"/>
                <div className="absolute left-[6px] top-[14px] w-2 h-2 rounded-full bg-[#C47A2C]/90"/>
                {needleDrop&&(
                  <div className="absolute left-[2px] top-[10px] w-5 h-5 needle-spark">
                    <div className="absolute inset-0 rounded-full bg-[#C47A2C]/35"/>
                    <div className="absolute left-1/2 top-1/2 w-1 h-5 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/45 rounded"/>
                    <div className="absolute left-1/2 top-1/2 h-1 w-5 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/45 rounded"/>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Track info below turntable */}
        {isLive ? (
          <div className="mt-4 rounded-xl border border-[#F5E6C8]/10 bg-black/50 backdrop-blur-sm px-5 py-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="text-[9px] tracking-[0.4em] uppercase text-[#C47A2C]/70 mb-1">Track {tIdx+1} / {TRACKS.length}</div>
                <div className="font-playfair text-base leading-tight">{cur.title}</div>
              </div>
              <div className="text-right text-xs font-cormorant text-[#F5E6C8]/50 shrink-0 ml-3">
                <div>{fmt(tElapsed)}</div>
                <div className="text-[#F5E6C8]/25">/ {fmt(tDuration)}</div>
              </div>
            </div>
            <div className="h-[1px] w-full bg-[#F5E6C8]/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#C47A2C]/60 rounded-full transition-all duration-1000" style={{width:`${tProgress}%`}}/>
            </div>
            {next&&<div className="mt-2 text-[10px] text-[#F5E6C8]/30 font-cormorant">Next — {next.title}</div>}
          </div>
        ) : (
          <div className="mt-4 text-center text-[10px] tracking-[0.4em] uppercase text-[#F5E6C8]/30 font-cormorant">
            Waiting for showtime
          </div>
        )}
      </div>

      {/* ── CHAT (right side, expandable) ── */}
      <div className={`absolute right-0 top-0 bottom-0 z-20 flex flex-col transition-all duration-300 ${chatExpanded?"w-[420px]":"w-[340px]"}`}
        style={{background:chatOpen?"linear-gradient(to left, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 100%)":"transparent",backdropFilter:chatOpen?"blur(8px)":"none"}}>

        {chatOpen ? (
          <div className="flex flex-col h-full pt-20 pb-4 px-5">
            {/* Chat header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-baseline gap-3">
                <div className="font-playfair text-xl">Chat</div>
                <div className="text-[9px] tracking-[0.4em] uppercase text-[#C47A2C]/70">{isLive?"Live":"Lobby"}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>setChatExpanded(e=>!e)}
                  className="px-2 py-1 rounded text-[9px] tracking-[0.3em] uppercase border border-[#F5E6C8]/15 bg-black/20 hover:bg-black/40 transition font-cormorant">
                  {chatExpanded?"Compact":"Expand"}
                </button>
                <button onClick={()=>setChatOpen(false)}
                  className="px-2 py-1 rounded text-[9px] tracking-[0.3em] uppercase border border-[#F5E6C8]/15 bg-black/20 hover:bg-black/40 transition font-cormorant">
                  Hide
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
              {messages.length===0&&(
                <p className="text-[#F5E6C8]/25 text-xs text-center mt-12 font-cormorant italic">The room is quiet. Say something.</p>
              )}
              {messages.map(msg=>(
                <div key={msg.id} className="group">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[#C47A2C] font-cormorant font-semibold text-sm shrink-0">{msg.display_name}</span>
                    <span className="text-[10px] text-[#F5E6C8]/20 opacity-0 group-hover:opacity-100 transition font-cormorant">{fmtTs(msg.created_at)}</span>
                  </div>
                  <div className="font-cormorant text-[#F5E6C8]/85 text-sm leading-relaxed">{msg.body}</div>
                </div>
              ))}
              <div ref={msgEndRef}/>
            </div>

            {/* Input */}
            <div className="mt-4 flex gap-2 border-t border-[#F5E6C8]/10 pt-4">
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&sendMessage()} disabled={!nameSet}
                className="flex-1 rounded-lg bg-black/30 border border-[#F5E6C8]/15 px-3 py-2.5 text-sm outline-none placeholder:text-[#F5E6C8]/25 focus:border-[#C47A2C]/40 disabled:opacity-40 font-cormorant"
                placeholder={nameSet?"Type a message...":"Set your name first…"}/>
              <button onClick={sendMessage} disabled={!nameSet||!chatInput.trim()}
                className="rounded-lg px-4 py-2.5 text-sm disabled:opacity-30 transition font-cormorant"
                style={{background:"linear-gradient(to bottom,#6b1f1f,#4a1510)",border:"1px solid #8a3020"}}>
                Send
              </button>
            </div>
          </div>
        ) : (
          /* Chat hidden — show pill */
          <button onClick={()=>setChatOpen(true)}
            className="absolute right-4 top-20 flex items-center gap-2 rounded-full border border-[#F5E6C8]/15 bg-black/50 backdrop-blur-md px-4 py-2.5 hover:bg-black/70 transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="font-cormorant text-sm">Chat</span>
            {messages.length>0&&(
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#C47A2C]/80 text-[9px] text-black font-bold">
                {messages.length>99?"99+":messages.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Live glow when session active ── */}
      {isLive&&(
        <div className="absolute inset-0 pointer-events-none z-10"
          style={{background:"radial-gradient(ellipse at 50% 60%, rgba(196,122,44,0.04) 0%, transparent 60%)", animation:"pulse 4s ease-in-out infinite"}}/>
      )}

      <audio ref={audioRef}
        src="https://obnhrzehigtbadynicss.supabase.co/storage/v1/object/public/Albums/Lonerism.mp3"
        preload="auto" crossOrigin="anonymous"/>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
      `}</style>
    </main>
  );
}
