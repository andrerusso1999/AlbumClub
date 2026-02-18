"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Album = { id: string; title: string; artist: string; year: string; mbQuery: string; };

const ROOM_ID = "main";
const albums: Album[] = [
  { id: "mysticism-romance", title: "Mysticism & Romance", artist: "Tony Newton",  year: "1976", mbQuery: "artist:\"tony newton\" AND release:\"mysticism\"" },
  { id: "lonerism",          title: "Lonerism",            artist: "Tame Impala",  year: "2012", mbQuery: "artist:\"tame impala\" AND release:\"lonerism\"" },
  { id: "abbey-road",        title: "Abbey Road",          artist: "The Beatles",  year: "1969", mbQuery: "artist:\"the beatles\" AND release:\"abbey road\"" },
];

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
  const t = Math.floor(Math.max(0,ms) / 1000);
  const h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

async function fetchCover(album: Album): Promise<string> {
  const k = `ac_cover_${album.id}`;
  const c = localStorage.getItem(k);
  if (c) return c;
  try {
    const r = await fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(album.mbQuery)}&fmt=json&limit=5`);
    const d = await r.json();
    // Find the release that matches the year
    const match = d?.releases?.find((rel: any) => rel.date?.startsWith(album.year)) || d?.releases?.[0];
    const mbid = match?.id;
    if (!mbid) return "";
    const art = await fetch(`https://coverartarchive.org/release/${mbid}`).then(r=>r.json());
    const url = art?.images?.find((i:any)=>i.front)?.thumbnails?.large || art?.images?.[0]?.image || "";
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

  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(id); },[]);
  useEffect(()=>{ setUserId(getOrCreateUserId()); },[]);

  useEffect(()=>{
    // Clear stale covers so we re-fetch with better queries
    albums.forEach(async (album)=>{
      const url = await fetchCover(album);
      if (url) setCovers(prev=>({...prev,[album.id]:url}));
    });
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
    setVotes(prev=>{
      const n={...prev};
      if (myVote) n[myVote]=Math.max(0,(n[myVote]||1)-1);
      n[id]=(n[id]||0)+1;
      return n;
    });
    setMyVote(id);
    if (myVote) await supabase.from("votes").delete().eq("room_id",ROOM_ID).eq("user_id",userId);
    await supabase.from("votes").insert({room_id:ROOM_ID,album_id:id,user_id:userId});
  };

  const showtimeDate = useMemo(()=>{ const t=new Date(now); t.setHours(20,0,0,0); if(now>t) t.setDate(t.getDate()+1); return t; },[now]);
  const countdown    = useMemo(()=>msToClock(showtimeDate.getTime()-now.getTime()),[showtimeDate,now]);
  const totalVotes   = Object.values(votes).reduce((a,b)=>a+b,0);
  const myAlbum      = myVote ? albums.find(a=>a.id===myVote) : null;
  const maxVotes     = Math.max(0,...Object.values(votes));

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060402] text-[#F5E6C8]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&display=swap');
        .font-playfair  { font-family:'Playfair Display',Georgia,serif; }
        .font-cormorant { font-family:'Cormorant Garamond',Georgia,serif; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .fade-up { animation: fadeUp 0.7s ease both; }
        @keyframes softPulse { 0%,100%{opacity:.5} 50%{opacity:1} }
      `}</style>

      {/* Background */}
      <img src="/lobby-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"/>
      <div className="absolute inset-0 bg-black/60"/>
      <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 45%,transparent 20%,rgba(0,0,0,0.72) 100%)"}}/>
      <div className="absolute top-0 left-0 right-0 h-40" style={{background:"linear-gradient(to bottom,rgba(0,0,0,0.75) 0%,transparent 100%)"}}/>
      <div className="absolute bottom-0 left-0 right-0 h-48" style={{background:"linear-gradient(to top,rgba(0,0,0,0.95) 0%,transparent 100%)"}}/>

      {/* ── HEADER ── */}
      <header className="relative z-10 text-center pt-8 fade-up">
        <div className="font-cormorant text-sm tracking-[0.6em] uppercase text-[#C47A2C]/75 mb-3">
          AlbumClub · Tonight&apos;s Lobby
        </div>
        <h1 className="font-playfair font-black text-6xl md:text-7xl tracking-tight mb-4"
          style={{textShadow:"0 4px 40px rgba(0,0,0,0.9)"}}>
          Showtime Selection
        </h1>
        <div className="flex items-center justify-center gap-8 mt-4">
          <div className="h-px w-32 bg-[#C47A2C]/35"/>
          <div className="text-center">
            <div className="font-cormorant text-sm tracking-[0.5em] uppercase text-white/40 mb-1">Scheduled for</div>
            <div className="font-playfair text-3xl text-[#C47A2C]">08:00 PM</div>
          </div>
          <div className="h-px w-32 bg-[#C47A2C]/35"/>
        </div>
        <div className="font-cormorant text-xl text-white/45 mt-3 italic">
          Doors open in <span className="font-playfair text-white/75 not-italic text-xl">{countdown}</span>
        </div>
      </header>

      {/* ── ALBUMS ── */}
      <section className="relative z-10 flex flex-col items-center mt-8 px-6">
        <div className="font-cormorant text-sm tracking-[0.5em] uppercase text-white/30 mb-8">
          Vote for tonight&apos;s record — one album, one showtime, no skips
        </div>

        <div className="flex items-end justify-center gap-10 md:gap-16">
          {albums.map((album, i)=>{
            const count   = votes[album.id]||0;
            const pct     = totalVotes>0 ? Math.round((count/totalVotes)*100) : 0;
            const isVoted = myVote===album.id;
            const isLeader = count>0 && count===maxVotes;

            return (
              <button key={album.id} onClick={()=>castVote(album.id)}
                className="relative flex flex-col items-center group fade-up"
                style={{
                  animationDelay:`${i*0.13}s`,
                  transform: isVoted ? "translateY(-18px) scale(1.05)" : "translateY(0) scale(1)",
                  transition:"transform 0.4s cubic-bezier(0.22,1,0.36,1)",
                }}>

                {/* Leading label */}
                {isLeader && (
                  <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap font-cormorant text-sm tracking-[0.4em] uppercase text-[#C47A2C]">
                    ✦ Leading
                  </div>
                )}

                {/* Cover frame — all same size */}
                <div className="relative overflow-hidden rounded-lg"
                  style={{
                    width:"210px", height:"210px",
                    border: isVoted ? "3px solid #C47A2C" : "2px solid rgba(255,255,255,0.1)",
                    boxShadow: isVoted
                      ? "0 35px 90px rgba(0,0,0,0.85), 0 0 50px rgba(196,122,44,0.4)"
                      : "0 20px 65px rgba(0,0,0,0.75)",
                    transition:"border 0.3s, box-shadow 0.3s",
                  }}>
                  {covers[album.id] ? (
                    <img src={covers[album.id]} alt={album.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"/>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"
                      style={{background:"linear-gradient(135deg,#1a1a2e,#0d0d1a)"}}>
                      <div className="font-playfair text-6xl text-white/15">{album.artist[0]}</div>
                    </div>
                  )}
                  {/* Voted badge */}
                  {isVoted && (
                    <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[#C47A2C] flex items-center justify-center shadow-lg">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 7l3.5 3.5 5.5-6.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{background:"rgba(0,0,0,0.48)"}}>
                    <span className="font-cormorant text-base tracking-[0.5em] uppercase text-white">
                      {isVoted?"✓ Voted":"Vote"}
                    </span>
                  </div>
                </div>

                {/* Info */}
                <div className="mt-4 text-center px-2" style={{width:"210px"}}>
                  <div className="font-playfair font-bold text-xl leading-tight text-white"
                    style={{textShadow:"0 2px 16px rgba(0,0,0,0.95)"}}>
                    {album.title}
                  </div>
                  <div className="font-cormorant text-base text-[#C47A2C] tracking-wide mt-1">
                    {album.artist} · {album.year}
                  </div>
                  <div className="font-cormorant text-base text-white/40 mt-1">
                    {count} vote{count!==1?"s":""}
                    {totalVotes>0&&<span className="text-white/22 ml-1.5">· {pct}%</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Enter Room — centered under albums */}
        <div className="mt-12 flex flex-col items-center gap-3 fade-up" style={{animationDelay:"0.45s"}}>
          <Link href="/room"
            className="px-14 py-4 rounded-sm font-cormorant text-xl tracking-[0.45em] uppercase transition-all duration-300 group"
            style={{
              background:"linear-gradient(to bottom,#7a3018,#4a1a0a)",
              border:"1px solid #C47A2C",
              boxShadow:"0 0 35px rgba(196,122,44,0.3), inset 0 1px 0 rgba(255,200,100,0.08)",
            }}>
            Enter Room
            <span className="ml-3 inline-block group-hover:translate-x-1.5 transition-transform duration-200">→</span>
          </Link>
          <div className="font-cormorant text-sm tracking-[0.4em] uppercase text-white/22">
            You can enter without voting
          </div>
        </div>
      </section>

      {/* ── BOTTOM: your pick ── */}
      <div className="fixed bottom-0 left-0 right-0 z-10 px-8 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="font-cormorant text-sm tracking-[0.45em] uppercase text-white/30">Your Pick</div>
            {myAlbum ? (
              <div className="flex items-center gap-4">
                {covers[myAlbum.id] && (
                  <div className="w-12 h-12 rounded overflow-hidden border border-[#C47A2C]/50 shadow-lg shrink-0"
                    style={{boxShadow:"0 4px 20px rgba(196,122,44,0.25)"}}>
                    <img src={covers[myAlbum.id]} alt="" className="w-full h-full object-cover"/>
                  </div>
                )}
                <div>
                  <div className="font-playfair text-lg font-bold leading-tight">{myAlbum.title}</div>
                  <div className="font-cormorant text-sm text-[#C47A2C]">{myAlbum.artist}</div>
                </div>
              </div>
            ) : (
              <div className="font-cormorant text-base text-white/25 italic">Not cast yet</div>
            )}
          </div>
          {totalVotes>0 && (
            <div className="font-cormorant text-base text-white/30">
              {totalVotes} vote{totalVotes!==1?"s":""} cast tonight
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
