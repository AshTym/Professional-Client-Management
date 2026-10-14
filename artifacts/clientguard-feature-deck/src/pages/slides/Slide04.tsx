export default function Slide04() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Firm-configured intake</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="max-w-[83vw] font-display text-[3.5vw] font-bold leading-[1.08]">Intake that keeps professional judgment in the loop</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1fr_.82fr] gap-[3vw]">
          <ul className="grid grid-rows-4 gap-[1.1vh]">
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1vh]"><span className="h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Capture parties, related entities, matter details, and onboarding answers</span></li>
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1vh]"><span className="h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Configure firm-specific onboarding checks</span></li>
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1vh]"><span className="h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Surface potential conflicts for professional review</span></li>
            <li className="flex items-center gap-[1.2vw] py-[1vh]"><span className="h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Open a matter only after professional clearance</span></li>
          </ul>
          <div className="flex flex-col justify-center rounded-[1vw] bg-[#E9F4F2] p-[2.5vw]">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-accent">Review sequence</div>
            <div className="mt-[2vh] space-y-[1.4vh]"><div className="rounded-[.6vw] border border-[#CFE4E0] bg-white p-[1.4vw] text-[1.8vw] font-semibold">Parties and key details</div><div className="ml-[2vw] h-[2vh] w-[.2vw] bg-accent/50"/><div className="rounded-[.6vw] border border-[#CFE4E0] bg-white p-[1.4vw] text-[1.8vw] font-semibold">Potential conflict findings</div><div className="ml-[2vw] h-[2vh] w-[.2vw] bg-accent/50"/><div className="rounded-[.6vw] bg-accent p-[1.4vw] text-[1.8vw] font-semibold text-white">Professional clearance</div></div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>04 / 15</span></footer>
    </div>
  );
}