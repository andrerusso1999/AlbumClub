"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// ─── Types & Constants ────────────────────────────────────────────────────────

type Album = {
  id: string;
  title: string;
  artist: string;
  year: string;
  color: string;      // dominant color for placeholder art
  accent: string;     // lighter accent
  label: string;      // record label color
};

const ROOM_ID = "main";
const SHOWTIME_HOUR_24 = 20;
const SHOWTIME_MIN = 0;

const albums: Album[] = [
  {
    id: "mysticism-romance",
    title: "Mysticism & Romance",
    artist: "Tony Newton",
    year: "1976",
    color: "#1a3a2a",
    accent: "#4a8c6a",
    label: "#c8a45a",
  },
  {
    id: "lonerism",
    title: "Lonerism",
    artist: "Tame Impala",
    year: "2012",
    color: "#1a1a3a",
    accent: "#5a5aaa",
    label: "#e8c870",
  },
  {
    id: "abbey-road",
    title: "Abbey Road",
    artist: "The Beatles",
    year: "1969",
    color: "#2a1a1a",
    accent: "#8c4a4a",
    label: "#d4a040",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "";
  const key = "ac_user_id";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function msToClock(ms: number) {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function getTonightShowtimeMs(now: Date) {
  const t = new Date(now);
  t.setHours(SHOWTIME_HOUR_24, SHOWTIME_MIN, 0, 0);
  if (now.getTime() > t.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

// ─── Album Cover Component ────────────────────────────────────────────────────

function AlbumCover({ album, size = 180 }: { album: Album; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`grad-${album.id}`} cx="35%" cy="30%">
          <stop offset="0%" stopColor={album.accent} stopOpacity="0.9" />
          <stop offset="100%" stopColor={album.color} />
        </radialGradient>
        <filter id={`noise-${album.id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/>
          <feBlend in="SourceGraphic" mode="multiply" result="blend"/>
          <feComposite in="blend" in2="SourceGraphic" operator="in"/>
        </filter>
      </defs>
      {/* Background */}
      <rect width="180" height="180" fill={`url(#grad-${album.id})`} />
      {/* Noise texture overlay */}
      <rect width="180" height="180" fill={album.color} opacity="0.3" filter={`url(#noise-${album.id})`} />
      {/* Abstract design elements */}
      <circle cx="90" cy="90" r="70" fill="none" stroke={album.accent} strokeWidth="0.5" opacity="0.4" />
      <circle cx="90" cy="90" r="50" fill="none" stroke={album.accent} strokeWidth="0.5" opacity="0.3" />
      <circle cx="90" cy="90" r="30" fill="none" stroke={album.accent} strokeWidth="0.5" opacity="0.2" />
      {/* Horizontal lines */}
      {[40, 55, 70, 85, 100, 115, 130, 145].map((y, i) => (
        <line key={i} x1="20" y1={y} x2="160" y2={y} stroke={album.accent} strokeWidth="0.4" opacity="0.2" />
      ))}
      {/* Center label circle */}
      <circle cx="90" cy="90" r="22" fill={album.label} opacity="0.85" />
      <circle cx="90" cy="90" r="4" fill={album.color} opacity="0.6" />
      {/* Artist initial */}
      <text x="90" y="86" textAnchor="middle" fill={album.color} fontSize="9" fontFamily="serif" fontWeight="bold" opacity="0.8">
        {album.artist.split(" ").map(w => w[0]).join("")}
      </text>
      <text x="90" y="96" textAnchor="middle" fill={album.color} fontSize="5" fontFamily="serif" opacity="0.7">
        {album.year}
      </text>
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const [votes, setVotes]         = useState<Record<string, number>>({});
  const [myVote, setMyVote]       = useState<string | null>(null);
  const [now, setNow]             = useState<Date>(() => new Date());
  const [userId, setUserId]       = useState<string>("");
  const [hovered, setHovered]     = useState<string | null>(null);
  const [selected, setSelected]   = useState<string | null>(null);

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { setUserId(getOrCreateUserId()); }, []);

  useEffect(() => {
    if (!userId) return;

    const loadVotes = async () => {
      const { data } = await supabase.from("votes").select("album_id").eq("room_id", ROOM_ID);
      if (!data) return;
      const counts: Record<string, number> = {};
      for (const row of data) counts[row.album_id] = (counts[row.album_id] || 0) + 1;
      setVotes(counts);
    };

    const loadMyVote = async () => {
      const { data } = await supabase.from("votes").select("album_id").eq("room_id", ROOM_ID).eq("user_id", userId).maybeSingle();
      if (data) { setMyVote(data.album_id); setSelected(data.album_id); }
    };

    loadVotes();
    loadMyVote();

    const channel = supabase.channel("votes-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${ROOM_ID}` }, loadVotes)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const castVote = async (albumId: string) => {
    if (!userId) return;
    setVotes((prev) => {
      const next = { ...prev };
      if (myVote) next[myVote] = Math.max(0, (next[myVote] || 1) - 1);
      next[albumId] = (next[albumId] || 0) + 1;
      return next;
    });
    setMyVote(albumId);
    setSelected(albumId);
    if (myVote) await supabase.from("votes").delete().eq("room_id", ROOM_ID).eq("user_id", userId);
    await supabase.from("votes").insert({ room_id: ROOM_ID, album_id: albumId, user_id: userId });
  };

  const showtimeMs = useMemo(() => getTonightShowtimeMs(now), [now]);
  const countdown  = useMemo(() => msToClock(showtimeMs - now.getTime()), [showtimeMs, now]);
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const leader     = useMemo(() => albums.map(a => ({ ...a, count: votes[a.id] || 0 })).sort((a, b) => b.count - a.count)[0], [votes]);

  const activeAlbum = hovered ? albums.find(a => a.id === hovered) : selected ? albums.find(a => a.id === selected) : null;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0e0a07] font-serif">

      {/* ── Room scene background ── */}
      <div className="absolute inset-0">
        {/* Floor */}
        <div className="absolute bottom-0 left-0 right-0 h-[45%]"
          style={{ background: "linear-gradient(to bottom, #1a0f08 0%, #2a1a0e 40%, #1e1208 100%)" }} />
        {/* Floor grain */}
        <div className="absolute bottom-0 left-0 right-0 h-[45%] opacity-30"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(255,255,255,0.02) 40px, rgba(255,255,255,0.02) 41px), repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(255,255,255,0.02) 40px, rgba(255,255,255,0.02) 41px)" }} />
        {/* Back wall */}
        <div className="absolute top-0 left-0 right-0 h-[60%]"
          style={{ background: "linear-gradient(to bottom, #1c1008 0%, #251508 60%, #1a0f08 100%)" }} />
        {/* Wall wood grain */}
        <div className="absolute top-0 left-0 right-0 h-[60%] opacity-20"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 80px, rgba(255,255,255,0.015) 80px, rgba(255,255,255,0.015) 81px)" }} />
        {/* Floor/wall junction */}
        <div className="absolute left-0 right-0 opacity-60" style={{ top: "55%", height: "16px", background: "linear-gradient(to bottom, #3d2310, #1a0e06)" }} />

        {/* ── Ceiling lights ── */}
        {[15, 50, 85].map((x, i) => (
          <div key={i} className="absolute" style={{ left: `${x}%`, top: 0 }}>
            {/* Wire */}
            <div className="absolute left-1/2 -translate-x-1/2 w-[1px] bg-[#8a6a40]/40" style={{ height: "60px", top: 0 }} />
            {/* Fixture */}
            <div className="absolute left-1/2 -translate-x-1/2 w-10 h-5 rounded-b-full bg-[#2a1a08] border border-[#6a4a20]/30" style={{ top: "60px" }} />
            {/* Bulb glow */}
            <div className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#ffcc66]" style={{ top: "62px", boxShadow: "0 0 20px 8px rgba(255,180,60,0.35), 0 0 60px 30px rgba(255,140,20,0.12)" }} />
            {/* Light cone */}
            <div className="absolute left-1/2 -translate-x-1/2 opacity-15" style={{
              top: "75px", width: "280px", height: "380px", marginLeft: "-140px",
              background: "conic-gradient(from 270deg at 50% 0%, transparent 30%, rgba(255,160,40,0.6) 50%, transparent 70%)",
            }} />
          </div>
        ))}

        {/* ── Side wall sconces ── */}
        {[{ x: "3%", side: "right" }, { x: "97%", side: "left" }].map(({ x, side }, i) => (
          <div key={i} className="absolute" style={{ left: x, top: "28%" }}>
            <div className="w-6 h-10 rounded-t-full bg-[#3a2010] border border-[#6a4020]/40"
              style={{ boxShadow: `0 0 25px 10px rgba(255,140,30,0.2), ${side === "right" ? "8px" : "-8px"} 0 40px rgba(255,120,20,0.1)` }} />
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#ffaa44]"
              style={{ boxShadow: "0 0 10px 4px rgba(255,160,60,0.5)" }} />
          </div>
        ))}

        {/* ── Record player shelf (center bottom of wall) ── */}
        <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: "42%", width: "320px" }}>
          {/* Shelf */}
          <div className="w-full h-4 rounded-sm" style={{ background: "linear-gradient(to bottom, #5a3518, #3a2010)", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }} />
          {/* Turntable silhouette on shelf */}
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-32 h-8 rounded-sm bg-[#1a0f06] border border-[#4a2e10]/40"
            style={{ boxShadow: "0 0 20px rgba(255,140,40,0.08)" }}>
            <div className="absolute top-1 left-1/2 -translate-x-1/2 w-16 h-6 rounded-full bg-[#111] border border-[#333]/30" />
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#C47A2C]/60" />
          </div>
        </div>

        {/* ── Side furniture silhouettes ── */}
        {/* Left couch arm */}
        <div className="absolute bottom-0 left-0" style={{ width: "18%", height: "28%", background: "linear-gradient(135deg, #2a1608 0%, #1a0e06 100%)", borderRadius: "0 40px 0 0" }} />
        {/* Right couch arm */}
        <div className="absolute bottom-0 right-0" style={{ width: "18%", height: "28%", background: "linear-gradient(225deg, #2a1608 0%, #1a0e06 100%)", borderRadius: "40px 0 0 0" }} />

        {/* ── Ambient glow from record player ── */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{
          bottom: "38%", width: "600px", height: "400px", marginLeft: "-300px",
          background: "radial-gradient(ellipse at 50% 80%, rgba(196,122,44,0.08) 0%, transparent 70%)",
        }} />

        {/* ── Vignette ── */}
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 20%, rgba(0,0,0,0.75) 100%)" }} />
      </div>

      {/* ── ALBUM WALL ── mounted frames above the shelf ── */}
      <div className="absolute left-0 right-0 flex items-end justify-center gap-8 z-10"
        style={{ top: "6%", paddingLeft: "12%", paddingRight: "12%" }}>

        {albums.map((album, i) => {
          const voteCount = votes[album.id] || 0;
          const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
          const isSelected = myVote === album.id;
          const isHovered = hovered === album.id;
          const isActive = isSelected || isHovered;

          return (
            <button
              key={album.id}
              onClick={() => castVote(album.id)}
              onMouseEnter={() => setHovered(album.id)}
              onMouseLeave={() => setHovered(null)}
              className="relative flex flex-col items-center group transition-all duration-500"
              style={{
                transform: isActive ? "translateY(-12px) scale(1.04)" : "translateY(0) scale(1)",
                filter: isActive ? "brightness(1.15)" : "brightness(0.85)",
              }}
            >
              {/* Frame shadow on wall */}
              <div className="absolute inset-0 rounded-sm opacity-60" style={{
                boxShadow: isActive
                  ? `0 20px 60px rgba(0,0,0,0.8), 0 0 40px ${album.accent}44`
                  : "0 15px 40px rgba(0,0,0,0.7)",
                transform: "translateY(4px)",
              }} />

              {/* Picture frame */}
              <div className="relative rounded-sm border-4 overflow-hidden"
                style={{
                  borderColor: isActive ? "#c8a060" : "#6a4a20",
                  boxShadow: isActive ? `inset 0 0 0 1px rgba(255,200,100,0.2), 0 0 30px ${album.accent}33` : "inset 0 0 0 1px rgba(255,180,80,0.1)",
                  transition: "border-color 0.3s, box-shadow 0.3s",
                }}>
                <AlbumCover album={album} size={160} />

                {/* Selected checkmark */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#C47A2C] flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: "rgba(0,0,0,0.45)" }}>
                  <span className="text-[#F5E6C8] text-xs tracking-[0.3em] uppercase font-sans">
                    {isSelected ? "Voted" : "Vote"}
                  </span>
                </div>
              </div>

              {/* Frame nameplate */}
              <div className="mt-2 px-3 py-1 rounded-sm text-center"
                style={{ background: "linear-gradient(to bottom, #3a2510, #2a1808)", border: "1px solid #6a4a20", minWidth: "160px" }}>
                <div className="text-[#F5E6C8] text-sm font-serif tracking-wide truncate" style={{ maxWidth: "150px" }}>
                  {album.title}
                </div>
                <div className="text-[#C47A2C] text-[10px] tracking-[0.2em] uppercase font-sans mt-0.5">
                  {album.artist} · {album.year}
                </div>
              </div>

              {/* Vote count */}
              <div className="mt-2 text-center">
                <span className="text-[#F5E6C8]/60 text-xs font-mono">{voteCount} vote{voteCount !== 1 ? "s" : ""}</span>
                {totalVotes > 0 && <span className="text-[#C47A2C]/60 text-xs font-mono ml-2">· {pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── MARQUEE SIGN ── */}
      <div className="absolute left-1/2 -translate-x-1/2 z-20 text-center" style={{ top: "1.5%" }}>
        <div className="px-8 py-2 rounded-sm relative"
          style={{
            background: "linear-gradient(to bottom, #3a2008, #251408)",
            border: "2px solid #8a6020",
            boxShadow: "0 0 30px rgba(255,160,40,0.15), inset 0 1px 0 rgba(255,200,100,0.1)",
          }}>
          {/* Bulb row */}
          <div className="flex justify-between mb-1 px-1">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#ffcc66]"
                style={{ boxShadow: "0 0 4px 2px rgba(255,200,80,0.6)", opacity: i % 2 === 0 ? 1 : 0.4 }} />
            ))}
          </div>
          <div className="text-[#ffeeaa] text-xs tracking-[0.5em] uppercase font-sans">
            Album Club · Tonight&apos;s Lobby
          </div>
          <div className="flex justify-between mt-1 px-1">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#ffcc66]"
                style={{ boxShadow: "0 0 4px 2px rgba(255,200,80,0.6)", opacity: i % 2 !== 0 ? 1 : 0.4 }} />
            ))}
          </div>
        </div>
      </div>

      {/* ── BOTTOM UI BAR ── */}
      <div className="absolute bottom-0 left-0 right-0 z-20" style={{ background: "linear-gradient(to top, rgba(10,6,2,0.97) 60%, transparent)" }}>
        <div className="max-w-5xl mx-auto px-8 py-6 flex items-end justify-between gap-6">

          {/* Left: countdown */}
          <div>
            <div className="text-[10px] tracking-[0.35em] uppercase text-[#C47A2C]/70 mb-1">Showtime In</div>
            <div className="font-mono text-2xl text-[#F5E6C8]">{countdown}</div>
          </div>

          {/* Center: leader + enter */}
          <div className="text-center flex-1">
            {leader && totalVotes > 0 && (
              <div className="mb-3">
                <div className="text-[10px] tracking-[0.3em] uppercase text-[#C47A2C]/60 mb-1">Leading</div>
                <div className="text-[#F5E6C8]/80 text-sm font-serif">{leader.title}</div>
              </div>
            )}
            <Link
              href="/room"
              className="inline-block px-10 py-3 rounded-sm text-sm tracking-[0.3em] uppercase text-[#F5E6C8] transition-all duration-300"
              style={{
                background: "linear-gradient(to bottom, #8a3a1a, #5a2010)",
                border: "1px solid #c47a30",
                boxShadow: "0 0 20px rgba(196,122,44,0.2), inset 0 1px 0 rgba(255,200,100,0.1)",
              }}
            >
              Enter Room
            </Link>
          </div>

          {/* Right: vote status */}
          <div className="text-right">
            <div className="text-[10px] tracking-[0.35em] uppercase text-[#C47A2C]/70 mb-1">Your Vote</div>
            <div className="text-[#F5E6C8]/70 text-sm font-serif">
              {myVote ? albums.find(a => a.id === myVote)?.title : "Not cast yet"}
            </div>
            {totalVotes > 0 && (
              <div className="text-[#F5E6C8]/30 text-xs font-mono mt-1">{totalVotes} total vote{totalVotes !== 1 ? "s" : ""}</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Grain overlay ── */}
      <div className="absolute inset-0 pointer-events-none z-30 opacity-[0.03]"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E\")", backgroundRepeat: "repeat", backgroundSize: "150px" }} />
    </main>
  );
}
