"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

const ROOM_ID      = "main";
const SHOWTIME_HOUR = 20;

// ── Album data with reliable hardcoded cover URLs ─────────────────────────────
// Using Wikipedia/Wikimedia hosted images — stable, no API, no CORS issues
const ALBUMS = [
  {
    id:     "mysticism-romance",
    title:  "Mysticism & Romance",
    artist: "Tony Newton",
    year:   "1976",
    cover:  "https://upload.wikimedia.org/wikipedia/en/5/5c/TonyNewtonMysticismAndRomance.jpg",
  },
  {
    id:     "lonerism",
    title:  "Lonerism",
    artist: "Tame Impala",
    year:   "2012",
    cover:  "https://upload.wikimedia.org/wikipedia/en/4/49/Lonerism.jpg",
  },
  {
    id:     "abbey-road",
    title:  "Abbey Road",
    artist: "The Beatles",
    year:   "1969",
    cover:  "https://upload.wikimedia.org/wikipedia/en/4/42/Beatles_-_Abbey_Road.jpg",
  },
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
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

export default function LobbyPage() {
  const router = useRouter();
  const [votes,   setVotes]   = useState<Record<string, number>>({});
  const [myVote,  setMyVote]  = useState<string | null>(null);
  const [now,     setNow]     = useState(() => new Date());
  const [userId,  setUserId]  = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [zooming, setZooming] = useState(false);   // cinematic zoom state

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { setUserId(getOrCreateUserId()); }, []);
  useEffect(() => { setIsAdmin(localStorage.getItem("ac_admin") === "true"); }, []);

  // Showtime lock
  const isLocked = useMemo(() => {
    const t = new Date(); t.setHours(SHOWTIME_HOUR, 0, 0, 0);
    return now < t;
  }, [now]);

  // Votes
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
      const { data } = await supabase.from("votes").select("album_id")
        .eq("room_id", ROOM_ID).eq("user_id", userId).maybeSingle();
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

  // Cinematic zoom — play animation then navigate
  const enterRoom = () => {
    setZooming(true);
    setTimeout(() => router.push("/room"), 900);
  };

  const showtimeDate = useMemo(() => {
    const t = new Date(); t.setHours(SHOWTIME_HOUR, 0, 0, 0);
    if (now > t) t.setDate(t.getDate() + 1);
    return t;
  }, [now]);

  const msLeft     = showtimeDate.getTime() - now.getTime();
  const countdown  = msToClock(msLeft);
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const myAlbum    = myVote ? ALBUMS.find(a => a.id === myVote) : null;
  const maxVotes   = Math.max(0, ...Object.values(votes));
  const canEnter   = isAdmin || !isLocked;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060402] text-[#F5E6C8]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&display=swap');
        .fp { font-family: 'Playfair Display', Georgia, serif; }
        .fc { font-family: 'Cormorant Garamond', Georgia, serif; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fu { animation: fadeUp 0.7s ease both; }

        /* Cinematic zoom — background zooms toward the console while fading out */
        @keyframes zoomIntoRoom {
          0%   { transform: scale(1)    translateZ(0); opacity: 1; }
          60%  { transform: scale(1.15) translateZ(0); opacity: 1; }
          100% { transform: scale(1.5)  translateZ(0); opacity: 0; }
        }
        .zoom-transition { animation: zoomIntoRoom 0.9s cubic-bezier(0.4,0,1,1) forwards; }
        .zoom-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: black;
          animation: fadeIn 0.9s ease forwards 0.4s;
          opacity: 0;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Zoom overlay — black fade that covers the transition */}
      {zooming && <div className="zoom-overlay" />}

      {/* Background — zooms on enter */}
      <div className={`absolute inset-0 ${zooming ? "zoom-transition" : ""}`}>
        <img src="/lobby-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 20%, rgba(0,0,0,0.72) 100%)" }} />
        <div className="absolute top-0 left-0 right-0 h-52" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 left-0 right-0 h-48" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.97) 0%, transparent 100%)" }} />
      </div>

      {/* ── HEADER ── */}
      <header className="relative z-10 text-center pt-10 fu">
        <div className="fc text-sm tracking-[0.6em] uppercase text-white/65 mb-4 font-semibold">
          AlbumClub · Tonight's Lobby
        </div>
        <h1 className="fp font-black leading-none mb-5"
          style={{ fontSize: "clamp(3.2rem,8vw,5.5rem)", textShadow: "0 4px 50px rgba(0,0,0,0.98), 0 0 100px rgba(0,0,0,0.9)" }}>
          Showtime Selection
        </h1>
        <div className="flex items-center justify-center gap-8 mb-3">
          <div className="h-px w-24 bg-[#C47A2C]/40" />
          <div>
            <div className="fc text-base tracking-[0.4em] uppercase text-white/60 mb-1">Scheduled for</div>
            <div className="fp text-4xl text-[#C47A2C] font-bold">08:00 PM</div>
          </div>
          <div className="h-px w-24 bg-[#C47A2C]/40" />
        </div>
        <div className="fc text-xl text-white/60 italic">
          Doors open in{" "}
          <span className="fp text-white/90 not-italic font-bold" style={{ fontSize: "1.2rem" }}>{countdown}</span>
        </div>
      </header>

      {/* ── ALBUMS ── */}
      <section className="relative z-10 flex flex-col items-center mt-8 px-6">
        <p className="fc text-lg text-white/65 mb-8 tracking-wide">
          Vote for tonight's record — one album, one showtime.
        </p>

        {/* All 3 albums in a row, absolutely equal heights via grid */}
        <div className="grid grid-cols-3 gap-12"
          style={{ alignItems: "start" }}>
          {ALBUMS.map((album, i) => {
            const count      = votes[album.id] || 0;
            const pct        = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isVoted    = myVote === album.id;
            const isLeading  = count > 0 && count === maxVotes;

            return (
              <div key={album.id} className="flex flex-col items-center fu" style={{ animationDelay: `${i * 0.12}s` }}>

                {/* Leading badge — fixed height so all albums start at same Y */}
                <div style={{ height: "28px" }} className="flex items-center justify-center mb-2">
                  {isLeading && (
                    <span className="fc text-sm tracking-[0.45em] uppercase text-[#C47A2C] font-semibold">
                      ✦ Leading
                    </span>
                  )}
                </div>

                <button
                  onClick={() => castVote(album.id)}
                  className="group relative flex flex-col items-center"
                  style={{
                    transform:  isVoted ? "translateY(-16px)" : "translateY(0)",
                    transition: "transform 0.4s cubic-bezier(0.22,1,0.36,1)",
                  }}>

                  {/* Cover art — fixed 210×210 */}
                  <div className="relative overflow-hidden rounded-xl"
                    style={{
                      width: "210px", height: "210px",
                      border:     isVoted ? "3px solid #C47A2C" : "2px solid rgba(255,255,255,0.14)",
                      boxShadow:  isVoted
                        ? "0 28px 80px rgba(0,0,0,0.88), 0 0 50px rgba(196,122,44,0.4)"
                        : "0 16px 60px rgba(0,0,0,0.78)",
                      transition: "border 0.3s, box-shadow 0.3s",
                    }}>
                    <img
                      src={album.cover}
                      alt={album.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    {/* Voted checkmark */}
                    {isVoted && (
                      <div className="absolute top-3 right-3 w-9 h-9 rounded-full bg-[#C47A2C] flex items-center justify-center shadow-lg">
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                          <path d="M2.5 7.5l3.5 3.5 6.5-7" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{ background: "rgba(0,0,0,0.48)" }}>
                      <span className="fc text-lg tracking-[0.5em] uppercase text-white font-semibold">
                        {isVoted ? "✓ Voted" : "Vote"}
                      </span>
                    </div>
                  </div>

                  {/* Album info */}
                  <div className="mt-4 text-center" style={{ width: "210px" }}>
                    <div className="fp font-bold text-xl leading-snug text-white mb-1"
                      style={{ textShadow: "0 2px 20px rgba(0,0,0,0.95)" }}>
                      {album.title}
                    </div>
                    <div className="fc text-base text-[#C47A2C]">
                      {album.artist} · {album.year}
                    </div>
                    <div className="fc text-base text-white/50 mt-1">
                      {count} {count === 1 ? "vote" : "votes"}
                      {totalVotes > 0 && <span className="text-white/28 ml-2">· {pct}%</span>}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Enter Room ── */}
        <div className="mt-12 flex flex-col items-center gap-3 fu" style={{ animationDelay: "0.5s" }}>
          {canEnter ? (
            <>
              <button
                onClick={enterRoom}
                className="px-16 py-4 fc text-xl tracking-[0.5em] uppercase text-white transition-all duration-200 hover:scale-105 active:scale-95"
                style={{
                  background: "linear-gradient(to bottom, #7a3018, #4a1a0a)",
                  border:     "1px solid #C47A2C",
                  boxShadow:  "0 0 40px rgba(196,122,44,0.32), inset 0 1px 0 rgba(255,200,100,0.1)",
                  fontWeight: 600,
                }}>
                Enter Room →
              </button>
              <p className="fc text-base text-white/35 tracking-[0.35em] uppercase">
                You can enter without voting
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="px-12 py-4 fc text-xl tracking-[0.4em] uppercase text-white/28 border border-white/10 bg-black/25">
                Room Opens at 8:00 PM
              </div>
              <p className="fc text-base text-white/30 tracking-[0.3em] uppercase">Come back at showtime</p>
            </div>
          )}
        </div>
      </section>

      {/* ── YOUR PICK — fixed bottom ── */}
      <div className="fixed bottom-0 left-0 right-0 z-10 px-10 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-5">
            <span className="fc text-sm tracking-[0.45em] uppercase text-white/40">Your Pick</span>
            {myAlbum ? (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#C47A2C]/45 shadow-lg shrink-0">
                  <img src={myAlbum.cover} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                </div>
                <div>
                  <div className="fp text-lg font-bold text-white leading-tight">{myAlbum.title}</div>
                  <div className="fc text-sm text-[#C47A2C]">{myAlbum.artist}</div>
                </div>
              </div>
            ) : (
              <span className="fc text-base text-white/28 italic">Not cast yet</span>
            )}
          </div>
          {totalVotes > 0 && (
            <span className="fc text-base text-white/35">
              {totalVotes} {totalVotes === 1 ? "vote" : "votes"} tonight
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
