export default function Slide03() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Client and matter workspace</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">Client and matter work, one view</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1.05fr_.95fr] gap-[3vw]">
          <ul className="flex flex-col justify-center gap-[2vh]">
            <li className="flex gap-[1.2vw] border-b border-[#DCE5EB] py-[1.7vh]"><span className="mt-[.8vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Create and search client and matter records</span></li>
            <li className="flex gap-[1.2vw] border-b border-[#DCE5EB] py-[1.7vh]"><span className="mt-[.8vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Open detailed records from dashboard cards</span></li>
            <li className="flex gap-[1.2vw] border-b border-[#DCE5EB] py-[1.7vh]"><span className="mt-[.8vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Follow recent activity across the firm</span></li>
            <li className="flex gap-[1.2vw] py-[1.7vh]"><span className="mt-[.8vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Download selected matters—or all matters—as PDFs</span></li>
          </ul>
          <section className="flex flex-col justify-center rounded-[1vw] border border-[#E2E8F0] bg-white p-[2.5vw] shadow-[0_.6vw_1.8vw_rgba(30,58,95,.06)]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-[1.6vh]"><span className="text-[1.7vw] font-semibold">Firm workspace</span><span className="h-[1vw] w-[1vw] rounded-full bg-accent"/></div>
            <div className="mt-[2.5vh] grid grid-cols-2 gap-[1.2vw]"><div className="rounded-[.6vw] bg-[#F1F6F7] p-[1.5vw]"><div className="text-[1.5vw] font-semibold">Clients</div><div className="mt-[2vh] h-[.7vw] w-[82%] rounded-full bg-accent/30"/><div className="mt-[1.1vh] h-[.7vw] w-[60%] rounded-full bg-[#CBD5E1]"/></div><div className="rounded-[.6vw] bg-[#F1F6F7] p-[1.5vw]"><div className="text-[1.5vw] font-semibold">Matters</div><div className="mt-[2vh] h-[.7vw] w-[74%] rounded-full bg-accent/30"/><div className="mt-[1.1vh] h-[.7vw] w-[54%] rounded-full bg-[#CBD5E1]"/></div></div>
            <div className="mt-[2vh] rounded-[.6vw] bg-[#F7F9FA] p-[1.5vw]"><div className="text-[1.5vw] font-semibold">Recent activity</div><div className="mt-[1.7vh] h-[.6vw] w-[91%] rounded-full bg-[#DCE5EB]"/><div className="mt-[1.1vh] h-[.6vw] w-[74%] rounded-full bg-[#DCE5EB]"/><div className="mt-[1.1vh] h-[.6vw] w-[85%] rounded-full bg-[#DCE5EB]"/></div>
          </section>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>03 / 15</span></footer>
    </div>
  );
}