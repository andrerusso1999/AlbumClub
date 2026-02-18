export default function Home() {
  return (
    <main className="min-h-screen bg-[#2C1B12] text-[#F5E6C8] flex flex-col items-center justify-center px-6">
      
      <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-wide">
        The Album Club
      </h1>

      <p className="text-lg md:text-xl text-center max-w-xl mb-10 text-[#C47A2C]">
        A cozy listening room for full-album experiences.  
        No skips. No distractions. Just music and friends.
      </p>

      <button className="bg-[#6B1F1F] hover:bg-[#8A2A2A] transition-colors duration-300 px-8 py-4 rounded-md text-lg tracking-wide">
        Now Showing
      </button>

    </main>
  );
}
