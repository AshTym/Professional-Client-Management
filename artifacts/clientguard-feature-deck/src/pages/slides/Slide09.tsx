export default function Slide09() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Engagement letters</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">Engagement letters with signature tracking</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1fr_.82fr] gap-[3vw]">
          <ul className="grid grid-rows-4 gap-[1vh]">
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1.3vh]"><span className="h-[1.2vw] w-[1.2vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Draft from matter scope and billing terms</span></li>
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1.3vh]"><span className="h-[1.2vw] w-[1.2vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Send through the firm's DocuSign connection</span></li>
            <li className="flex items-center gap-[1.2vw] border-b border-[#DCE5EB] py-[1.3vh]"><span className="h-[1.2vw] w-[1.2vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Sync completion status and attach the signed PDF</span></li>
            <li className="flex items-center gap-[1.2vw] py-[1.3vh]"><span className="h-[1.2vw] w-[1.2vw] shrink-0 rounded-full bg-primary"/><span className="text-[2vw] leading-[1.3]">Firm settings can require a signed letter before a matter opens</span></li>
          </ul>
          <div className="flex flex-col justify-center rounded-[1vw] bg-accent p-[2.6vw] text-white">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-white/75">Signature workflow</div>
            <div className="mt-[3vh] rounded-[.7vw] bg-white p-[2vw] text-primary"><div className="text-[1.7vw] font-semibold">Engagement letter</div><div className="mt-[1.5vh] h-[.6vw] w-[82%] rounded-full bg-[#CBD5E1]"/><div className="mt-[1vh] h-[.6vw] w-[66%] rounded-full bg-[#CBD5E1]"/><div className="mt-[2vh] flex items-center justify-between border-t border-[#E2E8F0] pt-[1.5vh]"><span className="text-[1.5vw] text-muted">DocuSign</span><span className="rounded-full bg-[#D9F1EC] px-[1vw] py-[.7vh] text-[1.5vw] font-semibold text-accent">Signed PDF</span></div></div>
            <div className="mt-[2.4vh] text-[1.8vw] font-semibold">Matter opening gate: firm-configurable</div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>09 / 15</span></footer>
    </div>
  );
}