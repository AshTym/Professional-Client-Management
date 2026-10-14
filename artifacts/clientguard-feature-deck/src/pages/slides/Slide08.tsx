export default function Slide08() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Client portal</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">A focused portal for clients</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[.9fr_1.1fr] items-center gap-[3vw]">
          <ul className="space-y-[1.2vh]">
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.2vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">View explicitly shared matters and files</span></li>
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.2vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">Read approved matter updates</span></li>
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.2vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">Exchange portal messages and respond to requests</span></li>
            <li className="flex gap-[1vw] border-b border-[#DCE5EB] py-[1.2vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.28]">Upload documents for firm review</span></li>
            <li className="flex gap-[1vw] py-[1.2vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-primary"/><span className="text-[2vw] leading-[1.28]">Internal notes and drafts stay private</span></li>
          </ul>
          <section className="rounded-[1vw] border border-[#E2E8F0] bg-white p-[2.5vw] shadow-[0_.6vw_1.8vw_rgba(30,58,95,.06)]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><span className="text-[1.7vw] font-semibold">Client portal</span><span className="rounded-full bg-[#D9F1EC] px-[1vw] py-[.7vh] text-[1.5vw] font-semibold text-accent">Shared access</span></div>
            <div className="mt-[2vh] grid grid-cols-2 gap-[1.2vw]"><div className="rounded-[.6vw] bg-[#F1F6F7] p-[1.4vw]"><div className="text-[1.5vw] font-semibold">Shared matters</div><div className="mt-[1.4vh] h-[.6vw] w-[82%] rounded-full bg-[#C8D5DD]"/></div><div className="rounded-[.6vw] bg-[#F1F6F7] p-[1.4vw]"><div className="text-[1.5vw] font-semibold">Approved updates</div><div className="mt-[1.4vh] h-[.6vw] w-[70%] rounded-full bg-[#C8D5DD]"/></div></div>
            <div className="mt-[1.5vh] rounded-[.6vw] bg-[#F7F9FA] p-[1.4vw]"><div className="text-[1.5vw] font-semibold">Requests and documents</div><div className="mt-[1.3vh] flex gap-[.8vw]"><div className="h-[5vh] flex-1 rounded-[.4vw] bg-[#E6EDF1]"/><div className="h-[5vh] flex-1 rounded-[.4vw] bg-[#E6EDF1]"/><div className="h-[5vh] flex-1 rounded-[.4vw] bg-[#E6EDF1]"/></div></div>
            <div className="mt-[1.5vh] h-[1.2vh] rounded-full bg-primary"/>
          </section>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>08 / 15</span></footer>
    </div>
  );
}