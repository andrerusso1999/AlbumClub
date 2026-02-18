"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type Album = {
  id: string;
  title: string;
  artist: string;
  year?: string;
  cover?: string; // path in /public (optional)
};

const SHOWTIME_HOUR_24 = 20; // 8 PM
const SHOWTIME_MIN = 0;

const albums: Album[] = [
  {
    id: "mysticism-romance",
    title: "Mysticism & Romance",
    artist: "Tony Newton",
    year: "1976",
    cover: "/album-1.jpg",
  },
  {
    id: "currents",
    title: "Currents",
    artist: "Tame Impala",
    year: "2015",
    cover: "/album-2.jpg",
  },
  {
    id: "abbey-road",
    title: "Abbey Road",
    artist: "The Beatles",
    year: "1969",
    cover: "/album-3.jpg",
  },
];

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

  // If it's already past showtime today, keep "tonight" as tomorrow
  if (now.getTime() > t.getTime()) {
    t.setDate(t.getDate() + 1);
  }
  return t.getTime();
}

export default function LobbyPage() {
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [myVote, setMyVote] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  // Tick clock for countdown
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Load local votes
  useEffect(() => {
    try {
      const rawVotes = window.localStorage.getItem("albumclub_votes_v1");
      const rawMyVote = window.localStorage.getItem("albumclub_myvote_v1");
      if (rawVotes) setVotes(JSON.parse(rawVotes) as Record<string, number>);
      if (rawMyVote) setMyVote(rawMyVote);
    } catch {
      // ignore
    }
  }, []);

  // Persist local votes
  useEffect(() => {
    try {
      window.localStorage.setItem("albumclub_votes_v1", JSON.stringify(votes));
    } catch {
      // ignore
    }
  }, [votes]);

  useEffect(() => {
    try {
      if (myVote) window.localStorage.setItem("albumclub_myvote_v1", myVote);
      else window.localStorage.removeItem("albumclub_myvote_v1");
    } catch {
      // ignore
    }
  }, [myVote]);

  const showtimeMs = useMemo(() => getTonightShowtimeMs(now), [now]);
  const countdown = useMemo(() => msToClock(showtimeMs - now.getTime()), [showtimeMs, now]);

  const leader = useMemo(() => {
    const entries = albums.map((a) => ({
      ...a,
      count: votes[a.id] || 0,
    }));
    entries.sort((a, b) => b.count - a.count);
    return entries[0];
  }, [votes]);

  function castVote(id: string) {
    setVotes((prev) => {
      const next = { ...prev };
      next[id] = (next[id] ?? 0) + 1;
      return next;
    });
    setMyVote(id);
  }

  function clearVotes() {
    setVotes({});
    setMyVote(null);
  }

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
              Tonight’s Lobby
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

      {/* Main Content */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-[1.4fr_0.8fr] gap-12">
        {/* Voting */}
        <div className="rounded-2xl border border-[#F5E6C8]/15 bg-black/35 p-8 shadow-xl">
          <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">Album Voting</div>
          <h2 className="mt-3 text-3xl font-serif">Pick Tonight’s Record</h2>
          <p className="mt-2 text-sm text-[#F5E6C8]/70">
            One album. One showtime. Vote closes when the needle drops.
          </p>

          <div className="mt-8 space-y-4">
            {albums.map((album) => {
              const count = votes[album.id] || 0;
              const selected = myVote === album.id;

              return (
                <button
                  key={album.id}
                  onClick={() => castVote(album.id)}
                  className={[
                    "w-full flex items-center justify-between rounded-xl px-5 py-4 border transition",
                    selected
                      ? "border-[#C47A2C]/60 bg-[#C47A2C]/10"
                      : "border-[#F5E6C8]/15 bg-black/20 hover:bg-black/40",
                  ].join(" ")}
                >
                  <span className="text-left">
                    <div className="font-serif text-lg">{album.title}</div>
                    <div className="text-xs text-[#F5E6C8]/60">
                      {album.artist}
                      {album.year ? ` · ${album.year}` : ""}
                    </div>
                  </span>

                  <span className="text-sm font-mono">{count} votes</span>
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

            <Link
              href="/room"
              className="text-center rounded-xl px-4 py-3 border border-[#F5E6C8]/20 bg-black/20 hover:bg-black/40 text-sm transition"
              title="Peek at the room"
            >
              Peek
            </Link>

            <button
              onClick={clearVotes}
              className="rounded-xl px-4 py-3 border border-[#F5E6C8]/20 bg-black/20 hover:bg-black/40 text-sm transition"
            >
              Reset
            </button>
          </div>

          <div className="mt-6 text-xs text-[#F5E6C8]/50 leading-relaxed">
            V1 note: votes are stored locally on your machine. Next step is syncing votes + showtime state so your friends
            see the same result.
          </div>
        </div>

        {/* Experience */}
        <aside className="rounded-2xl border border-[#F5E6C8]/15 bg-black/30 p-8 shadow-xl">
          <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">Experience</div>

          <h3 className="mt-3 text-xl font-serif">Listening Ritual</h3>

          <p className="mt-3 text-sm text-[#F5E6C8]/70 leading-relaxed">
            When showtime begins, the record is placed on the platter.
            The tonearm lowers. The chat becomes the room. No skips.
          </p>

          <div className="mt-6 rounded-xl border border-[#F5E6C8]/15 bg-black/20 p-5">
            <div className="text-xs uppercase tracking-[0.25em] text-[#F5E6C8]/60">Current Leader</div>
            <div className="mt-2 font-serif text-2xl">{leader?.title}</div>
            <div className="mt-1 text-sm text-[#F5E6C8]/70">
              {leader?.artist} {leader?.year ? `· ${leader.year}` : ""}
            </div>
            <div className="mt-3 text-sm font-mono text-[#C47A2C]">
              {(votes[leader?.id || ""] || 0).toString()} votes
            </div>
          </div>

          <div className="mt-6 text-xs text-[#F5E6C8]/50">
            Next: add a “join code” so friends can hop into the same lobby + vote together.
          </div>
        </aside>
      </section>
    </main>
  );
}
