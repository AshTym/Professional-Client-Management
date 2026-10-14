export default function Slide05() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Matter billing</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">Billing drafts with saved terms and review</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1fr_.78fr] gap-[3vw]">
          <ul className="grid grid-cols-2 content-center gap-x-[2vw] gap-y-[1.3vh]">
            <li className="flex min-h-[16vh] items-start gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.6vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Save matter fee type, rate, currency, cycle, and tax terms</span></li>
            <li className="flex min-h-[16vh] items-start gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.6vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Record time and billable work against matters</span></li>
            <li className="flex min-h-[16vh] items-start gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.6vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Prepare scheduled draft bills from fixed fees or unbilled time</span></li>
            <li className="flex min-h-[16vh] items-start gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.6vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Review each draft before syncing it to accounting</span></li>
          </ul>
          <section className="flex flex-col justify-between rounded-[1vw] border border-[#E2E8F0] bg-white p-[2.5vw] shadow-[0_.6vw_1.8vw_rgba(30,58,95,.06)]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-[1.6vh]"><span className="text-[1.7vw] font-semibold">Billing profile</span><span className="rounded-full bg-[#D9F1EC] px-[1vw] py-[.7vh] text-[1.5vw] font-semibold text-accent">Scheduled</span></div>
            <div className="grid grid-cols-2 gap-[1.3vw] py-[2vh]"><div className="rounded-[.5vw] bg-[#F1F6F7] p-[1.2vw]"><div className="text-[1.5vw] text-muted">Fee terms</div><div className="mt-[1vh] h-[.7vw] w-[80%] rounded-full bg-[#CBD5E1]"/></div><div className="rounded-[.5vw] bg-[#F1F6F7] p-[1.2vw]"><div className="text-[1.5vw] text-muted">Billing cycle</div><div className="mt-[1vh] h-[.7vw] w-[62%] rounded-full bg-[#CBD5E1]"/></div></div>
            <div className="rounded-[.7vw] bg-[#E9F4F2] p-[1.6vw]"><div className="text-[1.5vw] font-semibold text-accent">Draft bill ready for review</div><div className="mt-[1vh] h-[.65vw] w-[84%] rounded-full bg-[#C5DDD9]"/><div className="mt-[1vh] h-[.65vw] w-[65%] rounded-full bg-[#C5DDD9]"/></div>
          </section>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>05 / 15</span></footer>
    </div>
  );
}