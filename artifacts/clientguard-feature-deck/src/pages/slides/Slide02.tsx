export default function Slide02() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">End-to-end workflow</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="max-w-[78vw] font-display text-[3.8vw] font-bold leading-[1.08]">A clearer path from intake to closeout</h1>
        <div className="mt-[5vh] grid flex-1 grid-cols-[1.2fr_.8fr] gap-[3vw]">
          <ul className="grid grid-rows-4 gap-[1.6vh]">
            <li className="flex items-center gap-[1.5vw] border-b border-[#DCE5EB] py-[1.2vh]"><span className="grid h-[3.4vw] w-[3.4vw] shrink-0 place-items-center rounded-full bg-accent text-[1.7vw] font-bold text-white">1</span><span className="text-[2vw] leading-[1.28]">Gather parties and client details before a matter opens</span></li>
            <li className="flex items-center gap-[1.5vw] border-b border-[#DCE5EB] py-[1.2vh]"><span className="grid h-[3.4vw] w-[3.4vw] shrink-0 place-items-center rounded-full bg-accent text-[1.7vw] font-bold text-white">2</span><span className="text-[2vw] leading-[1.28]">Review potential conflicts and firm-configured onboarding checks</span></li>
            <li className="flex items-center gap-[1.5vw] border-b border-[#DCE5EB] py-[1.2vh]"><span className="grid h-[3.4vw] w-[3.4vw] shrink-0 place-items-center rounded-full bg-accent text-[1.7vw] font-bold text-white">3</span><span className="text-[2vw] leading-[1.28]">Manage work, documents, and communication in one matter context</span></li>
            <li className="flex items-center gap-[1.5vw] py-[1.2vh]"><span className="grid h-[3.4vw] w-[3.4vw] shrink-0 place-items-center rounded-full bg-accent text-[1.7vw] font-bold text-white">4</span><span className="text-[2vw] leading-[1.28]">Close with billing, handover, and retention review</span></li>
          </ul>
          <div className="flex flex-col justify-between rounded-[1vw] bg-accent p-[3vw] text-white">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-white/75">Matter lifecycle</div>
            <div className="space-y-[2vh]"><div className="h-[1.2vh] w-[82%] rounded-full bg-white/35"/><div className="h-[1.2vh] w-[63%] rounded-full bg-white/55"/><div className="h-[1.2vh] w-[90%] rounded-full bg-white/75"/><div className="h-[1.2vh] w-[48%] rounded-full bg-white"/></div>
            <div className="text-[3vw] font-bold leading-[1.05]">From first contact to matter closeout</div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>02 / 15</span></footer>
    </div>
  );
}