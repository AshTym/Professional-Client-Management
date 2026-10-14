export default function Slide06() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Document workflow</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">Documents become proposed work—not automatic tasks</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[.92fr_1.08fr] items-center gap-[3vw]">
          <ul className="space-y-[1.5vh]">
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.3vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">Store private matter documents</span></li>
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.3vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">Extract source-backed task and calendar suggestions</span></li>
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.3vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">Show the supporting page and quoted text</span></li>
            <li className="flex gap-[1vw] py-[1.3vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">Confirm or reject suggestions before adding them to the planner</span></li>
          </ul>
          <div className="rounded-[1vw] bg-primary p-[2.4vw] text-white">
            <div className="grid grid-cols-[.82fr_1.18fr] gap-[1.5vw]">
              <div className="rounded-[.7vw] bg-white p-[1.6vw] text-primary"><div className="text-[1.5vw] font-semibold">Matter document</div><div className="mt-[2vh] h-[14vh] rounded-[.4vw] bg-[#E7EEF2] p-[1.2vw]"><div className="h-[.7vw] w-[82%] rounded-full bg-[#B8C7D1]"/><div className="mt-[1.2vh] h-[.7vw] w-[68%] rounded-full bg-[#B8C7D1]"/><div className="mt-[1.2vh] h-[.7vw] w-[78%] rounded-full bg-[#B8C7D1]"/></div></div>
              <div className="flex flex-col justify-between rounded-[.7vw] bg-white p-[1.6vw] text-primary"><div><div className="text-[1.5vw] font-semibold">Source-backed suggestion</div><div className="mt-[2vh] rounded-[.4vw] bg-[#E9F4F2] p-[1.2vw]"><div className="text-[1.5vw] font-semibold text-accent">Supporting page</div><div className="mt-[1.1vh] h-[.6vw] w-[80%] rounded-full bg-[#C5DDD9]"/><div className="mt-[1vh] h-[.6vw] w-[62%] rounded-full bg-[#C5DDD9]"/></div></div><div className="mt-[2vh] flex gap-[1vw]"><div className="rounded-[.4vw] bg-accent px-[1.2vw] py-[.8vh] text-[1.5vw] font-semibold text-white">Confirm</div><div className="rounded-[.4vw] bg-[#EDF1F4] px-[1.2vw] py-[.8vh] text-[1.5vw] font-semibold">Reject</div></div></div>
            </div>
            <div className="mt-[2vh] text-[1.6vw] font-semibold">Planner item appears after confirmation</div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>06 / 15</span></footer>
    </div>
  );
}