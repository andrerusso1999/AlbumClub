"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Album = { id: string; title: string; artist: string; year: string; mbid?: string; };

const ROOM_ID = "main";
const SHOWTIME_HOUR = 20;

// Hard-coded MBIDs for reliable covers — no query ambiguity
const albums: Album[] = [
  { id: "mysticism-romance", title: "Mysticism & Romance", artist: "Tony Newton",  year: "1976" },
  { id: "lonerism",          title: "Lonerism",            artist: "Tame Impala",  year: "2012", mbid: "a2bf9a22-3519-4384-b4e2-a4b2b7a9a9e1" },
  { id: "abbey-road",        title: "Abbey Road",          artist: "The Beatles",  year: "1969", mbid: "b84ee12a-09ef-421b-82de-0441a926375b" },
];

// Direct CAA URLs for known albums — fallback to query
const COVER_OVERRIDES: Record<string, string> = {
  "lonerism":   "https://coverartarchive.org/release/a2bf9a22-3519-4384-b4e2-a4b2b7a9a9e1/front-500",
  "abbey-road": "https://coverartarchive.org/release/b84ee12a-09ef-421b-82de-0441a926375b/front-500",
};

function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "";
  const k = "ac_user_id";
  const s = localStorage.getItem(k);
  if (s) return s;
  const id = crypto.randomUUID();
  localStorage.setItem(k, id);
  return id;
}

function msToClock(ms: number) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

async function fetchCover(album: Album): Promise<string> {
  const k = `ac_cover2_${album.id}`;
  // Clear old cache for abbey road since it was wrong
  if (album.id === "abbey-road") localStorage.removeItem("ac_cover_abbey-road");

  const cached = localStorage.getItem(k);
  if (cached) return cached;

  // Use direct override if available
  if (COVER_OVERRIDES[album.id]) {
    localStorage.setItem(k, COVER_OVERRIDES[album.id]);
    return COVER_OVERRIDES[album.id];
  }

  try {
    // Search with strict year filter
    const res = await fetch(
      `https://musicbrainz.org/ws/2/release/?query=artist:"${encodeURIComponent(album.artist)}" AND release:"${encodeURIComponent(album.title)}" AND date:${album.year}&fmt=json&limit=5`
    );
    const data = await res.json();
    const mbid = data?.releases?.[0]?.id;
    if (!mbid) return "";
    const art = await fetch(`https://coverartarchive.org/release/${mbid}`).then(r => r.json());
    const url = art?.images?.find((i: any) => i.front)?.thumbnails?.large || art?.images?.[0]?.image || "";
    if (url) localStorage.setItem(k, url);
    return url;
  } catch { return ""; }
}

