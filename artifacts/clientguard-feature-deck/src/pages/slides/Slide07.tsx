export default function Slide07() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Client communication</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="max-w-[82vw] font-display text-[3.7vw] font-bold leading-[1.08]">Client updates, drafted from real matter activity</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1.2fr_.8fr] gap-[3vw]">
          <ul className="grid grid-cols-2 content-center gap-x-[2vw] gap-y-[1vh]">
            <li className="flex gap-[1vw] border-t-2 border-accent py-[1.5vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Set a matter-specific draft cadence</span></li>
            <li className="flex gap-[1vw] border-t-2 border-accent py-[1.5vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Generate updates from recorded matter activity</span></li>
            <li className="flex gap-[1vw] border-t-2 border-accent py-[1.5vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Edit and review before publishing</span></li>
            <li className="flex gap-[1vw] border-t-2 border-accent py-[1.5vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Publish to the client portal or explicitly send by email</span></li>
            <li className="col-span-2 flex gap-[1vw] border-t-2 border-[#CFE4E0] py-[1.5vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-primary"/><span className="text-[2vw] leading-[1.3]">Drafts are not sent automatically</span></li>
          </ul>
          <div className="flex flex-col justify-center rounded-[1vw] bg-[#E9F4F2] p-[2.5vw]">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-accent">Review before sharing</div>
            <div className="mt-[3vh] space-y-[2vh]"><div className="flex items-center gap-[1vw]"><div className="grid h-[3.2vw] w-[3.2vw] place-items-center rounded-full bg-accent text-[1.5vw] font-bold text-white">1</div><span className="text-[2vw] font-semibold">Draft</span></div><div className="ml-[1.5vw] h-[2.5vh] w-[.15vw] bg-accent/50"/><div className="flex items-center gap-[1vw]"><div className="grid h-[3.2vw] w-[3.2vw] place-items-center rounded-full bg-accent text-[1.5vw] font-bold text-white">2</div><span className="text-[2vw] font-semibold">Review</span></div><div className="ml-[1.5vw] h-[2.5vh] w-[.15vw] bg-accent/50"/><div className="flex items-center gap-[1vw]"><div className="grid h-[3.2vw] w-[3.2vw] place-items-center rounded-full bg-primary text-[1.5vw] font-bold text-white">3</div><span className="text-[2vw] font-semibold">Publish or send</span></div></div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>07 / 15</span></footer>
    </div>
  );
}