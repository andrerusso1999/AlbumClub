"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef } from "react";

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

export default function RoomPage() {
  const audioRef    = useRef<HTMLAudioElement|null>(null);
  const msgEndRef   = useRef<HTMLDivElement|null>(null);

  const [startedAt, setStartedAt]         = useState<string|null>(null);
  const [isLive, setIsLive]               = useState(false);
  const [needleDrop, setNeedleDrop]       = useState(false);
  const [countdown, setCountdown]         = useState<number|null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [volume, setVolume]               = useState(0.8);
  const [showVolume, setShowVolume]       = useState(false);
  const [listenerCount, setListenerCount] = useState(2);
  const [coverUrl, setCoverUrl]           = useState("");

  const [chatOpen, setChatOpen]           = useState(true);
  const [chatExpanded, setChatExpanded]   = useState(false);
  const [messages, setMessages]           = useState<Message[]>([]);
  const [chatInput, setChatInput]         = useState("");
  const [displayName, setDisplayName]     = useState("");
  const [nameInput, setNameInput]         = useState("");
  const [nameSet, setNameSet]             = useState(false);

  // Cover art
  useEffect(() => {
    const cached = localStorage.getItem("ac_cover_lonerism");
    if (cached) { setCoverUrl(cached); return; }
    fetch("https://musicbrainz.org/ws/2/release/?query=lonerism+tame+impala&fmt=json&limit=3")
      .then(r=>r.json()).then(d=>{
        const mbid = d?.releases?.[0]?.id;
        if (!mbid) return;
        return fetch(`https://coverartarchive.org/release/${mbid}`).then(r=>r.json());
      }).then((art:any)=>{
        const url = art?.images?.find((i:any)=>i.front)?.thumbnails?.large||art?.images?.[0]?.image||"";
        if (url) { setCoverUrl(url); localStorage.setItem("ac_cover_lonerism",url); }
      }).catch(()=>{});
  },[]);

  useEffect(() => { const s=localStorage.getItem("ac_display_name"); if(s){setDisplayName(s);setNameSet(true);} },[]);

  useEffect(() => {
    const unlock = async () => {
      if (!audioRef.current) return;
      try { await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime=0; setAudioUnlocked(true); } catch {}
    };
    window.addEventListener("click",unlock,{once:true});
    return ()=>window.removeEventListener("click",unlock);
  },[]);

  useEffect(()=>{ if(audioRef.current) audioRef.current.volume=volume; },[volume]);

  useEffect(()=>{
    if(!isLive)return;
    setNeedleDrop(true);
    const t=setTimeout(()=>setNeedleDrop(false),600);
    return ()=>clearTimeout(t);
  },[isLive]);

  useEffect(()=>{
    supabase.from("messages").select("*").eq("room_id","main").order("created_at",{ascending:true}).limit(100)
      .then(({data})=>{ if(data) setMessages(data as Message[]); });
    supabase.from("room_state").select("*").eq("room_id","main").single()
      .then(({data})=>{
        if(!data?.started_at)return;
        setStartedAt(data.started_at);
        const sl=Math.ceil((new Date(data.started_at).getTime()-Date.now())/1000);
        if(sl>0) setCountdown(sl); else setIsLive(true);
      });
    const roomCh=supabase.channel("room-state")
      .on("postgres_changes",{event:"*",schema:"public",table:"room_state"},(p:any)=>{
        const row=p.new as {is_live?:boolean;started_at?:string};
        if(row?.started_at){
          setStartedAt(row.started_at);
          const sl=Math.ceil((new Date(row.started_at).getTime()-Date.now())/1000);
          if(sl>0) setCountdown(sl); else{setCountdown(null);setIsLive(true);}
        }
        if(row?.is_live===false){
          setIsLive(false);setCountdown(null);setStartedAt(null);setElapsed(0);
          if(audioRef.current){audioRef.current.pause();audioRef.current.currentTime=0;}
        }
      }).subscribe();
    const msgCh=supabase.channel("messages-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"room_id=eq.main"},
        (p:any)=>setMessages(prev=>[...prev,p.new as Message])).subscribe();
    return ()=>{supabase.removeChannel(roomCh);supabase.removeChannel(msgCh);};
  },[]);

  useEffect(()=>{
    if(countdown===null)return;
    if(countdown<=0){setCountdown(null);setIsLive(true);return;}
    const iv=setInterval(()=>setCountdown(p=>p!==null?p-1:null),1000);
    return ()=>clearInterval(iv);
  },[countdown]);

  useEffect(()=>{
    if(!startedAt||!audioUnlocked||!audioRef.current)return;
    const sp=Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000);
    audioRef.current.currentTime=sp;
    audioRef.current.play().catch(()=>{});
  },[startedAt,audioUnlocked]);

  useEffect(()=>{
    if(!isLive||!startedAt)return;
    const tick=()=>setElapsed(Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000));
    tick();
    const id=setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[isLive,startedAt]);

  useEffect(()=>{ msgEndRef.current?.scrollIntoView({behavior:"smooth"}); },[messages]);

  const saveName=()=>{ const n=nameInput.trim();if(!n)return;localStorage.setItem("ac_display_name",n);setDisplayName(n);setNameSet(true); };
  const triggerShowtime=async()=>{
    if(audioRef.current){try{await audioRef.current.play();audioRef.current.pause();audioRef.current.currentTime=0;setAudioUnlocked(true);}catch{}}
    await supabase.from("room_state").update({is_live:true,started_at:new Date(Date.now()+5000).toISOString()}).eq("room_id","main");
  };
  const stopShowtime=async()=>{
    if(audioRef.current){audioRef.current.pause();audioRef.current.currentTime=0;}
    await supabase.from("room_state").update({is_live:false,started_at:null}).eq("room_id","main");
  };
  const sendMessage=async()=>{
    const body=chatInput.trim();if(!body||!displayName)return;
    setChatInput("");
    await supabase.from("messages").insert({room_id:"main",display_name:displayName,body});
  };

  const {track:cur,index:tIdx}=getCurrentTrack(elapsed);
  const next=TRACKS[tIdx+1]||null;
  const tElapsed=elapsed-cur.start;
  const tDuration=next?next.start-cur.start:ALBUM_DURATION-cur.start;
  const tProgress=Math.min(100,(tElapsed/tDuration)*100);

  // Tonearm angle: sweeps from ~-30deg (outer) to ~15deg (inner) over album
  const tonearmAngle = isLive ? -30 + (elapsed / ALBUM_DURATION) * 45 : -35;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060402] text-[#F5E6C8]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
        .font-playfair  { font-family:'Playfair Display',Georgia,serif; }
        .font-cormorant { font-family:'Cormorant Garamond',Georgia,serif; }
        @keyframes vinylSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .vinyl-spin { animation: vinylSpin 1.8s linear infinite; }
        @keyframes vinylSheen { 0%{transform:rotate(0deg);opacity:.25} 50%{opacity:.08} 100%{transform:rotate(360deg);opacity:.25} }
        @keyframes softPulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes needleSpark { 0%{transform:scale(.5);opacity:0} 20%{transform:scale(1);opacity:1} 100%{transform:scale(1.6);opacity:0} }
        .needle-spark { animation: needleSpark 450ms ease-out both; }
        .vinyl-sheen {
          position:absolute;inset:0;border-radius:9999px;
          background:conic-gradient(from 0deg,rgba(255,255,255,.18),rgba(255,255,255,0) 35%,rgba(255,255,255,.08) 55%,rgba(255,255,255,0) 75%,rgba(255,255,255,.15));
          mix-blend-mode:screen;pointer-events:none;
        }
        .vinyl-sheen.spinning { animation: vinylSheen 1.8s linear infinite; }
        input[type=range].vol-slider { -webkit-appearance:none;background:rgba(245,230,200,.15);border-radius:4px;height:3px; }
        input[type=range].vol-slider::-webkit-slider-thumb { -webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#C47A2C;cursor:pointer; }
      `}</style>

      {/* Countdown */}
      {countdown!==null&&(
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="font-playfair text-[14rem] text-[#F5E6C8]/90 leading-none"
            style={{textShadow:"0 0 100px rgba(196,122,44,0.5)"}}>
            {countdown}
          </div>
        </div>
      )}

      {/* Name prompt */}
      {!nameSet&&(
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="rounded-2xl border border-[#C47A2C]/25 bg-black/75 p-10 text-center shadow-2xl" style={{maxWidth:"340px"}}>
            <div className="font-playfair text-3xl font-bold mb-1">Welcome</div>
            <div className="text-[10px] tracking-[0.5em] uppercase text-[#C47A2C]/70 mb-7 font-cormorant">AlbumClub · Russo&apos;s Lounge</div>
            <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveName()}
              className="w-full rounded-lg bg-white/5 border border-[#F5E6C8]/15 px-4 py-3 text-base outline-none placeholder:text-[#F5E6C8]/25 focus:border-[#C47A2C]/50 mb-4 font-cormorant"
              placeholder="Your name..." maxLength={24}/>
            <button onClick={saveName}
              className="w-full rounded-lg px-4 py-3 font-cormorant text-base tracking-[0.3em] uppercase"
              style={{background:"linear-gradient(to bottom,#8a3a1a,#5a2010)",border:"1px solid #C47A2C40",boxShadow:"0 0 25px rgba(196,122,44,0.2)"}}>
              Enter the Room
            </button>
          </div>
        </div>
      )}

      {/* Background photo */}
      <img src="/room-bg.jpg" alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{filter:`brightness(${isLive?0.75:0.55})`,transition:"filter 2s ease"}}/>
      <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 40%,transparent 15%,rgba(0,0,0,0.65) 100%)"}}/>
      <div className="absolute bottom-0 left-0 right-0 h-64" style={{background:"linear-gradient(to top,rgba(0,0,0,0.95) 0%,transparent 100%)"}}/>

      {/* Live warm glow */}
      {isLive&&<div className="absolute inset-0 pointer-events-none" style={{background:"radial-gradient(ellipse at 50% 55%,rgba(196,122,44,0.06) 0%,transparent 65%)",animation:"softPulse 4s ease-in-out infinite"}}/>}

      {/* ── HEADER ── */}
      <header className="absolute top-0 left-0 right-0 z-20 px-8 py-5 flex items-center justify-between">
        <div>
          <div className="text-[9px] tracking-[0.55em] uppercase text-[#C47A2C]/75 mb-0.5 font-cormorant">Now Playing</div>
          <div className="font-playfair font-black text-2xl tracking-wide">AlbumClub</div>
        </div>
        <div className="flex items-center gap-4">
          {/* Listeners */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 border border-[#F5E6C8]/10 backdrop-blur-sm">
            <div className={`w-2 h-2 rounded-full ${isLive?"bg-[#C47A2C]":"bg-[#F5E6C8]/20"}`}
              style={isLive?{boxShadow:"0 0 6px rgba(196,122,44,0.9)",animation:"softPulse 2s infinite"}:{}}/>
            <span className="font-cormorant text-sm">{listenerCount} listening</span>
          </div>
          {/* Volume */}
          <div className="relative">
            <button onClick={()=>setShowVolume(v=>!v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 border border-[#F5E6C8]/10 hover:border-[#C47A2C]/30 transition backdrop-blur-sm">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                {volume>0&&<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>}
                {volume>0.5&&<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>}
              </svg>
              <span className="font-cormorant text-sm">{Math.round(volume*100)}%</span>
            </button>
            {showVolume&&(
              <div className="absolute top-11 right-0 bg-black/85 border border-[#F5E6C8]/15 rounded-xl p-4 w-40 z-30 backdrop-blur-xl">
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={e=>setVolume(parseFloat(e.target.value))} className="vol-slider w-full"/>
                <div className="text-center font-cormorant text-sm text-[#F5E6C8]/50 mt-2">{Math.round(volume*100)}%</div>
              </div>
            )}
          </div>
          {/* Showtime */}
          <div className="text-right">
            <div className="text-[9px] tracking-[0.4em] uppercase text-[#F5E6C8]/40 font-cormorant">Showtime</div>
            <div className="font-cormorant text-lg">8:00 PM</div>
          </div>
          {isLive?(
            <button onClick={stopShowtime}
              className="px-4 py-2 rounded-lg text-xs tracking-[0.3em] uppercase text-red-400 border border-red-500/30 bg-black/40 hover:bg-red-900/20 transition font-cormorant backdrop-blur-sm">
              End Session
            </button>
          ):(
            <button onClick={triggerShowtime}
              className="px-4 py-2 rounded-lg text-xs tracking-[0.3em] uppercase border border-[#F5E6C8]/15 bg-black/40 hover:bg-black/60 transition font-cormorant backdrop-blur-sm">
              Start Showtime
            </button>
          )}
        </div>
      </header>

      {/* ── ALBUM INFO — LEFT ── */}
      <div className="absolute left-8 z-20 flex flex-col" style={{top:"14%",maxWidth:"240px"}}>
        {/* Cover with shadow treatment */}
        {coverUrl?(
          <div className="relative mb-5">
            {/* Shadow layers */}
            <div className="absolute -inset-3 rounded-xl opacity-60" style={{background:"radial-gradient(ellipse,rgba(0,0,0,0.9) 0%,transparent 70%)",filter:"blur(16px)",transform:"translateY(8px)"}}/>
            <div className="absolute -inset-1 rounded-lg" style={{boxShadow:"0 25px 70px rgba(0,0,0,0.8)"}}/>
            {/* Warm glow behind cover matching album */}
            <div className="absolute -inset-4 rounded-xl opacity-40" style={{background:"radial-gradient(ellipse,rgba(196,122,44,0.3) 0%,transparent 70%)",filter:"blur(20px)"}}/>
            <img src={coverUrl} alt={ALBUM.title}
              className="relative rounded-lg w-full shadow-2xl"
              style={{
                border:"1px solid rgba(255,255,255,0.12)",
                boxShadow:"0 30px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.1)",
              }}/>
          </div>
        ):(
          <div className="rounded-lg bg-gradient-to-br from-[#1a1a3a] to-[#0a0a1a] aspect-square mb-5 flex items-center justify-center border border-white/10"
            style={{boxShadow:"0 25px 70px rgba(0,0,0,0.8)"}}>
            <div className="font-playfair text-6xl text-white/15">L</div>
          </div>
        )}

        {/* Album title — big & bold */}
        <div className="font-playfair font-black text-4xl leading-none mb-2"
          style={{textShadow:"0 2px 30px rgba(0,0,0,0.9), 0 0 60px rgba(0,0,0,0.6)"}}>
          {ALBUM.title}
        </div>
        <div className="font-playfair italic text-xl text-[#C47A2C] mb-3">{ALBUM.artist}</div>

        {/* Metadata */}
        <div className="space-y-1.5 font-cormorant">
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.4em] uppercase text-[#F5E6C8]/30 w-14">Year</span>
            <span className="text-sm text-[#F5E6C8]/70">{ALBUM.year}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.4em] uppercase text-[#F5E6C8]/30 w-14">Label</span>
            <span className="text-sm text-[#F5E6C8]/70">{ALBUM.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.4em] uppercase text-[#F5E6C8]/30 w-14">Genre</span>
            <span className="text-sm text-[#F5E6C8]/70">{ALBUM.genre}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.4em] uppercase text-[#F5E6C8]/30 w-14">Tracks</span>
            <span className="text-sm text-[#F5E6C8]/70">{ALBUM.tracks} tracks</span>
          </div>
        </div>

        {/* Live status */}
        {isLive&&(
          <div className="mt-4 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#C47A2C]" style={{boxShadow:"0 0 8px rgba(196,122,44,1)",animation:"softPulse 1.5s infinite"}}/>
            <span className="font-cormorant text-sm text-[#C47A2C] tracking-[0.3em] uppercase">Live Now</span>
          </div>
        )}
      </div>

      {/* ── TURNTABLE — CENTER ── */}
      <div className="absolute left-1/2 -translate-x-1/2 z-20" style={{top:"14%",width:"320px"}}>

        {/* Turntable body */}
        <div className="relative rounded-2xl overflow-hidden"
          style={{
            background:"linear-gradient(145deg, #1c1008 0%, #120b04 50%, #1a0e06 100%)",
            border:"1px solid rgba(255,255,255,0.08)",
            boxShadow:"0 30px 80px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.4)",
            padding:"28px",
          }}>

          {/* Platter base ring */}
          <div className="relative mx-auto" style={{width:"220px",height:"220px"}}>
            {/* Platter outer ring */}
            <div className="absolute inset-0 rounded-full"
              style={{background:"linear-gradient(145deg,#2a1a08,#1a0e04)",border:"2px solid rgba(255,255,255,0.06)",boxShadow:"inset 0 2px 8px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.5)"}}/>
            {/* Rubber mat */}
            <div className="absolute inset-2 rounded-full"
              style={{background:"linear-gradient(145deg,#111,#0a0a0a)",border:"1px solid rgba(255,255,255,0.04)"}}/>

            {/* Vinyl record */}
            <div className={`absolute inset-3 rounded-full ${isLive?"vinyl-spin":""}`}
              style={{background:"radial-gradient(circle at 50% 50%, #1a1a1a 0%, #0d0d0d 40%, #111 100%)"}}>
              {/* Groove rings */}
              {[18,26,34,42,50,58,66,74,82].map(r=>(
                <div key={r} className="absolute rounded-full border border-white/[0.035]"
                  style={{inset:`${r/2}%`}}/>
              ))}
              {/* Label */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-20 h-20 rounded-full flex items-center justify-center"
                  style={{background:"linear-gradient(135deg,#2a1a60,#1a0a40)",border:"1px solid rgba(255,255,255,0.1)"}}>
                  {coverUrl&&(
                    <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full rounded-full object-cover opacity-70"/>
                  )}
                  {/* Center spindle hole */}
                  <div className="relative z-10 w-3 h-3 rounded-full bg-[#0a0a0a]"
                    style={{boxShadow:"inset 0 1px 3px rgba(0,0,0,0.9)"}}/>
                </div>
              </div>
              {/* Vinyl sheen */}
              <div className={`vinyl-sheen ${isLive?"spinning":""}`}/>
            </div>

            {/* Spindle cap */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full z-20"
              style={{background:"linear-gradient(145deg,#888,#444)",boxShadow:"0 1px 3px rgba(0,0,0,0.9)"}}/>

            {/* ── Tonearm — realistic pivot + arm ── */}
            <div className="absolute z-30" style={{right:"-18px",top:"-14px"}}>
              {/* Pivot base */}
              <div className="relative" style={{width:"56px",height:"56px"}}>
                {/* Outer bearing ring */}
                <div className="absolute inset-0 rounded-full"
                  style={{background:"linear-gradient(145deg,#3a2a1a,#1a1208)",border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 4px 12px rgba(0,0,0,0.8)"}}>
                  <div className="absolute inset-2 rounded-full"
                    style={{background:"linear-gradient(145deg,#2a1e12,#150e06)",border:"1px solid rgba(255,255,255,0.06)"}}/>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-4 h-4 rounded-full"
                      style={{background:"linear-gradient(145deg,#666,#333)",boxShadow:"0 2px 6px rgba(0,0,0,0.9),inset 0 1px 2px rgba(255,255,255,0.2)"}}/>
                  </div>
                </div>

                {/* Tonearm — rotates from pivot */}
                <div className="absolute z-10"
                  style={{
                    right:"22px",top:"22px",
                    transformOrigin:"100% 50%",
                    transform:`rotate(${tonearmAngle}deg)`,
                    transition:isLive?"transform 8s linear":"transform 0.5s ease",
                  }}>
                  {/* Main arm tube */}
                  <div className="relative" style={{width:"180px",height:"8px",marginTop:"-4px"}}>
                    <div className="absolute inset-0 rounded-full"
                      style={{
                        background:"linear-gradient(to bottom,rgba(255,255,255,0.2),rgba(255,255,255,0.05) 40%,rgba(0,0,0,0.3))",
                        border:"1px solid rgba(255,255,255,0.1)",
                        boxShadow:"0 2px 8px rgba(0,0,0,0.6)",
                      }}/>
                    {/* Headshell connector */}
                    <div className="absolute left-0 top-1/2 -translate-y-1/2" style={{width:"14px",height:"12px",background:"linear-gradient(145deg,#444,#222)",borderRadius:"2px 0 0 2px",border:"1px solid rgba(255,255,255,0.1)"}}/>
                    {/* Headshell */}
                    <div className="absolute -left-6 top-1/2 -translate-y-1/2 rotate-[-15deg]"
                      style={{width:"28px",height:"18px",background:"linear-gradient(145deg,#555,#2a2a2a)",borderRadius:"3px",border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 3px 10px rgba(0,0,0,0.7)"}}>
                      {/* Cartridge */}
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1"
                        style={{width:"10px",height:"8px",background:"linear-gradient(145deg,#333,#111)",borderRadius:"1px",border:"1px solid rgba(255,255,255,0.08)"}}>
                        {/* Stylus tip */}
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full"
                          style={{width:"2px",height:"5px",background:"linear-gradient(to bottom,#888,#333)",borderRadius:"0 0 2px 2px"}}/>
                        {/* Contact dot */}
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-[-6px]"
                          style={{width:"3px",height:"3px",borderRadius:"50%",background:"#C47A2C",boxShadow:"0 0 4px rgba(196,122,44,0.8)"}}/>
                      </div>
                    </div>
                    {/* Anti-skate weight */}
                    <div className="absolute right-6 top-1/2 -translate-y-1/2"
                      style={{width:"10px",height:"10px",borderRadius:"50%",background:"linear-gradient(145deg,#777,#333)",border:"1px solid rgba(255,255,255,0.1)",boxShadow:"0 2px 6px rgba(0,0,0,0.7)"}}/>
                  </div>
                </div>

                {/* Lift lever */}
                <div className="absolute bottom-0 right-0"
                  style={{width:"8px",height:"14px",background:"linear-gradient(145deg,#555,#222)",borderRadius:"4px 4px 2px 2px",border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 2px 6px rgba(0,0,0,0.6)"}}/>
              </div>
            </div>

            {needleDrop&&(
              <div className="absolute left-1/3 top-1/3 w-6 h-6 needle-spark z-40">
                <div className="absolute inset-0 rounded-full bg-[#C47A2C]/30"/>
                <div className="absolute left-1/2 top-1/2 w-0.5 h-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/50 rounded"/>
                <div className="absolute left-1/2 top-1/2 h-0.5 w-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/50 rounded"/>
              </div>
            )}
          </div>

          {/* Turntable base details */}
          <div className="flex justify-between items-center mt-4 px-2">
            {/* Speed selector dots */}
            <div className="flex items-center gap-2">
              {["33","45"].map((s,i)=>(
                <div key={s} className="flex items-center gap-1">
                  <div className={`w-2.5 h-2.5 rounded-full border ${i===0?"bg-[#C47A2C] border-[#C47A2C]":"border-[#F5E6C8]/20"}`}
                    style={i===0?{boxShadow:"0 0 6px rgba(196,122,44,0.6)"}:{}}/>
                  <span className="font-cormorant text-[10px] text-[#F5E6C8]/40">{s}</span>
                </div>
              ))}
            </div>
            {/* Brand */}
            <div className="font-cormorant text-[10px] tracking-[0.3em] text-[#F5E6C8]/20 uppercase">Pro-Ject</div>
            {/* On indicator */}
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${isLive?"bg-green-400":"bg-[#F5E6C8]/15"}`}
                style={isLive?{boxShadow:"0 0 6px rgba(74,222,128,0.8)"}:{}}/>
              <span className="font-cormorant text-[10px] text-[#F5E6C8]/30">{isLive?"ON":"STBY"}</span>
            </div>
          </div>
        </div>

        {/* Track info card */}
        {isLive?(
          <div className="mt-4 rounded-xl border border-[#F5E6C8]/10 bg-black/60 backdrop-blur-md px-6 py-5"
            style={{boxShadow:"0 10px 40px rgba(0,0,0,0.6)"}}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-[9px] tracking-[0.45em] uppercase text-[#C47A2C]/70 mb-1.5 font-cormorant">
                  Track {tIdx+1} of {TRACKS.length}
                </div>
                <div className="font-playfair text-lg font-bold leading-tight">{cur.title}</div>
              </div>
              <div className="text-right font-cormorant text-sm text-[#F5E6C8]/45 shrink-0 ml-4">
                <div>{fmt(tElapsed)}</div>
                <div className="text-[#F5E6C8]/20">/ {fmt(tDuration)}</div>
              </div>
            </div>
            <div className="h-[1px] bg-[#F5E6C8]/8 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#C47A2C]/50 to-[#C47A2C]/80 rounded-full transition-all duration-1000"
                style={{width:`${tProgress}%`}}/>
            </div>
            {next&&<div className="mt-2.5 font-cormorant text-xs text-[#F5E6C8]/28">Up next — {next.title}</div>}
          </div>
        ):(
          <div className="mt-4 text-center font-cormorant text-sm tracking-[0.4em] uppercase text-[#F5E6C8]/25">
            Waiting for showtime
          </div>
        )}
      </div>

      {/* ── CHAT — RIGHT PANEL ── */}
      <div className={`absolute right-0 top-0 bottom-0 z-20 transition-all duration-300 ${chatExpanded?"w-[400px]":"w-[320px]"}`}>
        {chatOpen?(
          <div className="flex flex-col h-full"
            style={{background:"linear-gradient(to left,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.55) 100%)",backdropFilter:"blur(10px)"}}>
            <div className="flex-1 flex flex-col pt-20 pb-4 px-5 min-h-0">
              {/* Header */}
              <div className="flex items-center justify-between mb-5 shrink-0">
                <div className="flex items-baseline gap-3">
                  <div className="font-playfair text-2xl font-bold">Chat</div>
                  <div className="text-[9px] tracking-[0.45em] uppercase text-[#C47A2C]/65 font-cormorant">{isLive?"Live":"Lobby"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={()=>setChatExpanded(e=>!e)}
                    className="px-2.5 py-1 rounded text-[9px] tracking-[0.3em] uppercase border border-[#F5E6C8]/12 bg-black/20 hover:bg-black/40 transition font-cormorant">
                    {chatExpanded?"Compact":"Expand"}
                  </button>
                  <button onClick={()=>setChatOpen(false)}
                    className="px-2.5 py-1 rounded text-[9px] tracking-[0.3em] uppercase border border-[#F5E6C8]/12 bg-black/20 hover:bg-black/40 transition font-cormorant">
                    ✕
                  </button>
                </div>
              </div>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
                {messages.length===0&&(
                  <p className="font-cormorant italic text-[#F5E6C8]/22 text-center text-sm mt-16">
                    The room is quiet.<br/>Say something.
                  </p>
                )}
                {messages.map(msg=>(
                  <div key={msg.id} className="group">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-cormorant font-semibold text-[#C47A2C] text-sm">{msg.display_name}</span>
                      <span className="font-cormorant text-[10px] text-[#F5E6C8]/18 opacity-0 group-hover:opacity-100 transition">{fmtTs(msg.created_at)}</span>
                    </div>
                    <div className="font-cormorant text-[#F5E6C8]/80 text-base leading-snug">{msg.body}</div>
                  </div>
                ))}
                <div ref={msgEndRef}/>
              </div>
              {/* Input */}
              <div className="shrink-0 mt-4 pt-4 border-t border-[#F5E6C8]/8 flex gap-2">
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&sendMessage()} disabled={!nameSet}
                  className="flex-1 rounded-lg bg-white/5 border border-[#F5E6C8]/12 px-3 py-2.5 text-sm outline-none placeholder:text-[#F5E6C8]/22 focus:border-[#C47A2C]/40 disabled:opacity-30 font-cormorant"
                  placeholder={nameSet?"Say something...":"Enter your name first…"}/>
                <button onClick={sendMessage} disabled={!nameSet||!chatInput.trim()}
                  className="rounded-lg px-4 py-2.5 font-cormorant text-sm disabled:opacity-25 transition"
                  style={{background:"linear-gradient(to bottom,#6b1f1f,#3a0e0e)",border:"1px solid #7a2020"}}>
                  Send
                </button>
              </div>
            </div>
          </div>
        ):(
          <button onClick={()=>setChatOpen(true)}
            className="absolute right-4 top-20 flex items-center gap-2 rounded-full border border-[#F5E6C8]/12 bg-black/55 backdrop-blur-md px-4 py-2.5 hover:bg-black/75 transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="font-cormorant text-sm">Chat</span>
            {messages.length>0&&(
              <span className="w-4 h-4 rounded-full bg-[#C47A2C]/80 text-[9px] text-black font-bold flex items-center justify-center">
                {messages.length}
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
