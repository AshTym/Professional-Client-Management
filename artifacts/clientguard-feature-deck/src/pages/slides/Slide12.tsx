export default function Slide12() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Governance controls</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">Audit, retention, and legal-hold controls</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1fr_.85fr] gap-[3vw]">
          <ul className="flex flex-col justify-center">
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Record sensitive views, downloads, exports, and approval actions</span></li>
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Search and export firm activity</span></li>
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Set retention periods for matter and audit records</span></li>
            <li className="flex gap-[1vw] py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-primary"/><span className="text-[2vw] leading-[1.3]">Apply or release legal holds to preserve protected records</span></li>
          </ul>
          <div className="flex flex-col justify-center rounded-[1vw] bg-primary p-[3vw] text-white">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-white/70">Record governance</div>
            <div className="mt-[3vh] space-y-[1.4vh]"><div className="rounded-[.6vw] bg-white/10 px-[1.5vw] py-[1.4vh] text-[1.8vw]">Sensitive activity</div><div className="rounded-[.6vw] bg-white/10 px-[1.5vw] py-[1.4vh] text-[1.8vw]">Retention period</div><div className="rounded-[.6vw] bg-accent px-[1.5vw] py-[1.4vh] text-[1.8vw] font-semibold">Legal hold</div></div>
            <div className="mt-[3vh] h-[.7vw] w-full rounded-full bg-white/20"><div className="h-full w-[68%] rounded-full bg-[#55C3B5]"/></div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>12 / 15</span></footer>
    </div>
  );
}