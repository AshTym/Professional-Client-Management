export default function Slide13() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Matter closeout</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">Close matters; make return work easier</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1.08fr_.92fr] gap-[3vw]">
          <ul className="flex flex-col justify-center">
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1.5vh]"><span className="grid h-[2.7vw] w-[2.7vw] place-items-center rounded-full bg-[#D9F1EC] text-[1.7vw] font-bold text-accent">✓</span><span className="text-[2vw] leading-[1.3]">Track final billing, handover, and retention review</span></li>
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1.5vh]"><span className="grid h-[2.7vw] w-[2.7vw] place-items-center rounded-full bg-[#D9F1EC] text-[1.7vw] font-bold text-accent">✓</span><span className="text-[2vw] leading-[1.3]">Keep active legal holds visible during closeout</span></li>
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1.5vh]"><span className="grid h-[2.7vw] w-[2.7vw] place-items-center rounded-full bg-[#D9F1EC] text-[1.7vw] font-bold text-accent">✓</span><span className="text-[2vw] leading-[1.3]">Schedule renewal and re-engagement reminders</span></li>
            <li className="flex items-center gap-[1.2vw] py-[1.5vh]"><span className="grid h-[2.7vw] w-[2.7vw] place-items-center rounded-full bg-primary text-[1.7vw] font-bold text-white">✓</span><span className="text-[2vw] leading-[1.3]">Record checklist and follow-up status</span></li>
          </ul>
          <div className="flex flex-col justify-center rounded-[1vw] border border-[#E2E8F0] bg-white p-[2.5vw] shadow-[0_.6vw_1.8vw_rgba(30,58,95,.06)]">
            <div className="text-[1.7vw] font-semibold">Closeout checklist</div>
            <div className="mt-[2vh] space-y-[1.4vh]"><div className="flex items-center gap-[1vw] rounded-[.5vw] bg-[#F1F6F7] p-[1.3vw]"><span className="h-[1.1vw] w-[1.1vw] rounded-full bg-accent"/><span className="text-[1.7vw]">Final billing</span></div><div className="flex items-center gap-[1vw] rounded-[.5vw] bg-[#F1F6F7] p-[1.3vw]"><span className="h-[1.1vw] w-[1.1vw] rounded-full bg-accent"/><span className="text-[1.7vw]">Document handover</span></div><div className="flex items-center gap-[1vw] rounded-[.5vw] bg-[#F1F6F7] p-[1.3vw]"><span className="h-[1.1vw] w-[1.1vw] rounded-full bg-accent"/><span className="text-[1.7vw]">Retention review</span></div></div>
            <div className="mt-[2vh] rounded-[.6vw] bg-[#E9F4F2] p-[1.5vw]"><div className="text-[1.5vw] font-semibold uppercase tracking-[.1em] text-accent">Re-engagement reminder</div><div className="mt-[1.4vh] h-[.65vw] w-[78%] rounded-full bg-[#C5DDD9]"/></div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>13 / 15</span></footer>
    </div>
  );
}