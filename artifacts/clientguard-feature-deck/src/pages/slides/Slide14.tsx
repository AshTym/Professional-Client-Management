export default function Slide14() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Operations and roadmap</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="max-w-[88vw] font-display text-[3.65vw] font-bold leading-[1.08]">Firm operations reporting—and a transparent roadmap</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-2 gap-[2vw]">
          <section className="flex flex-col justify-center rounded-[1vw] bg-primary p-[2.5vw] text-white">
            <ul className="mt-[2vh] space-y-[2vh]"><li className="flex gap-[1vw]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-[#55C3B5]"/><span className="text-[2vw] leading-[1.3]">Available: workload, team capacity, aging work in progress, deadline pressure, and matter pipeline</span></li><li className="flex gap-[1vw]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-[#55C3B5]"/><span className="text-[2vw] leading-[1.3]">Set weekly hours and active-matter limits for team members</span></li></ul>
            <div className="mt-[2.3vh] grid grid-cols-3 gap-[.8vw]"><div className="h-[7vh] rounded-[.5vw] bg-white/10 p-[.8vw]"><div className="h-[.55vw] w-[72%] rounded-full bg-white/60"/></div><div className="h-[7vh] rounded-[.5vw] bg-white/10 p-[.8vw]"><div className="h-[.55vw] w-[55%] rounded-full bg-[#55C3B5]"/></div><div className="h-[7vh] rounded-[.5vw] bg-white/10 p-[.8vw]"><div className="h-[.55vw] w-[82%] rounded-full bg-white/60"/></div></div>
          </section>
          <section className="flex flex-col justify-center rounded-[1vw] border border-[#D7E5E8] bg-[#E9F4F2] p-[2.5vw]">
            <ul className="mt-[2vh] space-y-[2vh]"><li className="flex gap-[1vw]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Planned—not yet available: reusable matter playbooks and ongoing KYC/beneficial-ownership monitoring</span></li><li className="flex gap-[1vw]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Planned—not yet available: periodic access reviews and matter budget/retainer tracking</span></li></ul>
            <div className="mt-[2.3vh] flex gap-[.8vw]"><div className="h-[.8vh] flex-1 rounded-full bg-accent/25"/><div className="h-[.8vh] flex-1 rounded-full bg-accent/45"/><div className="h-[.8vh] flex-1 rounded-full bg-accent/70"/></div>
          </section>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>14 / 15</span></footer>
    </div>
  );
}