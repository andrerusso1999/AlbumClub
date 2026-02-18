"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

type Album = { id: string; title: string; artist: string; year: string; mbArtist: string; mbAlbum: string; };

const ROOM_ID = "main";
const SHOWTIME_HOUR_24 = 20;
const SHOWTIME_MIN = 0;

const albums: Album[] = [
  { id: "mysticism-romance", title: "Mysticism & Romance", artist: "Tony Newton",  year: "1976", mbArtist: "tony newton",  mbAlbum: "mysticism romance" },
  { id: "lonerism",          title: "Lonerism",            artist: "Tame Impala",  year: "2012", mbArtist: "tame impala",  mbAlbum: "lonerism"          },
  { id: "abbey-road",        title: "Abbey Road",          artist: "The Beatles",  year: "1969", mbArtist: "the beatles",  mbAlbum: "abbey road"        },
];

function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "";
  const key = "ac_user_id";
  const s = localStorage.getItem(key);
  if (s) return s;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function msToClock(ms: number) {
  const c = Math.max(0, ms);
  const t = Math.floor(c / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function getTonightShowtimeMs(now: Date) {
  const t = new Date(now);
  t.setHours(SHOWTIME_HOUR_24, SHOWTIME_MIN, 0, 0);
  if (now.getTime() > t.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

async function fetchCover(album: Album): Promise<string> {
  const cacheKey = `ac_cover_${album.id}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(album.mbAlbum + " " + album.mbArtist)}&fmt=json&limit=3`);
    const data = await res.json();
    const mbid = data?.releases?.[0]?.id;
    if (!mbid) return "";
    const art = await fetch(`https://coverartarchive.org/release/${mbid}`).then(r => r.json());
    const url = art?.images?.find((i: any) => i.front)?.thumbnails?.large || art?.images?.[0]?.image || "";
    if (url) localStorage.setItem(cacheKey, url);
    return url;
  } catch { return ""; }
}

export default function LobbyPage() {
  const [votes, setVotes]     = useState<Record<string, number>>({});
  const [myVote, setMyVote]   = useState<string | null>(null);
  const [now, setNow]         = useState<Date>(() => new Date());
  const [userId, setUserId]   = useState("");
  const [covers, setCovers]   = useState<Record<string, string>>({});
  const [entering, setEntering] = useState(false);
  const routerRef = useRef<any>(null);

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { setUserId(getOrCreateUserId()); }, []);

  // Fetch all covers
  useEffect(() => {
    albums.forEach(async (album) => {
      const url = await fetchCover(album);
      if (url) setCovers(prev => ({ ...prev, [album.id]: url }));
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const { data } = await supabase.from("votes").select("album_id").eq("room_id", ROOM_ID);
      if (!data) return;
      const c: Record<string, number> = {};
      for (const r of data) c[r.album_id] = (c[r.album_id] || 0) + 1;
      setVotes(c);
    };
    const loadMine = async () => {
      const { data } = await supabase.from("votes").select("album_id").eq("room_id", ROOM_ID).eq("user_id", userId).maybeSingle();
      if (data) setMyVote(data.album_id);
    };
    load(); loadMine();
    const ch = supabase.channel("votes-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${ROOM_ID}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const castVote = async (id: string) => {
    if (!userId) return;
    setVotes(prev => {
      const n = { ...prev };
      if (myVote) n[myVote] = Math.max(0, (n[myVote] || 1) - 1);
      n[id] = (n[id] || 0) + 1;
      return n;
    });
    setMyVote(id);
    if (myVote) await supabase.from("votes").delete().eq("room_id", ROOM_ID).eq("user_id", userId);
    await supabase.from("votes").insert({ room_id: ROOM_ID, album_id: id, user_id: userId });
  };

  const handleEnterRoom = () => {
    setEntering(true);
  };

  const showtimeMs = useMemo(() => getTonightShowtimeMs(now), [now]);
  const countdown  = useMemo(() => msToClock(showtimeMs - now.getTime()), [showtimeMs, now]);
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const myAlbum    = myVote ? albums.find(a => a.id === myVote) : null;

  // Format showtime
  const showtimeDate = new Date();
  showtimeDate.setHours(20, 0, 0, 0);
  const showtimeStr = showtimeDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0806] text-[#F5E6C8]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
        .font-playfair  { font-family: 'Playfair Display', Georgia, serif; }
        .font-cormorant { font-family: 'Cormorant Garamond', Georgia, serif; }
        .album-card:hover .album-hover { opacity: 1; }
        @keyframes zoomIn { from { transform: scale(1); opacity:1; } to { transform: scale(2.5); opacity:0; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.6s ease both; }
        ${entering ? ".enter-zoom { animation: zoomIn 0.8s ease-in forwards; }" : ""}
      `}</style>

      {/* Background */}
      <div className={`absolute inset-0 ${entering ? "enter-zoom" : ""}`}>
        <img src="/lobby-bg.jpg" alt="" className="w-full h-full object-cover"/>
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/55"/>
        {/* Vignette */}
        <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 50%, transparent 25%, rgba(0,0,0,0.7) 100%)"}}/>
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-52" style={{background:"linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 100%)"}}/>
        {/* Top fade */}
        <div className="absolute top-0 left-0 right-0 h-32" style={{background:"linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)"}}/>
      </div>

      {/* ── HEADER ── */}
      <header className="relative z-10 text-center pt-8 pb-2 fade-up">
        <div className="text-[10px] tracking-[0.6em] uppercase text-[#C47A2C] mb-2 font-cormorant">AlbumClub · Tonight&apos;s Lobby</div>
        <h1 className="font-playfair font-black text-5xl md:text-6xl tracking-tight mb-3"
          style={{textShadow:"0 2px 30px rgba(0,0,0,0.8)"}}>
          Showtime Selection
        </h1>
        <div className="flex items-center justify-center gap-6 mt-3">
          <div className="h-px w-24 bg-[#C47A2C]/40"/>
          <div className="text-center">
            <div className="text-[10px] tracking-[0.5em] uppercase text-[#F5E6C8]/40 font-cormorant">Scheduled for</div>
            <div className="font-playfair text-2xl text-[#C47A2C]">{showtimeStr}</div>
          </div>
          <div className="h-px w-24 bg-[#C47A2C]/40"/>
        </div>
        <div className="mt-2 font-cormorant text-[#F5E6C8]/50 text-lg italic">
          Doors open in <span className="font-playfair text-[#F5E6C8]/80 not-italic">{countdown}</span>
        </div>
      </header>

      {/* ── ALBUM SELECTION ── */}
      <section className="relative z-10 flex flex-col items-center justify-center px-8 mt-6">
        <div className="text-[10px] tracking-[0.5em] uppercase text-[#F5E6C8]/35 font-cormorant mb-6">
          Vote for tonight&apos;s record — one album, one showtime, no skips
        </div>

        {/* Album cards */}
        <div className="flex items-end justify-center gap-6 md:gap-10">
          {albums.map((album, i) => {
            const count    = votes[album.id] || 0;
            const pct      = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isVoted  = myVote === album.id;
            const isLeader = count > 0 && count === Math.max(...Object.values(votes));

            return (
              <button key={album.id} onClick={() => castVote(album.id)}
                className="album-card relative flex flex-col items-center group transition-all duration-500 fade-up"
                style={{
                  animationDelay: `${i * 0.12}s`,
                  transform: isVoted ? "translateY(-16px) scale(1.04)" : "scale(1)",
                }}>

                {/* Leader crown */}
                {isLeader && count > 0 && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-[#C47A2C] font-cormorant text-xs tracking-[0.3em] uppercase whitespace-nowrap">
                    ✦ Leading
                  </div>
                )}

                {/* Frame */}
                <div className="relative overflow-hidden rounded-lg transition-all duration-400"
                  style={{
                    width: "200px", height: "200px",
                    border: isVoted ? "3px solid #C47A2C" : "2px solid rgba(255,255,255,0.12)",
                    boxShadow: isVoted
                      ? "0 30px 80px rgba(0,0,0,0.8), 0 0 40px rgba(196,122,44,0.35), 0 0 80px rgba(196,122,44,0.15)"
                      : "0 20px 60px rgba(0,0,0,0.7)",
                  }}>
                  {covers[album.id] ? (
                    <img src={covers[album.id]} alt={album.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"/>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"
                      style={{background:`linear-gradient(135deg, #1a1a2e, #16213e)`}}>
                      <div className="font-playfair text-5xl text-white/20">
                        {album.artist.charAt(0)}
                      </div>
                    </div>
                  )}

                  {/* Voted badge */}
                  {isVoted && (
                    <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#C47A2C] flex items-center justify-center shadow-lg">
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <path d="M2 6.5l3.5 3.5 5.5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="album-hover absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300"
                    style={{background:"rgba(0,0,0,0.5)"}}>
                    <span className="font-cormorant text-sm tracking-[0.4em] uppercase text-[#F5E6C8]">
                      {isVoted ? "✓ Voted" : "Vote"}
                    </span>
                  </div>
                </div>

                {/* Info plate */}
                <div className="mt-3 text-center px-2" style={{width:"200px"}}>
                  <div className="font-playfair font-bold text-lg leading-tight text-[#F5E6C8]"
                    style={{textShadow:"0 2px 12px rgba(0,0,0,0.9)"}}>
                    {album.title}
                  </div>
                  <div className="font-cormorant text-sm text-[#C47A2C] tracking-wide mt-0.5">
                    {album.artist} · {album.year}
                  </div>
                  <div className="font-cormorant text-sm text-[#F5E6C8]/45 mt-1">
                    {count} vote{count !== 1 ? "s" : ""}
                    {totalVotes > 0 && <span className="text-[#F5E6C8]/25 ml-1">· {pct}%</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Enter Room button — centered under albums */}
        <div className="mt-10 flex flex-col items-center gap-4 fade-up" style={{animationDelay:"0.4s"}}>
          <Link href="/room" onClick={() => setEntering(true)}
            className="relative px-12 py-4 rounded-sm font-cormorant text-lg tracking-[0.4em] uppercase transition-all duration-300 group"
            style={{
              background:"linear-gradient(to bottom, #7a3018, #4a1a0a)",
              border:"1px solid #C47A2C",
              boxShadow:"0 0 30px rgba(196,122,44,0.25), inset 0 1px 0 rgba(255,200,100,0.1)",
            }}>
            Enter Room
            <span className="ml-3 group-hover:translate-x-1 inline-block transition-transform">→</span>
          </Link>
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#F5E6C8]/25 font-cormorant">
            You can enter without voting
          </div>
        </div>
      </section>

      {/* ── BOTTOM: your pick ── */}
      <div className="relative z-10 fixed bottom-0 left-0 right-0 px-8 py-5"
        style={{background:"linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)"}}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">

          {/* Your pick — cover + name side by side */}
          <div className="flex items-center gap-4">
            <div className="text-[10px] tracking-[0.4em] uppercase text-[#F5E6C8]/35 font-cormorant">Your Pick</div>
            {myAlbum ? (
              <div className="flex items-center gap-3">
                {covers[myAlbum.id] && (
                  <div className="w-10 h-10 rounded overflow-hidden border border-[#C47A2C]/40 shadow-lg shrink-0">
                    <img src={covers[myAlbum.id]} alt="" className="w-full h-full object-cover"/>
                  </div>
                )}
                <div>
                  <div className="font-playfair text-base font-bold leading-tight">{myAlbum.title}</div>
                  <div className="font-cormorant text-xs text-[#C47A2C]">{myAlbum.artist}</div>
                </div>
              </div>
            ) : (
              <div className="font-cormorant text-sm text-[#F5E6C8]/30 italic">Not cast yet</div>
            )}
          </div>

          {/* Total votes */}
          {totalVotes > 0 && (
            <div className="text-right">
              <div className="font-cormorant text-sm text-[#F5E6C8]/35">
                {totalVotes} vote{totalVotes !== 1 ? "s" : ""} cast tonight
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