export default function LobbyPage() {
  const [votes, setVotes]   = useState<Record<string,number>>({});
  const [myVote, setMyVote] = useState<string|null>(null);
  const [now, setNow]       = useState(()=>new Date());
  const [userId, setUserId] = useState("");
  const [covers, setCovers] = useState<Record<string,string>>({});
  const [isLocked, setIsLocked] = useState(true); // room locked until showtime
  const [isAdmin, setIsAdmin]   = useState(false);

  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(id); },[]);
  useEffect(()=>{ setUserId(getOrCreateUserId()); },[]);
  useEffect(()=>{ setIsAdmin(localStorage.getItem("ac_admin")==="true"); },[]);
  useEffect(()=>{
    albums.forEach(async a=>{
      const url = await fetchCover(a);
      if (url) setCovers(prev=>({...prev,[a.id]:url}));
    });
  },[]);

  // Check if room is open (at or past showtime)
  useEffect(()=>{
    const check = () => {
      const t = new Date(); t.setHours(SHOWTIME_HOUR,0,0,0);
      setIsLocked(new Date() < t);
    };
    check();
    const iv = setInterval(check, 5000);
    return ()=>clearInterval(iv);
  },[]);

  useEffect(()=>{
    if (!userId) return;
    const load = async () => {
      const {data} = await supabase.from("votes").select("album_id").eq("room_id",ROOM_ID);
      if (!data) return;
      const c: Record<string,number> = {};
      for (const r of data) c[r.album_id] = (c[r.album_id]||0)+1;
      setVotes(c);
    };
    const loadMine = async () => {
      const {data} = await supabase.from("votes").select("album_id").eq("room_id",ROOM_ID).eq("user_id",userId).maybeSingle();
      if (data) setMyVote(data.album_id);
    };
    load(); loadMine();
    const ch = supabase.channel("votes-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"votes",filter:`room_id=eq.${ROOM_ID}`},load)
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  },[userId]);

  const castVote = async (id: string) => {
    if (!userId) return;
    setVotes(prev=>{ const n={...prev}; if(myVote) n[myVote]=Math.max(0,(n[myVote]||1)-1); n[id]=(n[id]||0)+1; return n; });
    setMyVote(id);
    if (myVote) await supabase.from("votes").delete().eq("room_id",ROOM_ID).eq("user_id",userId);
    await supabase.from("votes").insert({room_id:ROOM_ID,album_id:id,user_id:userId});
  };

  const showtimeDate = useMemo(()=>{ const t=new Date(); t.setHours(SHOWTIME_HOUR,0,0,0); if(new Date()>t) t.setDate(t.getDate()+1); return t; },[now]);
  const msLeft     = showtimeDate.getTime() - now.getTime();
  const countdown  = msToClock(msLeft);
  const totalVotes = Object.values(votes).reduce((a,b)=>a+b,0);
  const myAlbum    = myVote ? albums.find(a=>a.id===myVote) : null;
  const maxVotes   = Math.max(0,...Object.values(votes));

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060402] text-[#F5E6C8]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&display=swap');
        .fp { font-family:'Playfair Display',Georgia,serif; }
        .fc { font-family:'Cormorant Garamond',Georgia,serif; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        .fu { animation: fadeUp 0.65s ease both; }
        @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
      `}</style>

      {/* Background */}
      <img src="/lobby-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"/>
      <div className="absolute inset-0 bg-black/58"/>
      <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 45%,transparent 18%,rgba(0,0,0,0.75) 100%)"}}/>
      <div className="absolute top-0 left-0 right-0 h-44" style={{background:"linear-gradient(to bottom,rgba(0,0,0,0.82) 0%,transparent 100%)"}}/>
      <div className="absolute bottom-0 left-0 right-0 h-48" style={{background:"linear-gradient(to top,rgba(0,0,0,0.96) 0%,transparent 100%)"}}/>

      {/* ── HEADER ── */}
      <header className="relative z-10 text-center pt-8 fu">
        {/* High contrast top label */}
        <div className="inline-block px-4 py-1.5 rounded-full bg-black/60 border border-white/20 mb-4"
          style={{backdropFilter:"blur(8px)"}}>
          <span className="fc text-sm tracking-[0.5em] uppercase text-white font-semibold">
            AlbumClub · Tonight&apos;s Lobby
          </span>
        </div>

        <h1 className="fp font-black leading-none mb-4"
          style={{fontSize:"clamp(3rem,8vw,5.5rem)",textShadow:"0 4px 40px rgba(0,0,0,0.95), 0 0 80px rgba(0,0,0,0.8)"}}>
          Showtime Selection
        </h1>

        <div className="flex items-center justify-center gap-6 mb-3">
          <div className="h-px w-28 bg-[#C47A2C]/45"/>
          <div>
            <div className="fc text-base tracking-[0.4em] uppercase text-white/60 mb-0.5">Scheduled for</div>
            <div className="fp text-3xl text-[#C47A2C]">08:00 PM</div>
          </div>
          <div className="h-px w-28 bg-[#C47A2C]/45"/>
        </div>

        <div className="fc text-xl text-white/65 italic">
          Doors open in{" "}
          <span className="fp text-white not-italic text-xl">{countdown}</span>
        </div>
      </header>

      {/* ── ALBUMS ── */}
      <section className="relative z-10 flex flex-col items-center mt-6 px-6">
        <div className="fc text-base text-white/70 mb-8 tracking-wide">
          Vote for tonight&apos;s record. One album, one showtime.
        </div>

        {/* Grid — all items baseline-aligned to bottom, equal height cells */}
        <div className="grid grid-cols-3 gap-10 md:gap-14" style={{alignItems:"end"}}>
          {albums.map((album,i)=>{
            const count   = votes[album.id]||0;
            const pct     = totalVotes>0 ? Math.round((count/totalVotes)*100) : 0;
            const isVoted = myVote===album.id;
            const isLeading = count>0 && count===maxVotes;

            return (
              <div key={album.id} className="flex flex-col items-center fu" style={{animationDelay:`${i*0.12}s`}}>
                {/* Leading badge — fixed height so it doesn't push album */}
                <div className="h-7 flex items-center justify-center mb-1">
                  {isLeading && (
                    <span className="fc text-sm tracking-[0.4em] uppercase text-[#C47A2C]">✦ Leading</span>
                  )}
                </div>

                <button onClick={()=>castVote(album.id)}
                  className="relative group"
                  style={{
                    transform: isVoted ? "translateY(-14px)" : "translateY(0)",
                    transition:"transform 0.45s cubic-bezier(0.22,1,0.36,1)",
                  }}>

                  {/* Cover — fixed size */}
                  <div className="relative overflow-hidden rounded-lg"
                    style={{
                      width:"200px", height:"200px",
                      border: isVoted ? "3px solid #C47A2C" : "2px solid rgba(255,255,255,0.12)",
                      boxShadow: isVoted
                        ? "0 30px 80px rgba(0,0,0,0.85), 0 0 50px rgba(196,122,44,0.38)"
                        : "0 18px 60px rgba(0,0,0,0.75)",
                      transition:"border 0.3s, box-shadow 0.3s",
                    }}>
                    {covers[album.id] ? (
                      <img src={covers[album.id]} alt={album.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"/>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#1a1a2e]">
                        <span className="fp text-5xl text-white/12">{album.artist[0]}</span>
                      </div>
                    )}
                    {isVoted && (
                      <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[#C47A2C] flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2.5 7l3.5 3.5 5.5-6.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/45">
                      <span className="fc text-base tracking-[0.5em] uppercase text-white">{isVoted?"✓ Voted":"Vote"}</span>
                    </div>
                  </div>

                  {/* Info — fixed height container so all albums same total height */}
                  <div className="mt-4 text-center" style={{width:"200px"}}>
                    <div className="fp font-bold text-xl leading-tight text-white" style={{textShadow:"0 2px 16px rgba(0,0,0,0.95)"}}>
                      {album.title}
                    </div>
                    <div className="fc text-base text-[#C47A2C] mt-1">{album.artist} · {album.year}</div>
                    <div className="fc text-base text-white/45 mt-1">
                      {count} vote{count!==1?"s":""}
                      {totalVotes>0&&<span className="text-white/25 ml-1.5">· {pct}%</span>}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* Enter Room button */}
        <div className="mt-10 flex flex-col items-center gap-3 fu" style={{animationDelay:"0.45s"}}>
          {isLocked && !isAdmin ? (
            <div className="flex flex-col items-center gap-2">
              <div className="px-12 py-4 rounded-sm fc text-xl tracking-[0.4em] uppercase text-white/30 border border-white/12 bg-black/30">
                Room Opens at 8:00 PM
              </div>
              <div className="fc text-sm text-white/30 tracking-[0.3em] uppercase">
                Come back at showtime
              </div>
            </div>
          ) : (
            <>
              <Link href="/room"
                className="px-14 py-4 rounded-sm fc text-xl tracking-[0.45em] uppercase text-white transition-all duration-300 group"
                style={{
                  background:"linear-gradient(to bottom,#7a3018,#4a1a0a)",
                  border:"1px solid #C47A2C",
                  boxShadow:"0 0 35px rgba(196,122,44,0.3), inset 0 1px 0 rgba(255,200,100,0.08)",
                }}>
                Enter Room
                <span className="ml-3 inline-block group-hover:translate-x-1.5 transition-transform">→</span>
              </Link>
              <div className="fc text-sm text-white/30 tracking-[0.35em] uppercase">
                You can enter without voting
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── YOUR PICK — bottom ── */}
      <div className="fixed bottom-0 left-0 right-0 z-10 px-8 py-5">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="fc text-sm tracking-[0.45em] uppercase text-white/35">Your Pick</div>
            {myAlbum ? (
              <div className="flex items-center gap-4">
                {covers[myAlbum.id] && (
                  <div className="w-11 h-11 rounded overflow-hidden border border-[#C47A2C]/50 shadow-lg shrink-0">
                    <img src={covers[myAlbum.id]} alt="" className="w-full h-full object-cover"/>
                  </div>
                )}
                <div>
                  <div className="fp text-lg font-bold leading-tight text-white">{myAlbum.title}</div>
                  <div className="fc text-sm text-[#C47A2C]">{myAlbum.artist}</div>
                </div>
              </div>
            ) : (
              <div className="fc text-base text-white/28 italic">Not cast yet</div>
            )}
          </div>
          {totalVotes>0&&(
            <div className="fc text-base text-white/32">{totalVotes} vote{totalVotes!==1?"s":""} tonight</div>
          )}
        </div>
      </div>
    </main>
  );
}
