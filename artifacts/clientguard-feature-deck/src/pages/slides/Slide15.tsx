export default function Slide15() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Pricing</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[4vw] font-bold leading-[1.08]">See what fits your firm</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[.9fr_1.1fr] gap-[3vw]">
          <section className="flex flex-col justify-center rounded-[1vw] border border-[#E2E8F0] bg-white p-[3vw] shadow-[0_.6vw_1.8vw_rgba(30,58,95,.06)]">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-accent">One client and one matter</div>
            <div className="mt-[2vh] font-display text-[4.5vw] font-bold">Free</div>
            <div className="mt-[1.5vh] text-[2vw] leading-[1.3]">One client and one matter: free</div>
          </section>
          <section className="flex flex-col justify-center rounded-[1vw] bg-accent p-[3vw] text-white shadow-[0_.6vw_1.8vw_rgba(13,148,136,.16)]">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-white/75">Two or more clients</div>
            <div className="mt-[2vh] flex items-baseline gap-[1vw]"><span className="font-display text-[4.5vw] font-bold">AU$15</span><span className="text-[2vw]">per client per month</span></div>
            <div className="mt-[1.5vh] text-[2vw] leading-[1.3]">Two or more clients: AU$15 per client per month</div>
          </section>
        </div>
        <div className="mt-[2vh] flex items-center justify-between gap-[2vw] rounded-[.8vw] border border-[#D7E5E8] bg-white px-[2vw] py-[1.5vh]">
          <p className="text-[1.7vw] leading-[1.25] text-muted">Pricing is informational; access limits are not enforced yet</p>
          <a href="https://professional-cms.replit.app" target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-[.5vw] bg-primary px-[1.8vw] py-[1.2vh] text-[1.7vw] font-semibold text-white underline">Explore ClientGuard: https://professional-cms.replit.app</a>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>15 / 15</span></footer>
    </div>
  );
}