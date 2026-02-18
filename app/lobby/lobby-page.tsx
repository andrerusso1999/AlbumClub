"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Album = {
  id: string;
  title: string;
  artist: string;
  year?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOM_ID = "main";

const albums: Album[] = [
  { id: "mysticism-romance", title: "Mysticism & Romance", artist: "Tony Newton", year: "1976" },
  { id: "currents",          title: "Currents",            artist: "Tame Impala",  year: "2015" },
  { id: "abbey-road",        title: "Abbey Road",          artist: "The Beatles",  year: "1969" },
];

const SHOWTIME_HOUR_24 = 20;
const SHOWTIME_MIN = 0;

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const [votes, setVotes]   = useState<Record<string, number>>({});
  const [myVote, setMyVote] = useState<string | null>(null);
  const [now, setNow]       = useState<Date>(() => new Date());
  const [userId, setUserId] = useState<string>("");

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Init user ID
  useEffect(() => {
    setUserId(getOrCreateUserId());
  }, []);

  // Load votes from Supabase + subscribe to changes
  useEffect(() => {
    if (!userId) return;

    // Fetch current vote counts
    const loadVotes = async () => {
      const { data } = await supabase
        .from("votes")
        .select("album_id")
        .eq("room_id", ROOM_ID);

      if (!data) return;

      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.album_id] = (counts[row.album_id] || 0) + 1;
      }
      setVotes(counts);
    };

    // Check if this user already voted
    const loadMyVote = async () => {
      const { data } = await supabase
        .from("votes")
        .select("album_id")
        .eq("room_id", ROOM_ID)
        .eq("user_id", userId)
        .maybeSingle();

      if (data) setMyVote(data.album_id);
    };

    loadVotes();
    loadMyVote();

    // Realtime subscription
    const channel = supabase
      .channel("votes-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${ROOM_ID}` },
        () => {
          // Re-fetch on any change (simplest approach)
          loadVotes();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const castVote = async (albumId: string) => {
    if (!userId) return;

    // Optimistic update
    setVotes((prev) => {
      const next = { ...prev };
      if (myVote) next[myVote] = Math.max(0, (next[myVote] || 1) - 1);
      next[albumId] = (next[albumId] || 0) + 1;
      return next;
    });
    setMyVote(albumId);

    if (myVote) {
      // Change vote: delete old, insert new
      await supabase
        .from("votes")
        .delete()
        .eq("room_id", ROOM_ID)
        .eq("user_id", userId);
    }

    await supabase.from("votes").insert({
      room_id: ROOM_ID,
      album_id: albumId,
      user_id: userId,
    });
  };

  const clearMyVote = async () => {
    if (!userId || !myVote) return;
    setVotes((prev) => {
      const next = { ...prev };
      next[myVote] = Math.max(0, (next[myVote] || 1) - 1);
      return next;
    });
    setMyVote(null);
    await supabase
      .from("votes")
      .delete()
      .eq("room_id", ROOM_ID)
      .eq("user_id", userId);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const showtimeMs = useMemo(() => getTonightShowtimeMs(now), [now]);
  const countdown  = useMemo(() => msToClock(showtimeMs - now.getTime()), [showtimeMs, now]);

  const leader = useMemo(() => {
    return albums
      .map((a) => ({ ...a, count: votes[a.id] || 0 }))
      .sort((a, b) => b.count - a.count)[0];
  }, [votes]);

  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <main className="relative min-h-screen text-[#F5E6C8] overflow-hidden">

      {/* Background */}
      <img
        src="/room-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover animate-roomBreath"
      />
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[1px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0)_0%,_rgba(0,0,0,0.75)_85%)]" />

      {/* Header */}
      <header className="relative z-10 w-full px-6 py-5 border-b border-[#F5E6C8]/20">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">
              Tonight&apos;s Lobby
            </div>
            <h1 className="text-2xl md:text-3xl font-serif tracking-wide">The Album Club</h1>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-[0.25em] text-[#F5E6C8]/60">
              Countdown to 8:00 PM
            </div>
            <div className="mt-1 font-mono text-lg md:text-xl">{countdown}</div>
          </div>
        </div>
      </header>

      {/* Main */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-[1.4fr_0.8fr] gap-12">

        {/* Voting */}
        <div className="rounded-2xl border border-[#F5E6C8]/15 bg-black/35 p-8 shadow-xl">
          <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">Album Voting</div>
          <h2 className="mt-3 text-3xl font-serif">Pick Tonight&apos;s Record</h2>
          <p className="mt-2 text-sm text-[#F5E6C8]/70">
            One album. One showtime. Vote closes when the needle drops.
          </p>

          <div className="mt-8 space-y-4">
            {albums.map((album) => {
              const count    = votes[album.id] || 0;
              const selected = myVote === album.id;
              const pct      = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

              return (
                <button
                  key={album.id}
                  onClick={() => castVote(album.id)}
                  className={[
                    "w-full rounded-xl px-5 py-4 border transition text-left relative overflow-hidden",
                    selected
                      ? "border-[#C47A2C]/60 bg-[#C47A2C]/10"
                      : "border-[#F5E6C8]/15 bg-black/20 hover:bg-black/40",
                  ].join(" ")}
                >
                  {/* Vote bar */}
                  {totalVotes > 0 && (
                    <div
                      className="absolute inset-0 bg-[#C47A2C]/08 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  )}

                  <div className="relative flex items-center justify-between">
                    <span>
                      <div className="font-serif text-lg">{album.title}</div>
                      <div className="text-xs text-[#F5E6C8]/60">
                        {album.artist}{album.year ? ` · ${album.year}` : ""}
                      </div>
                    </span>
                    <span className="flex items-center gap-3 text-sm font-mono shrink-0">
                      {totalVotes > 0 && (
                        <span className="text-[#F5E6C8]/40 text-xs">{pct}%</span>
                      )}
                      <span>{count} vote{count !== 1 ? "s" : ""}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex gap-4">
            <Link
              href="/room"
              className="flex-1 text-center rounded-xl px-4 py-3 border border-[#C47A2C]/40 bg-[#C47A2C]/15 hover:bg-[#C47A2C]/25 uppercase tracking-[0.2em] text-sm transition"
            >
              Enter Room
            </Link>
            {myVote && (
              <button
                onClick={clearMyVote}
                className="rounded-xl px-4 py-3 border border-[#F5E6C8]/20 bg-black/20 hover:bg-black/40 text-sm transition"
              >
                Clear Vote
              </button>
            )}
          </div>

          {totalVotes > 0 && (
            <div className="mt-4 text-xs text-[#F5E6C8]/40">
              {totalVotes} vote{totalVotes !== 1 ? "s" : ""} cast so far
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="rounded-2xl border border-[#F5E6C8]/15 bg-black/30 p-8 shadow-xl">
          <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">Experience</div>
          <h3 className="mt-3 text-xl font-serif">Listening Ritual</h3>
          <p className="mt-3 text-sm text-[#F5E6C8]/70 leading-relaxed">
            When showtime begins, the record is placed on the platter.
            The tonearm lowers. The chat becomes the room. No skips.
          </p>

          <div className="mt-6 rounded-xl border border-[#F5E6C8]/15 bg-black/20 p-5">
            <div className="text-xs uppercase tracking-[0.25em] text-[#F5E6C8]/60">
              Current Leader
            </div>
            <div className="mt-2 font-serif text-2xl">{leader?.title}</div>
            <div className="mt-1 text-sm text-[#F5E6C8]/70">
              {leader?.artist}{leader?.year ? ` · ${leader.year}` : ""}
            </div>
            <div className="mt-3 text-sm font-mono text-[#C47A2C]">
              {votes[leader?.id || ""] || 0} vote{(votes[leader?.id || ""] || 0) !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="mt-6 text-xs text-[#F5E6C8]/50 leading-relaxed">
            Votes are now synced — your friends see the same results in real-time.
          </div>
        </aside>
      </section>
    </main>
  );
}
