"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Album = {
  id: string;
  title: string;
  artist: string;
  year: string;
  mbid?: string; // MusicBrainz release ID for cover art
  roomTint: string;   // rgba for room color shift
  roomFilter: string; // CSS filter for lighting mood
};

// ─── Album Config ─────────────────────────────────────────────────────────────

const ALBUMS: Album[] = [
  {
    id: "mysticism-romance",
    title: "Mysticism & Romance",
    artist: "Tony Newton",
    year: "1976",
    roomTint: "rgba(40, 80, 60, 0.25)",
    roomFilter: "sepia(0.15) hue-rotate(80deg) brightness(0.95)",
  },
  {
    id: "lonerism",
    title: "Lonerism",
    artist: "Tame Impala",
    year: "2012",
    roomTint: "rgba(60, 40, 120, 0.22)",
    roomFilter: "sepia(0.1) hue-rotate(200deg) brightness(0.92) saturate(1.2)",
  },
  {
    id: "abbey-road",
    title: "Abbey Road",
    artist: "The Beatles",
    year: "1969",
    roomTint: "rgba(120, 80, 20, 0.2)",
    roomFilter: "sepia(0.25) brightness(1.05) saturate(0.9)",
  },
];

const ROOM_ID = "main";
const SHOWTIME_HOUR_24 = 20;

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
  t.setHours(SHOWTIME_HOUR_24, 0, 0, 0);
  if (now.getTime() > t.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

// Fetch cover art from MusicBrainz / Cover Art Archive
async function fetchCoverArt(artist: string, title: string, cacheKey: string): Promise<{ front: string; back: string | null }> {
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const searchRes = await fetch(
      `https://musicbrainz.org/ws/2/release/?query=artist:${encodeURIComponent(artist)}+release:${encodeURIComponent(title)}&limit=5&fmt=json`,
      { headers: { "User-Agent": "AlbumClub/1.0 (contact@albumclub.app)" } }
    );
    const searchData = await searchRes.json();
    const releases = searchData.releases || [];
    if (!releases.length) return { front: "", back: null };

    // Try each release until we find one with cover art
    for (const release of releases.slice(0, 3)) {
      try {
        const coverRes = await fetch(`https://coverartarchive.org/release/${release.id}`);
        if (!coverRes.ok) continue;
        const coverData = await coverRes.json();
        const images = coverData.images || [];
        const front = images.find((i: any) => i.front)?.thumbnails?.large || images[0]?.thumbnails?.large || "";
        const back = images.find((i: any) => i.back)?.thumbnails?.large || null;
        if (front) {
          const result = { front, back };
          localStorage.setItem(cacheKey, JSON.stringify(result));
          return result;
        }
      } catch {}
    }
  } catch {}
  return { front: "", back: null };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const router = useRouter();
  const [votes, setVotes]           = useState<Record<string, number>>({});
  const [myVote, setMyVote]         = useState<string | null>(null);
  const [userId, setUserId]         = useState("");
  const [now, setNow]               = useState<Date>(() => new Date());
  const [hovered, setHovered]       = useState<string | null>(null);
  const [covers, setCovers]         = useState<Record<string, { front: string; back: string | null }>>({});
  const [entering, setEntering]     = useState(false);

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // User ID
  useEffect(() => { setUserId(getOrCreateUserId()); }, []);

  // Fetch covers
  useEffect(() => {
    ALBUMS.forEach(async (album) => {
      const art = await fetchCoverArt(album.artist, album.title, `cover_${album.id}`);
      setCovers(prev => ({ ...prev, [album.id]: art }));
    });
  }, []);

  // Votes
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
      if (data) setMyVote(data.album_id);
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
    setVotes(prev => {
      const next = { ...prev };
      if (myVote) next[myVote] = Math.max(0, (next[myVote] || 1) - 1);
      next[albumId] = (next[albumId] || 0) + 1;
      return next;
    });
    setMyVote(albumId);
    if (myVote) await supabase.from("votes").delete().eq("room_id", ROOM_ID).eq("user_id", userId);
    await supabase.from("votes").insert({ room_id: ROOM_ID, album_id: albumId, user_id: userId });
  };

  const handleEnterRoom = () => {
    setEntering(true);
    setTimeout(() => router.push("/room"), 900);
  };

  const showtimeMs = useMemo(() => getTonightShowtimeMs(now), [now]);
  const countdown  = useMemo(() => msToClock(showtimeMs - now.getTime()), [showtimeMs, now]);
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);

  // Active album for room tinting (hovered > voted > none)
  const activeId = hovered || myVote;
  const activeAlbum = activeId ? ALBUMS.find(a => a.id === activeId) : null;

  return (
    <main className="relative w-screen h-screen overflow-hidden font-serif select-none">

      {/* ── Background photo ── */}
      <div
        className="absolute inset-0 transition-all duration-700"
        style={{
          backgroundImage: "url('/lobby-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          filter: activeAlbum ? activeAlbum.roomFilter : "none",
          transform: entering ? "scale(1.12)" : "scale(1)",
          transition: entering ? "transform 0.9s cubic-bezier(0.4,0,0.2,1), filter 0.7s" : "filter 0.7s, transform 0.1s",
        }}
      />

      {/* Album color tint overlay */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-700"
        style={{ background: activeAlbum ? activeAlbum.roomTint : "transparent" }}
      />

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(0,0,0,0.55) 100%)" }} />

      {/* Fade to black on enter */}
      <div
        className="absolute inset-0 pointer-events-none z-50 bg-black transition-opacity duration-700"
        style={{ opacity: entering ? 1 : 0 }}
      />

      {/* ── Album frames on the wall ── */}
      {/* Positioned over the blank wall space between the two speakers */}
      <div className="absolute z-10 flex items-end justify-center gap-6"
        style={{ top: "13%", left: "22%", right: "22%", bottom: "35%" }}>

        {ALBUMS.map((album, i) => {
          const voteCount = votes[album.id] || 0;
          const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
          const isVoted = myVote === album.id;
          const isHovered = hovered === album.id;
          const isActive = isVoted || isHovered;
          const cover = covers[album.id];

          return (
            <button
              key={album.id}
              onClick={() => castVote(album.id)}
              onMouseEnter={() => setHovered(album.id)}
              onMouseLeave={() => setHovered(null)}
              className="relative flex flex-col items-center flex-1 max-w-[200px] group"
              style={{
                transform: isActive ? "translateY(-10px) scale(1.05)" : "translateY(0) scale(1)",
                transition: "transform 0.35s cubic-bezier(0.2,0.9,0.2,1), filter 0.35s",
                filter: isActive ? "brightness(1.15) drop-shadow(0 8px 24px rgba(0,0,0,0.7))" : "brightness(0.8) drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
              }}
            >
              {/* Wooden frame */}
              <div className="relative rounded-sm overflow-hidden"
                style={{
                  padding: "8px",
                  background: "linear-gradient(135deg, #5a3515 0%, #3a2008 40%, #4a2c10 100%)",
                  boxShadow: isActive
                    ? "0 0 0 1px rgba(200,160,80,0.5), 0 12px 40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,200,100,0.2)"
                    : "0 0 0 1px rgba(100,60,20,0.4), 0 6px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(200,150,60,0.1)",
                  transition: "box-shadow 0.35s",
                }}>

                {/* Cover art */}
                <div className="relative overflow-hidden" style={{ width: "140px", height: "140px", background: "#1a1008" }}>
                  {cover?.front ? (
                    <img src={cover.front} alt={album.title} className="w-full h-full object-cover" />
                  ) : (
                    // Placeholder while loading
                    <div className="w-full h-full flex items-center justify-center"
                      style={{ background: `linear-gradient(135deg, ${album.roomTint}, #1a1008)` }}>
                      <div className="text-center opacity-50">
                        <div className="text-2xl mb-1">♪</div>
                        <div className="text-[9px] tracking-widest uppercase text-[#F5E6C8]/60">Loading...</div>
                      </div>
                    </div>
                  )}

                  {/* Voted checkmark */}
                  {isVoted && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#C47A2C] flex items-center justify-center"
                      style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ background: "rgba(0,0,0,0.5)" }}>
                    <span className="text-[#F5E6C8] text-xs tracking-[0.3em] uppercase font-sans">
                      {isVoted ? "✓ Voted" : "Vote"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Nameplate below frame */}
              <div className="mt-2 px-3 py-1.5 rounded-sm text-center w-full"
                style={{
                  background: "linear-gradient(to bottom, rgba(30,15,5,0.9), rgba(15,8,2,0.95))",
                  border: "1px solid rgba(120,80,30,0.4)",
                  backdropFilter: "blur(4px)",
                }}>
                <div className="text-[#F5E6C8] text-xs font-serif tracking-wide truncate">{album.title}</div>
                <div className="text-[#C47A2C]/80 text-[9px] tracking-[0.2em] uppercase font-sans mt-0.5">
                  {album.artist} · {album.year}
                </div>
                <div className="text-[#F5E6C8]/40 text-[9px] font-mono mt-1">
                  {voteCount} vote{voteCount !== 1 ? "s" : ""}
                  {totalVotes > 0 && <span className="text-[#C47A2C]/50 ml-1">· {pct}%</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Selected album leaning on console (left side) ── */}
      {myVote && covers[myVote]?.front && (
        <div
          className="absolute z-10 transition-all duration-500"
          style={{
            bottom: "28%",
            left: "19%",
            transform: "rotate(-8deg)",
            filter: "drop-shadow(4px 8px 16px rgba(0,0,0,0.7))",
            opacity: 1,
          }}
        >
          <div style={{
            width: "72px", height: "72px",
            padding: "4px",
            background: "linear-gradient(135deg, #5a3515, #3a2008)",
            boxShadow: "0 0 0 1px rgba(120,80,30,0.4)",
            borderRadius: "2px",
          }}>
            <img
              src={covers[myVote].front}
              alt="selected"
              className="w-full h-full object-cover"
              style={{ borderRadius: "1px" }}
            />
          </div>
        </div>
      )}

      {/* ── Header bar ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-8 py-4"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)" }}>
        <div>
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#C47A2C]/80">Tonight&apos;s Lobby</div>
          <div className="text-xl font-serif text-[#F5E6C8] tracking-wide">The Album Club</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-[0.3em] uppercase text-[#F5E6C8]/50">Showtime In</div>
          <div className="font-mono text-lg text-[#F5E6C8]">{countdown}</div>
        </div>
      </div>

      {/* ── Bottom Enter Room bar ── */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between px-8 py-5"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)" }}>

        <div>
          {myVote ? (
            <>
              <div className="text-[10px] tracking-[0.3em] uppercase text-[#C47A2C]/70 mb-0.5">Your pick</div>
              <div className="text-sm font-serif text-[#F5E6C8]/80">
                {ALBUMS.find(a => a.id === myVote)?.title}
              </div>
            </>
          ) : (
            <div className="text-sm text-[#F5E6C8]/40 font-sans">Click an album to vote</div>
          )}
        </div>

        <button
          onClick={handleEnterRoom}
          className="px-8 py-3 rounded-sm text-sm tracking-[0.3em] uppercase text-[#F5E6C8] transition-all duration-200 hover:brightness-110 active:scale-95"
          style={{
            background: "linear-gradient(to bottom, #7a3318, #4a1e0a)",
            border: "1px solid rgba(196,122,44,0.5)",
            boxShadow: "0 0 20px rgba(196,122,44,0.15), inset 0 1px 0 rgba(255,200,100,0.1)",
          }}
        >
          Enter Room →
        </button>
      </div>

      {/* ── Grain ── */}
      <div className="absolute inset-0 pointer-events-none z-30 opacity-[0.025]"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", backgroundSize: "150px" }} />
    </main>
  );
}
