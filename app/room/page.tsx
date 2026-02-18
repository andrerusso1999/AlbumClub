"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef } from "react";

export default function RoomPage() {

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [startedAt, setStartedAt] = useState<string | null>(null);

  const [isLive, setIsLive] = useState(false);

  const [needleDrop, setNeedleDrop] = useState(false);

  const [chatOpen, setChatOpen] = useState(true);

  const [countdown, setCountdown] = useState<number | null>(null);

  const [audioUnlocked, setAudioUnlocked] = useState(false);

  useEffect(() => {
    const unlock = async () => {
      if (!audioRef.current) return;
  
      try {
        await audioRef.current.play();
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setAudioUnlocked(true);
        console.log("Audio unlocked");
      } catch {
        console.log("Unlock failed (user interaction needed)");
      }
  
      window.removeEventListener("click", unlock);
    };
  
    window.addEventListener("click", unlock, { once: true });
  
    return () => {
      window.removeEventListener("click", unlock);
    };
  }, []);
  
  

  const triggerShowtime = async () => {
    console.log("BUTTON CLICKED");
  
    // Host always allowed to start audio
    if (audioRef.current) {
      try {
        await audioRef.current.play();
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setAudioUnlocked(true);
        console.log("Host audio primed");
      } catch {
        console.log("Host audio play blocked");
      }
    }
  
    const startTime = new Date(Date.now() + 5000).toISOString();
  
    const { error } = await supabase
      .from("room_state")
      .update({
        is_live: true,
        started_at: startTime,
      })
      .eq("room_id", "main");
  
    if (error) {
      console.error("Showtime error:", error);
    } else {
      console.log("CEREMONIAL START SCHEDULED:", startTime);
    }
  };
  
useEffect(() => {
  if (isLive) {
    setNeedleDrop(true);
    const t = setTimeout(() => setNeedleDrop(false), 600); // after the drop moment
    return () => clearTimeout(t);
  }
}, [isLive]);

useEffect(() => {
  const channel = supabase
    .channel("room-state")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_state",
      },
      (payload: any) => {
        console.log("Realtime update:", payload);

        const newRow = payload.new as {
          is_live?: boolean;
          started_at?: string;
        };        

        if (newRow?.started_at) {
  setStartedAt(newRow.started_at);

  const startTime = new Date(newRow.started_at).getTime();
  const now = Date.now();
  const secondsLeft = Math.ceil((startTime - now) / 1000);

  if (secondsLeft > 0) {
    setCountdown(secondsLeft);
  } else {
    setCountdown(null);
    setIsLive(true);
  }
}

      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);

// 🔹 Countdown interval (SEPARATE EFFECT)
useEffect(() => {
  if (countdown === null) return;

  if (countdown <= 0) {
    setCountdown(null);
    setIsLive(true);
    return;
  }

  const interval = setInterval(() => {
    setCountdown((prev) => (prev !== null ? prev - 1 : null));
  }, 1000);

  return () => clearInterval(interval);
}, [countdown]);

useEffect(() => {
  if (!startedAt) return;
  if (!audioUnlocked) {
    console.log("Audio not unlocked yet");
    return;
  }
  if (!audioRef.current) return;

  const startTime = new Date(startedAt).getTime();
  const now = Date.now();
  const secondsPassed = Math.max(0, (now - startTime) / 1000);

  console.log("SYNCING AUDIO AT:", secondsPassed);

  audioRef.current.currentTime = secondsPassed;

  audioRef.current.play().catch((err) => {
    console.log("Autoplay blocked:", err);
  });

}, [startedAt, audioUnlocked]);


  return (
    <main className="relative min-h-screen text-[#F5E6C8] overflow-hidden">

{countdown !== null && (
  <div className="absolute inset-0 flex items-center justify-center text-6xl font-serif text-[#F5E6C8] z-50">
    {countdown}
  </div>
)}

      {/* Background image (smooth breathing) */}
      <img
        src="/room-bg.jpg"
        alt=""
        className={`absolute inset-0 w-full h-full object-cover animate-roomBreath transition-all duration-1000 ${
          isLive ? "brightness-75 scale-105" : "brightness-100 scale-100"
        }`}
        
      />

      {/* Cinematic overlays */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.75)_85%)]" />

      {/* Header */}
      <header className={`relative z-10 w-full px-6 py-4 border-b transition-all duration-700 ${
  isLive
    ? "border-[#C47A2C]/50 shadow-[0_0_25px_rgba(196,122,44,0.2)]"
    : "border-[#F5E6C8]/20"
}`}>

        <div className="mx-auto max-w-6xl flex items-center justify-between">

          <div className="flex flex-col">
            <span className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">
              Now Showing
            </span>
            <h1 className="text-2xl md:text-3xl font-serif tracking-wide">
              The Album Club
            </h1>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-xs uppercase tracking-[0.25em] text-[#F5E6C8]/70">
                Showtime
              </div>
              <div className="font-mono text-lg md:text-xl">
                8:00 PM
              </div>
            </div>

            {/* Live Toggle (temporary for development) */}
            <button
              onClick={triggerShowtime}
              className="rounded-xl bg-black/30 border border-[#F5E6C8]/15 px-4 py-2 text-xs tracking-[0.25em] uppercase hover:bg-black/40 transition"
            >
              {isLive ? "Now Playing" : "Start Showtime"}
            
            </button>
          </div>

        </div>
      </header>

      {/* Center Stage */}
<section className="relative z-10 flex flex-col items-center justify-center min-h-[70vh] text-center">

{/* Room Title */}
<div className="mb-10">
  <div className="text-xs tracking-[0.3em] uppercase text-[#C47A2C]">
    Listening Room
  </div>
  <h2 className="mt-3 text-4xl md:text-5xl font-serif">
    Russo’s Lounge
  </h2>
  <p className="mt-3 text-[#F5E6C8]/70">
    Full-album experience. No skips. Just vibe.
  </p>
</div>

{/* Turntable Stage */}
<div
  className={`relative w-[460px] h-[460px] flex items-center justify-center ${
    isLive ? "animate-stageGlow" : ""
  }`}
  style={{ transform: "translateX(-20px)" }} // optical centering tweak
>

  {/* Platter Base */}
  <div className="absolute inset-0 rounded-2xl border border-[#F5E6C8]/15 bg-black/40 backdrop-blur-md shadow-2xl" />

  {/* Vinyl */}
  <div
    className={`relative w-72 h-72 rounded-full bg-black shadow-xl ${
      isLive ? "animate-vinylSpin" : ""
    }`}
  >

    {/* Grooves */}
    <div className="absolute inset-4 rounded-full border border-white/10" />
    <div className="absolute inset-8 rounded-full border border-white/10" />
    <div className="absolute inset-12 rounded-full border border-white/10" />

    {/* Label */}
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-16 h-16 rounded-full bg-[#C47A2C]/90 shadow-inner" />
    </div>
    {/* sheen (makes rotation obvious) */}
  <div className={`vinyl-sheen ${isLive ? "animate-vinylSheen" : ""}`} />
  </div>

{/* Tonearm (classic top-right hardware, lands ~4 o’clock) */}
<div
  className={`absolute right-[24px] top-[34px] pointer-events-none ${
    isLive ? "tonearm-drop" : ""
  }`}
>
  {/* hardware base */}
  <div className="relative w-24 h-24">
    {/* outer ring */}
    <div className="absolute right-0 top-0 w-16 h-16 rounded-full bg-[#F5E6C8]/10 border border-[#F5E6C8]/25 shadow-sm" />
    {/* inner hub */}
    <div className="absolute right-[14px] top-[14px] w-8 h-8 rounded-full bg-[#F5E6C8]/12 border border-[#F5E6C8]/25" />
    {/* little knob */}
    <div className="absolute right-[2px] top-[46px] w-5 h-5 rounded-full bg-[#F5E6C8]/10 border border-[#F5E6C8]/20" />

    {/* arm (anchored at hub) */}
    <div className="absolute right-[30px] top-[30px] origin-[100%_50%] rotate-[-70deg]">
      {/* arm tube */}
      <div className="w-56 h-[6px] rounded-full bg-[#F5E6C8]/22 border border-[#F5E6C8]/15 shadow-sm" />

      {/* headshell */}
      <div className="absolute left-[-10px] top-[-2px] w-12 h-8 rounded-md bg-[#F5E6C8]/14 border border-[#F5E6C8]/20 shadow-sm rotate-[-10deg]" />
      {/* cartridge */}
      <div className="absolute left-[2px] top-[4px] w-6 h-4 rounded bg-[#F5E6C8]/18 border border-[#F5E6C8]/20" />

      {/* stylus tip (near record) */}
      <div className="absolute left-[8px] top-[16px] w-2 h-2 rounded-full bg-[#C47A2C]/90 shadow" />

      {/* contact sparkle (only on drop moment) */}
      {needleDrop && (
        <div className="absolute left-[4px] top-[12px] w-5 h-5 needle-spark">
          <div className="absolute inset-0 rounded-full bg-[#C47A2C]/35" />
          <div className="absolute left-1/2 top-1/2 w-1 h-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/45 rounded" />
          <div className="absolute left-1/2 top-1/2 h-1 w-6 -translate-x-1/2 -translate-y-1/2 bg-[#C47A2C]/45 rounded" />
        </div>
      )}
    </div>
  </div>
</div>

</div>

{/* Status */}
<div className="mt-10 text-sm tracking-[0.25em] uppercase text-[#F5E6C8]/60">
  {isLive ? "LIVE — spinning" : "Waiting for showtime"}
</div>

</section>
{/* Floating Chat (bottom-right, minimizable) */}
<div className="fixed bottom-6 right-6 z-30 max-w-[92vw]">
  {chatOpen ? (
    <div className="w-[360px] overflow-hidden rounded-2xl border border-[#F5E6C8]/15 bg-black/45 backdrop-blur-md shadow-2xl">
      {/* header */}
      <div className="px-4 py-3 border-b border-[#F5E6C8]/10 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <div className="font-serif text-lg">Chat</div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-[#F5E6C8]/60">
            {isLive ? "Live" : "Lobby"}
          </div>
        </div>

        <button
          onClick={() => setChatOpen(false)}
          className="rounded-lg px-2 py-1 text-xs tracking-[0.25em] uppercase border border-[#F5E6C8]/15 bg-black/25 hover:bg-black/35 transition"
          aria-label="Minimize chat"
        >
          Minimize
        </button>
      </div>

      {/* messages */}
      <div className="px-4 py-3 h-48 overflow-y-auto text-sm text-[#F5E6C8]/80 space-y-2">
        <p>
          <span className="text-[#C47A2C]">Andre:</span> lights low, let’s do this
        </p>
        <p>
          <span className="text-[#C47A2C]">João:</span> this intro is insane
        </p>
      </div>

      {/* input */}
      <div className="p-3 border-t border-[#F5E6C8]/10 flex gap-2">
        <input
          className="flex-1 rounded-xl bg-black/30 border border-[#F5E6C8]/15 px-3 py-2 text-sm outline-none placeholder:text-[#F5E6C8]/40 focus:border-[#C47A2C]/40"
          placeholder="Type a message..."
        />
        <button className="rounded-xl bg-[#6B1F1F]/80 hover:bg-[#8A2A2A] transition px-4 py-2 text-sm">
          Send
        </button>
      </div>
    </div>
  ) : (
    /* Collapsed pill */
    <button
      onClick={() => setChatOpen(true)}
      className="flex items-center gap-3 rounded-full border border-[#F5E6C8]/15 bg-black/45 backdrop-blur-md shadow-2xl px-4 py-3 hover:bg-black/55 transition"
      aria-label="Open chat"
    >
      <span className="font-serif">Chat</span>
      <span className="text-[10px] tracking-[0.25em] uppercase text-[#F5E6C8]/60">
        {isLive ? "Live" : "Lobby"}
      </span>

      {/* optional unread badge (placeholder) */}
      <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#C47A2C]/80 text-[10px] text-black">
        2
      </span>
    </button>
  )}
</div>

<audio
  ref={audioRef}
  src="https://obnhrzehigtbadynicss.supabase.co/storage/v1/object/public/Albums/Lonerism.mp3"
  preload="auto"
  crossOrigin="anonymous"
/>

    </main>
  );
}
