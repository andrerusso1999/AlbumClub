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
const SHOWTIME_HOUR = 20;
const PRE_SHOW_SECS = 30; // ceremonial countdown after entering, before music

function getCurrentTrack(s: number) {
  let cur = TRACKS[0], idx = 0;
  for (let i=0; i<TRACKS.length; i++) { if(s>=TRACKS[i].start){cur=TRACKS[i];idx=i;}else break; }
  return { track: cur, index: idx };
}
function fmt(s: number) { return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; }
function fmtTs(iso: string) { return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }
function extractColor(url: string, cb: (r:number,g:number,b:number)=>void) {
  const img = new Image(); img.crossOrigin="anonymous";
  img.onload = () => {
    const c = document.createElement("canvas"); c.width=50; c.height=50;
    const ctx = c.getContext("2d"); if(!ctx)return;
    ctx.drawImage(img,0,0,50,50);
    const d = ctx.getImageData(0,0,50,50).data;
    let r=0,g=0,b=0,n=0;
    for(let i=0;i<d.length;i+=16){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
    cb(Math.floor(r/n),Math.floor(g/n),Math.floor(b/n));
  };
  img.src = url;
}

// Phase: "waiting" = before showtime | "entering" = 30s ceremony | "live" = playing
type Phase = "waiting" | "entering" | "live";

export default function RoomPage() {
  const audioRef   = useRef<HTMLAudioElement|null>(null);
  const msgEndRef  = useRef<HTMLDivElement|null>(null);
  const crackleRef = useRef<{ctx:AudioContext;source:AudioBufferSourceNode}|null>(null);

  const [phase, setPhase]                 = useState<Phase>("waiting");
  const [isAdmin, setIsAdmin]             = useState(false);
  const [preCountdown, setPreCountdown]   = useState(PRE_SHOW_SECS);
  const [startedAt, setStartedAt]         = useState<string|null>(null);
  const [isLive, setIsLive]               = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [volume, setVolume]               = useState(0.8);
  const [showVolume, setShowVolume]       = useState(false);
  const [listenerCount]                   = useState(2);
  const [coverUrl, setCoverUrl]           = useState("");
  const [dominantRgb, setDominantRgb]     = useState<[number,number,number]>([100,70,30]);
  const [crackleOn, setCrackleOn]         = useState(false);
  const [needleDrop, setNeedleDrop]       = useState(false);
  const [now, setNow]                     = useState(()=>new Date());

  const [chatOpen, setChatOpen]         = useState(true);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [displayName, setDisplayName]   = useState("");
  const [nameInput, setNameInput]       = useState("");
  const [nameSet, setNameSet]           = useState(false);

  const [cr,cg,cb2] = dominantRgb;

  // Cover + color
  useEffect(()=>{
    const cached = localStorage.getItem("ac_cover_lonerism");
    if (cached) { setCoverUrl(cached); extractColor(cached,(r,g,b)=>setDominantRgb([r,g,b])); return; }
    fetch("https://musicbrainz.org/ws/2/release/?query=lonerism+tame+impala&fmt=json&limit=3")
      .then(r=>r.json()).then(d=>{
        const mbid=d?.releases?.[0]?.id; if(!mbid)return;
        return fetch(`https://coverartarchive.org/release/${mbid}`).then(r=>r.json());
      }).then((art:any)=>{
        const url=art?.images?.find((i:any)=>i.front)?.thumbnails?.large||art?.images?.[0]?.image||"";
        if(url){setCoverUrl(url);localStorage.setItem("ac_cover_lonerism",url);extractColor(url,(r,g,b)=>setDominantRgb([r,g,b]));}
      }).catch(()=>{});
  },[]);

  // Clock tick for showtime check
  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(id); },[]);

  // Phase logic: waiting → entering at showtime → live after 30s ceremony
  // Admin can bypass the lock entirely
  useEffect(()=>{
    const showtimeToday = new Date(); showtimeToday.setHours(SHOWTIME_HOUR,0,0,0);
    if (isAdmin && phase==="waiting") {
      setPhase("live"); // admin goes straight to live room
      return;
    }
    if (now >= showtimeToday && phase==="waiting") {
      setPhase("entering");
    }
  },[now, phase, isAdmin]);

  // Pre-show countdown
  useEffect(()=>{
    if (phase!=="entering") return;
    setPreCountdown(PRE_SHOW_SECS);
    const iv = setInterval(()=>{
      setPreCountdown(p=>{
        if (p<=1) { clearInterval(iv); setPhase("live"); return 0; }
        return p-1;
      });
    },1000);
    return ()=>clearInterval(iv);
  },[phase]);

  // Crackle
  const startCrackle = useCallback(()=>{
    try {
      const ctx=new AudioContext();
      const buf=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=(Math.random()<0.0006?(Math.random()*2-1)*0.5:0)+(Math.random()*2-1)*0.01;
      const src=ctx.createBufferSource(); src.buffer=buf; src.loop=true;
      const gain=ctx.createGain(); gain.gain.value=0.14;
      src.connect(gain); gain.connect(ctx.destination); src.start();
      crackleRef.current={ctx,source:src};
    }catch{}
  },[]);
  const stopCrackle=useCallback(()=>{
    if(crackleRef.current){try{crackleRef.current.source.stop();crackleRef.current.ctx.close();}catch{} crackleRef.current=null;}
  },[]);
  useEffect(()=>{ if(crackleOn&&isLive)startCrackle();else stopCrackle(); return()=>stopCrackle(); },[crackleOn,isLive,startCrackle,stopCrackle]);

  useEffect(()=>{ const s=localStorage.getItem("ac_display_name");if(s){setDisplayName(s);setNameSet(true);} },[]);
  useEffect(()=>{ setIsAdmin(localStorage.getItem("ac_admin")==="true"); },[]);
  useEffect(()=>{
    const unlock=async()=>{
      if(!audioRef.current)return;
      try{await audioRef.current.play();audioRef.current.pause();audioRef.current.currentTime=0;setAudioUnlocked(true);}catch{}
    };
    window.addEventListener("click",unlock,{once:true});
    return()=>window.removeEventListener("click",unlock);
  },[]);
  useEffect(()=>{ if(audioRef.current) audioRef.current.volume=volume; },[volume]);
  useEffect(()=>{ if(!isLive)return; setNeedleDrop(true); const t=setTimeout(()=>setNeedleDrop(false),700); return()=>clearTimeout(t); },[isLive]);

  useEffect(()=>{
    supabase.from("messages").select("*").eq("room_id","main").order("created_at",{ascending:true}).limit(100)
      .then(({data})=>{ if(data)setMessages(data as Message[]); });
    supabase.from("room_state").select("*").eq("room_id","main").single()
      .then(({data})=>{
        if(!data?.started_at)return;
        setStartedAt(data.started_at);
        const sl=Math.ceil((new Date(data.started_at).getTime()-Date.now())/1000);
        if(sl<=0){setIsLive(true);}
      });
    const roomCh=supabase.channel("room-state")
      .on("postgres_changes",{event:"*",schema:"public",table:"room_state"},(p:any)=>{
        const row=p.new as {is_live?:boolean;started_at?:string};
        if(row?.started_at){
          setStartedAt(row.started_at);
          const sl=Math.ceil((new Date(row.started_at).getTime()-Date.now())/1000);
          if(sl<=0){setIsLive(true);}
        }
        if(row?.is_live===false){
          setIsLive(false);setStartedAt(null);setElapsed(0);
          if(audioRef.current){audioRef.current.pause();audioRef.current.currentTime=0;}
        }
      }).subscribe();
    const msgCh=supabase.channel("messages-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"room_id=eq.main"},
        (p:any)=>setMessages(prev=>[...prev,p.new as Message])).subscribe();
    return()=>{supabase.removeChannel(roomCh);supabase.removeChannel(msgCh);};
  },[]);

  useEffect(()=>{
    if(!startedAt||!audioUnlocked||!audioRef.current)return;
    const sp=Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000);
    audioRef.current.currentTime=sp;
    audioRef.current.play().catch(()=>{});
  },[startedAt,audioUnlocked]);

  useEffect(()=>{
    if(!isLive||!startedAt)return;
    const tick=()=>setElapsed(Math.max(0,(Date.now()-new Date(startedAt).getTime())/1000));
    tick();const id=setInterval(tick,1000);return()=>clearInterval(id);
  },[isLive,startedAt]);

  useEffect(()=>{ msgEndRef.current?.scrollIntoView({behavior:"smooth"}); },[messages]);

  const saveName=()=>{ const n=nameInput.trim();if(!n)return;localStorage.setItem("ac_display_name",n);setDisplayName(n);setNameSet(true); };
  const triggerShowtime=async()=>{
    if(audioRef.current){try{await audioRef.current.play();audioRef.current.pause();audioRef.current.currentTime=0;setAudioUnlocked(true);}catch{}}
    await supabase.from("room_state").update({is_live:true,started_at:new Date(Date.now()+3000).toISOString()}).eq("room_id","main");
  };
  const stopShowtime=async()=>{
    if(audioRef.current){audioRef.current.pause();audioRef.current.currentTime=0;}
    await supabase.from("room_state").update({is_live:false,started_at:null}).eq("room_id","main");
    setPhase("waiting"); setIsLive(false);
  };
  const sendMessage=async()=>{
    const body=chatInput.trim();if(!body||!displayName)return;
    setChatInput("");
    await supabase.from("messages").insert({room_id:"main",display_name:displayName,body});
  };

  const {track:cur,index:tIdx}=getCurrentTrack(elapsed);
  const next=TRACKS[tIdx+1]||null;
  const tEl=elapsed-cur.start, tDur=next?next.start-cur.start:ALBUM_DURATION-cur.start;
  const tPct=Math.min(100,(tEl/tDur)*100);

  // Tonearm: pivot top-right. Arm points LEFT.
  // -25deg = outer groove (stylus at ~10 o'clock on record edge)
  //  +2deg = inner groove (stylus swept toward label)
  const tonearmAngle = isLive ? Math.min(2,-25+(elapsed/ALBUM_DURATION)*27) : -30;

  // ── WAITING SCREEN ──
  if (phase==="waiting") {
    const showtimeToday=new Date(); showtimeToday.setHours(SHOWTIME_HOUR,0,0,0);
    if(new Date()>showtimeToday) showtimeToday.setDate(showtimeToday.getDate()+1);
    const msLeft=showtimeToday.getTime()-now.getTime();
    const h=Math.floor(msLeft/3600000), m=Math.floor((msLeft%3600000)/60000), s=Math.floor((msLeft%60000)/1000);
    const cStr=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return (
      <main className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[#060402]">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@900&family=Cormorant+Garamond:ital,wght@0,400;1,300&display=swap');.fp{font-family:'Playfair Display',serif;}.fc{font-family:'Cormorant Garamond',serif;}`}</style>
        <img src="/room-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" style={{filter:"brightness(0.35)"}}/>
        <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 50%,transparent 20%,rgba(0,0,0,0.8) 100%)"}}/>
        <div className="relative z-10 text-center text-[#F5E6C8]">
          <div className="fc italic text-xl text-white/50 mb-3 tracking-[0.4em] uppercase">The room opens in</div>
          <div className="fp font-black text-8xl md:text-9xl mb-6" style={{textShadow:`0 0 80px rgba(${cr},${cg},${cb2},0.5)`,letterSpacing:"-0.02em"}}>
            {cStr}
          </div>
          <div className="fp text-3xl text-[#C47A2C] mb-2">AlbumClub</div>
          <div className="fc italic text-lg text-white/40">Tonight&apos;s showtime: 8:00 PM</div>
        </div>
      </main>
    );
  }

  // ── ENTERING CEREMONY (30s pre-show) ──
  if (phase==="entering") {
    return (
      <main className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[#060402]">
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@900&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&display=swap');
          .fp{font-family:'Playfair Display',serif;}.fc{font-family:'Cormorant Garamond',serif;}
          @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
          @keyframes fadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
          .fade-in{animation:fadeIn 1.2s ease both;}
          @keyframes vinylDrop{from{transform:translateY(-60px) rotate(-15deg);opacity:0}to{transform:translateY(0) rotate(0);opacity:1}}
          .vinyl-drop{animation:vinylDrop 1.4s cubic-bezier(0.22,1,0.36,1) both 0.3s;}
        `}</style>
        <img src="/room-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" style={{filter:"brightness(0.55)",transition:"filter 2s"}}/>
        <div className="absolute inset-0" style={{background:`radial-gradient(ellipse at 50% 50%,rgba(${cr},${cg},${cb2},0.12) 0%,rgba(0,0,0,0.75) 100%)`}}/>

        <div className="relative z-10 text-center text-[#F5E6C8] px-8 fade-in">
          {/* Album cover drops in */}
          {coverUrl && (
            <div className="vinyl-drop mx-auto mb-8 rounded-xl overflow-hidden shadow-2xl"
              style={{width:"160px",height:"160px",border:"1px solid rgba(255,255,255,0.1)",boxShadow:`0 30px 80px rgba(0,0,0,0.8),0 0 60px rgba(${cr},${cg},${cb2},0.25)`}}>
              <img src={coverUrl} alt="" className="w-full h-full object-cover"/>
            </div>
          )}

          <div className="fp font-black text-5xl mb-1" style={{textShadow:"0 4px 40px rgba(0,0,0,0.95)"}}>
            {ALBUM.title}
          </div>
          <div className="fp italic text-2xl mb-8" style={{color:`rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+30,255)},0.85)`}}>
            {ALBUM.artist}
          </div>

          {/* Countdown ring */}
          <div className="relative mx-auto mb-6" style={{width:"100px",height:"100px"}}>
            <svg className="absolute inset-0" width="100" height="100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3"/>
              <circle cx="50" cy="50" r="44" fill="none" stroke={`rgb(${cr},${cg},${cb2})`} strokeWidth="3"
                strokeDasharray={`${2*Math.PI*44}`}
                strokeDashoffset={`${2*Math.PI*44*(1-preCountdown/PRE_SHOW_SECS)}`}
                strokeLinecap="round" transform="rotate(-90 50 50)"
                style={{transition:"stroke-dashoffset 1s linear"}}/>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="fp font-black text-4xl text-white">{preCountdown}</span>
            </div>
          </div>

          <div className="fc italic text-xl text-white/55 tracking-wide">
            The needle drops in a moment…
          </div>
          <div className="mt-2 fc text-sm tracking-[0.5em] uppercase text-white/30">
            {listenerCount} people settling in
          </div>
        </div>
      </main>
    );
  }

  // ── LIVE ROOM ──
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060402] text-[#F5E6C8]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&display=swap');
        .fp{font-family:'Playfair Display',Georgia,serif;}
        .fc{font-family:'Cormorant Garamond',Georgia,serif;}
        @keyframes vSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .v-spin{animation:vSpin 1.8s linear infinite;}
        @keyframes vSheen{0%{transform:rotate(0deg);opacity:.2}50%{opacity:.06}100%{transform:rotate(360deg);opacity:.2}}
        .v-sheen{position:absolute;inset:0;border-radius:9999px;background:conic-gradient(from 0deg,rgba(255,255,255,.15),rgba(255,255,255,0) 35%,rgba(255,255,255,.06) 55%,rgba(255,255,255,0) 75%,rgba(255,255,255,.12));mix-blend-mode:screen;pointer-events:none;}
        .v-sheen.on{animation:vSheen 1.8s linear infinite;}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
        @keyframes nSpark{0%{transform:scale(.4);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}
        .nspark{animation:nSpark 550ms ease-out both;}
        input[type=range].vsl{-webkit-appearance:none;background:rgba(255,255,255,.12);border-radius:3px;height:3px;}
        input[type=range].vsl::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#C47A2C;cursor:pointer;}
      `}</style>

      {/* Ambient wash */}
      <div className="absolute inset-0 pointer-events-none z-0"
        style={{background:`radial-gradient(ellipse at 25% 35%,rgba(${cr},${cg},${cb2},0.2) 0%,transparent 55%),radial-gradient(ellipse at 75% 75%,rgba(${cr},${cg},${cb2},0.09) 0%,transparent 50%)`}}/>

      {/* Name prompt */}
      {!nameSet&&(
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/82 backdrop-blur-md">
          <div className="rounded-2xl bg-black/80 p-10 text-center w-80 shadow-2xl"
            style={{border:`1px solid rgba(${cr},${cg},${cb2},0.25)`}}>
            <div className="fp font-black text-4xl mb-1 text-white">Welcome</div>
            <div className="fc text-sm tracking-[0.5em] uppercase mb-7" style={{color:`rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+20,255)},0.7)`}}>
              AlbumClub · Russo's Lounge
            </div>
            <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveName()}
              className="w-full rounded-lg bg-white/6 border border-white/12 px-4 py-3 text-lg outline-none placeholder:text-white/22 focus:border-white/25 mb-4 fc text-white"
              placeholder="Your name..." maxLength={24}/>
            <button onClick={saveName}
              className="w-full rounded-lg px-4 py-3 fc text-lg tracking-[0.3em] uppercase text-white"
              style={{background:`linear-gradient(to bottom,rgba(${cr},${cg},${cb2},0.65),rgba(${Math.floor(cr*.6)},${Math.floor(cg*.6)},${Math.floor(cb2*.6)},0.8))`,border:`1px solid rgba(${cr},${cg},${cb2},0.35)`}}>
              Enter the Room
            </button>
          </div>
        </div>
      )}

      {/* Background */}
      <img src="/room-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover z-0"
        style={{filter:`brightness(${isLive?0.72:0.5})`,transition:"filter 2s ease"}}/>
      <div className="absolute inset-0 z-[1]" style={{background:"radial-gradient(ellipse at 50% 40%,transparent 10%,rgba(0,0,0,0.62) 100%)"}}/>
      <div className="absolute bottom-0 left-0 right-0 h-64 z-[1]" style={{background:"linear-gradient(to top,rgba(0,0,0,0.97) 0%,transparent 100%)"}}/>
      {isLive&&<div className="absolute inset-0 z-[1] pointer-events-none" style={{background:`radial-gradient(ellipse at 50% 55%,rgba(${cr},${cg},${cb2},0.06) 0%,transparent 60%)`,animation:"pulse 5s ease-in-out infinite"}}/>}

      {/* ── HEADER — dark band for contrast ── */}
      <header className="absolute top-0 left-0 right-0 z-20 px-8 py-4 flex items-center justify-between"
        style={{background:"linear-gradient(to bottom,rgba(0,0,0,0.78) 0%,transparent 100%)"}}>
        <div>
          <div className="fc text-xs tracking-[0.55em] uppercase text-white/60 mb-0.5">Now Playing</div>
          <div className="fp font-black text-3xl text-white">AlbumClub</div>
        </div>

        <div className="flex items-center gap-3">
          {/* Listeners */}
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-sm"
            style={{background:"rgba(0,0,0,0.65)",border:"1px solid rgba(255,255,255,0.22)"}}>
            <div className="w-2.5 h-2.5 rounded-full"
              style={isLive?{background:`rgb(${cr},${cg},${cb2})`,boxShadow:`0 0 8px rgba(${cr},${cg},${cb2},0.9)`,animation:"pulse 2s infinite"}:{background:"rgba(255,255,255,0.35)"}}/>
            <span className="fc text-base text-white font-semibold">{listenerCount} listening</span>
          </div>

          {/* Volume */}
          <div className="relative">
            <button onClick={()=>setShowVolume(v=>!v)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-sm transition"
              style={{background:"rgba(0,0,0,0.65)",border:"1px solid rgba(255,255,255,0.22)"}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                {volume>0&&<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>}
                {volume>0.5&&<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>}
              </svg>
              <span className="fc text-base text-white font-semibold">{Math.round(volume*100)}%</span>
            </button>
            {showVolume&&(
              <div className="absolute top-14 right-0 rounded-xl p-5 w-44 z-30 backdrop-blur-xl"
                style={{background:"rgba(0,0,0,0.92)",border:"1px solid rgba(255,255,255,0.18)"}}>
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={e=>setVolume(parseFloat(e.target.value))} className="vsl w-full"/>
                <div className="text-center fc text-base text-white/55 mt-2">{Math.round(volume*100)}%</div>
              </div>
            )}
          </div>

          {/* Crackle */}
          <button onClick={()=>setCrackleOn(v=>!v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full backdrop-blur-sm transition"
            style={{background:crackleOn?`rgba(${cr},${cg},${cb2},0.28)`:"rgba(0,0,0,0.65)",border:crackleOn?`1px solid rgba(${cr},${cg},${cb2},0.5)`:"1px solid rgba(255,255,255,0.22)"}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            </svg>
            <span className="fc text-base text-white font-semibold">{crackleOn?"Crackle ✓":"Crackle"}</span>
          </button>

          {/* Showtime */}
          <div className="text-right px-1">
            <div className="fc text-xs tracking-[0.4em] uppercase text-white/55">Showtime</div>
            <div className="fc text-xl text-white font-semibold">8:00 PM</div>
          </div>

          {isAdmin ? (
            <button onClick={stopShowtime}
              className="px-5 py-2.5 rounded-lg fc text-base tracking-[0.2em] uppercase text-red-300 border border-red-400/40 bg-red-900/35 hover:bg-red-900/55 transition backdrop-blur-sm font-semibold">
              End Session
            </button>
          ) : isLive ? (
            <button onClick={stopShowtime}
              className="px-5 py-2.5 rounded-lg fc text-base tracking-[0.2em] uppercase text-red-300 border border-red-400/40 bg-red-900/35 hover:bg-red-900/55 transition backdrop-blur-sm font-semibold">
              End Session
            </button>
          ) : (
            <button onClick={triggerShowtime}
              className="px-5 py-2.5 rounded-lg fc text-base tracking-[0.2em] uppercase text-white border border-white/25 bg-black/55 hover:bg-black/75 transition backdrop-blur-sm font-semibold">
              Start Showtime
            </button>
          )}
        </div>
      </header>

      {/* ── ALBUM INFO — LEFT ── */}
      <div className="absolute left-8 z-20" style={{top:"15%",maxWidth:"240px"}}>
        <div className="relative mb-6">
          <div className="absolute -inset-6 rounded-2xl pointer-events-none"
            style={{background:`radial-gradient(ellipse,rgba(${cr},${cg},${cb2},0.38) 0%,transparent 70%)`,filter:"blur(22px)"}}/>
          {coverUrl ? (
            <img src={coverUrl} alt={ALBUM.title} className="relative rounded-xl w-full"
              style={{border:"1px solid rgba(255,255,255,0.1)",boxShadow:`0 35px 90px rgba(0,0,0,0.9),0 0 60px rgba(${cr},${cg},${cb2},0.2)`}}/>
          ) : (
            <div className="relative rounded-xl aspect-square border border-white/8 flex items-center justify-center"
              style={{background:`linear-gradient(135deg,rgba(${cr},${cg},${cb2},0.25),rgba(0,0,0,0.8))`,boxShadow:"0 30px 80px rgba(0,0,0,0.85)"}}>
              <div className="fp text-7xl text-white/12">L</div>
            </div>
          )}
        </div>
        <div className="fp font-black text-5xl leading-none mb-2 text-white" style={{textShadow:"0 2px 40px rgba(0,0,0,0.98)"}}>{ALBUM.title}</div>
        <div className="fp italic text-2xl mb-5" style={{color:`rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+30,255)},0.9)`}}>{ALBUM.artist}</div>
        <div className="space-y-2">
          {[["Year",ALBUM.year],["Label",ALBUM.label],["Genre",ALBUM.genre],["Tracks",`${ALBUM.tracks} tracks`]].map(([k,v])=>(
            <div key={k} className="flex items-center gap-3">
              <span className="fc text-[10px] tracking-[0.4em] uppercase text-white/30 w-14 shrink-0">{k}</span>
              <span className="fc text-base text-white/72">{v}</span>
            </div>
          ))}
        </div>
        {isLive&&(
          <div className="mt-5 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{background:`rgb(${cr},${cg},${cb2})`,boxShadow:`0 0 9px rgba(${cr},${cg},${cb2},1)`,animation:"pulse 1.5s infinite"}}/>
            <span className="fc text-base tracking-[0.35em] uppercase font-semibold" style={{color:`rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+20,255)},0.9)`}}>Live Now</span>
          </div>
        )}
      </div>

      {/* ── TURNTABLE — vertically centered ── */}
      <div className="absolute left-1/2 z-20"
        style={{top:"50%",transform:"translate(-50%,-50%)",width:"320px"}}>

        <div className="relative rounded-2xl overflow-visible"
          style={{background:"linear-gradient(145deg,#1e1208 0%,#120b04 50%,#1c1006 100%)",border:"1px solid rgba(255,255,255,0.07)",boxShadow:"0 35px 90px rgba(0,0,0,0.95),inset 0 1px 0 rgba(255,255,255,0.05)",padding:"28px 28px 20px"}}>

          <div className="relative mx-auto" style={{width:"240px",height:"240px"}}>
            {/* Platter */}
            <div className="absolute inset-0 rounded-full" style={{background:"linear-gradient(145deg,#2c1c0a,#1a0e04)",border:"2px solid rgba(255,255,255,0.05)",boxShadow:"inset 0 3px 10px rgba(0,0,0,0.9)"}}/>
            <div className="absolute inset-[7px] rounded-full" style={{background:"radial-gradient(circle at 40% 35%,#1c1c1c,#0d0d0d)",border:"1px solid rgba(255,255,255,0.03)"}}/>

            {/* Vinyl */}
            <div className={`absolute inset-[12px] rounded-full ${isLive?"v-spin":""}`}
              style={{background:"radial-gradient(circle at 50% 50%,#1c1c1c 0%,#0c0c0c 60%,#141414 100%)"}}>
              {[14,22,30,38,46,54,62,70,78,86].map(r2=>(
                <div key={r2} className="absolute rounded-full border border-white/[0.025]" style={{inset:`${r2/2}%`}}/>
              ))}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-[22%] h-[22%] rounded-full overflow-hidden flex items-center justify-center border border-white/8">
                  {coverUrl&&<img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70"/>}
                  <div className="relative w-[28%] h-[28%] rounded-full bg-[#0a0a0a] z-10"/>
                </div>
              </div>
              <div className={`v-sheen ${isLive?"on":""}`}/>
            </div>

            {/* Spindle */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full z-20"
              style={{background:"linear-gradient(145deg,#999,#555)",boxShadow:"0 1px 4px rgba(0,0,0,0.9)"}}/>

            {/* ── TONEARM
                Geometry matches reference image:
                - Pivot at top-right corner of platter
                - Arm is LONG and points LEFT and slightly down from pivot
                - At rest: -30deg → arm over far right, away from record
                - Start: -25deg → stylus sits on outer groove (left 1/3 of record from center)
                - End:   +2deg  → stylus near label
                The pivot offset (right:-20px, top:-14px) places it just outside top-right of platter
            ── */}
            <div className="absolute z-30" style={{right:"-20px",top:"-14px"}}>
              <div className="relative" style={{width:"56px",height:"56px"}}>
                {/* Bearing housing */}
                <div className="absolute inset-0 rounded-full"
                  style={{background:"linear-gradient(145deg,#3c2c1a,#1c1208)",border:"1px solid rgba(255,255,255,0.13)",boxShadow:"0 5px 15px rgba(0,0,0,0.85)"}}>
                  <div className="absolute inset-[6px] rounded-full"
                    style={{background:"linear-gradient(145deg,#2c200e,#160e04)",border:"1px solid rgba(255,255,255,0.05)"}}/>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full"
                      style={{background:"linear-gradient(145deg,#888,#3a3a3a)",boxShadow:"0 2px 8px rgba(0,0,0,0.9),inset 0 1px 2px rgba(255,255,255,0.18)"}}/>
                  </div>
                </div>

                {/* Arm — pivots from center of housing */}
                <div className="absolute z-10"
                  style={{right:"24px",top:"24px",transformOrigin:"100% 50%",
                    transform:`rotate(${tonearmAngle}deg)`,
                    transition:isLive?"transform 14s linear":"transform 0.7s ease",
                  }}>
                  <div style={{width:"200px",height:"7px",marginTop:"-3.5px",position:"relative"}}>
                    {/* Tube */}
                    <div className="absolute inset-0 rounded-full"
                      style={{background:"linear-gradient(to bottom,rgba(255,255,255,0.22),rgba(255,255,255,0.04) 40%,rgba(0,0,0,0.3))",border:"1px solid rgba(255,255,255,0.1)",boxShadow:"0 2px 10px rgba(0,0,0,0.7)"}}/>
                    {/* Headshell at left end */}
                    <div style={{position:"absolute",left:"-26px",top:"50%",transform:"translateY(-50%) rotate(-12deg)",width:"26px",height:"18px",background:"linear-gradient(145deg,#5a5a5a,#2a2a2a)",borderRadius:"3px",border:"1px solid rgba(255,255,255,0.1)",boxShadow:"0 3px 12px rgba(0,0,0,0.8)"}}>
                      <div style={{position:"absolute",bottom:"-2px",left:"7px",width:"11px",height:"9px",background:"linear-gradient(145deg,#3a3a3a,#111)",borderRadius:"1px",border:"1px solid rgba(255,255,255,0.06)"}}>
                        <div style={{position:"absolute",left:"4px",bottom:"-7px",width:"2px",height:"8px",background:"linear-gradient(to bottom,#bbb,#555)",borderRadius:"0 0 1px 1px"}}/>
                        {/* Stylus tip glows in album color */}
                        <div style={{position:"absolute",left:"3px",bottom:"-12px",width:"3px",height:"3px",borderRadius:"50%",
                          background:isLive?`rgb(${cr},${cg},${cb2})`:"#888",
                          boxShadow:isLive?`0 0 6px rgba(${cr},${cg},${cb2},1),0 0 12px rgba(${cr},${cg},${cb2},0.5)`:"none",
                          transition:"background 0.5s,box-shadow 0.5s"}}/>
                      </div>
                    </div>
                    {/* Counterweight right end */}
                    <div style={{position:"absolute",right:"-6px",top:"50%",transform:"translateY(-50%)",width:"14px",height:"14px",borderRadius:"50%",background:"linear-gradient(145deg,#888,#444)",border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 2px 8px rgba(0,0,0,0.8)"}}/>
                    {/* Anti-skate */}
                    <div style={{position:"absolute",right:"22px",top:"-8px",width:"18px",height:"2px",background:"rgba(255,255,255,0.09)",borderRadius:"1px",transform:"rotate(-18deg)"}}>
                      <div style={{position:"absolute",right:0,top:"-2px",width:"5px",height:"5px",borderRadius:"50%",background:"linear-gradient(145deg,#666,#333)"}}/>
                    </div>
                  </div>
                </div>
                {/* Cueing lever */}
                <div style={{position:"absolute",bottom:"-5px",right:"0",width:"8px",height:"16px",background:"linear-gradient(145deg,#555,#222)",borderRadius:"4px 4px 2px 2px",border:"1px solid rgba(255,255,255,0.07)"}}/>
              </div>
            </div>

            {needleDrop&&(
              <div className="absolute left-[32%] top-[32%] w-7 h-7 nspark z-40">
                <div className="absolute inset-0 rounded-full" style={{background:`rgba(${cr},${cg},${cb2},0.3)`}}/>
                <div className="absolute left-1/2 top-1/2 w-0.5 h-7 -translate-x-1/2 -translate-y-1/2 rounded" style={{background:`rgba(${cr},${cg},${cb2},0.55)`}}/>
                <div className="absolute left-1/2 top-1/2 h-0.5 w-7 -translate-x-1/2 -translate-y-1/2 rounded" style={{background:`rgba(${cr},${cg},${cb2},0.55)`}}/>
              </div>
            )}
          </div>

          {/* Speed / status */}
          <div className="flex justify-between items-center mt-4 px-1">
            <div className="flex items-center gap-3">
              {["33⅓","45"].map((s,i)=>(
                <div key={s} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border"
                    style={i===0?{background:`rgb(${cr},${cg},${cb2})`,borderColor:`rgb(${cr},${cg},${cb2})`,boxShadow:`0 0 7px rgba(${cr},${cg},${cb2},0.7)`}:{borderColor:"rgba(255,255,255,0.2)"}}/>
                  <span className="fc text-sm text-white/42">{s}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full"
                style={isLive?{background:"#4ade80",boxShadow:"0 0 7px rgba(74,222,128,0.9)"}:{background:"rgba(255,255,255,0.15)"}}/>
              <span className="fc text-sm text-white/38">{isLive?"ON":"STBY"}</span>
            </div>
          </div>
        </div>

        {/* Track card */}
        {isLive ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/68 backdrop-blur-md px-6 py-5"
            style={{boxShadow:`0 10px 40px rgba(0,0,0,0.7),0 0 0 1px rgba(${cr},${cg},${cb2},0.08)`}}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="fc text-xs tracking-[0.45em] uppercase mb-2 font-semibold"
                  style={{color:`rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+20,255)},0.7)`}}>
                  Track {tIdx+1} of {TRACKS.length}
                </div>
                <div className="fp font-bold text-xl leading-tight text-white">{cur.title}</div>
              </div>
              <div className="text-right fc text-base text-white/52 shrink-0 ml-4">
                <div className="font-semibold text-white/75">{fmt(tEl)}</div>
                <div className="text-white/30">/ {fmt(tDur)}</div>
              </div>
            </div>
            <div className="h-[2px] bg-white/8 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000"
                style={{width:`${tPct}%`,background:`linear-gradient(to right,rgba(${cr},${cg},${cb2},0.5),rgba(${cr},${cg},${cb2},0.9)`}}/>
            </div>
            {next&&<div className="mt-3 fc text-sm text-white/30">Up next — {next.title}</div>}
          </div>
        ):(
          <div className="mt-4 text-center fc text-base tracking-[0.4em] uppercase text-white/22">Waiting for showtime</div>
        )}
      </div>

      {/* ── CHAT ── */}
      <div className={`absolute right-0 top-0 bottom-0 z-20 transition-all duration-300 ${chatExpanded?"w-[420px]":"w-[340px]"}`}>
        {chatOpen ? (
          <div className="flex flex-col h-full"
            style={{background:"linear-gradient(to left,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0.5) 100%)",backdropFilter:"blur(14px)"}}>
            <div className="flex flex-col h-full pt-20 pb-4 px-6 min-h-0">
              <div className="flex items-center justify-between mb-5 shrink-0">
                <div className="flex items-baseline gap-3">
                  <div className="fp font-bold text-2xl text-white">Chat</div>
                  <div className="fc text-xs tracking-[0.45em] uppercase text-white/45">{isLive?"Live":"Lobby"}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>setChatExpanded(e=>!e)}
                    className="px-3 py-1 rounded fc text-sm border border-white/18 bg-black/28 hover:bg-black/48 transition text-white">{chatExpanded?"↙":"↗"}</button>
                  <button onClick={()=>setChatOpen(false)}
                    className="px-3 py-1 rounded fc text-sm border border-white/18 bg-black/28 hover:bg-black/48 transition text-white">✕</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
                {messages.length===0&&<p className="fc italic text-white/22 text-center text-base mt-16">The room is quiet.<br/>Say something.</p>}
                {messages.map(msg=>(
                  <div key={msg.id} className="group">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="fc font-semibold text-base shrink-0" style={{color:`rgba(${Math.min(cr+80,255)},${Math.min(cg+60,255)},${Math.min(cb2+20,255)},0.9)`}}>{msg.display_name}</span>
                      <span className="fc text-xs text-white/18 opacity-0 group-hover:opacity-100 transition">{fmtTs(msg.created_at)}</span>
                    </div>
                    <div className="fc text-white/82 text-base leading-snug">{msg.body}</div>
                  </div>
                ))}
                <div ref={msgEndRef}/>
              </div>
              <div className="shrink-0 mt-4 pt-4 border-t border-white/10 flex gap-2">
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&sendMessage()} disabled={!nameSet}
                  className="flex-1 rounded-lg bg-white/6 border border-white/14 px-4 py-3 text-base outline-none placeholder:text-white/22 focus:border-white/25 disabled:opacity-25 fc text-white"
                  placeholder={nameSet?"Say something...":"Set your name first…"}/>
                <button onClick={sendMessage} disabled={!nameSet||!chatInput.trim()}
                  className="rounded-lg px-5 py-3 fc text-base text-white font-semibold disabled:opacity-20 transition"
                  style={{background:"linear-gradient(to bottom,#5a1a1a,#321010)",border:"1px solid rgba(200,60,60,0.35)"}}>
                  Send
                </button>
              </div>
            </div>
          </div>
        ):(
          <button onClick={()=>setChatOpen(true)}
            className="absolute right-4 top-20 flex items-center gap-2 rounded-full border border-white/18 bg-black/62 backdrop-blur-md px-4 py-2.5 hover:bg-black/82 transition">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="fc text-base text-white font-semibold">Chat</span>
            {messages.length>0&&<span className="w-5 h-5 rounded-full bg-white/22 text-[10px] flex items-center justify-center text-white">{messages.length}</span>}
          </button>
        )}
      </div>

      <audio ref={audioRef}
        src="https://obnhrzehigtbadynicss.supabase.co/storage/v1/object/public/Albums/Lonerism.mp3"
        preload="auto" crossOrigin="anonymous"/>
    </main>
  );
}
