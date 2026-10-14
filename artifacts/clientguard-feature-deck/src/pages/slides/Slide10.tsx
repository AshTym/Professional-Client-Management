export default function Slide10() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Client money records</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.7vw] font-bold leading-[1.08]">Client-money records with approvals and reconciliation</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1.12fr_.88fr] gap-[3vw]">
          <ul className="grid grid-cols-2 content-center gap-x-[2vw] gap-y-[1.2vh]">
            <li className="flex min-h-[17vh] gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Matter-specific deposit and disbursement ledger entries</span></li>
            <li className="flex min-h-[17vh] gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Approve or reject entries; ClientGuard does not move funds</span></li>
            <li className="flex min-h-[17vh] gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Reconcile manual or CSV statements and surface exceptions</span></li>
            <li className="flex min-h-[17vh] gap-[1vw] border-t-2 border-accent py-[1.7vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Matter statements with firm settings for Australia, the USA, and Great Britain</span></li>
          </ul>
          <section className="flex flex-col justify-between rounded-[1vw] border border-[#E2E8F0] bg-white p-[2.5vw] shadow-[0_.6vw_1.8vw_rgba(30,58,95,.06)]">
            <div className="text-[1.7vw] font-semibold">Matter ledger</div>
            <div className="mt-[2vh] grid grid-cols-[1fr_auto] border-b border-[#E2E8F0] pb-[1.2vh] text-[1.5vw] font-semibold text-muted"><span>Record</span><span>Status</span></div>
            <div className="space-y-[1.1vh] py-[1.5vh]"><div className="flex justify-between rounded-[.5vw] bg-[#F1F6F7] px-[1.2vw] py-[1.2vh] text-[1.6vw]"><span>Deposit</span><span className="text-accent">Review</span></div><div className="flex justify-between rounded-[.5vw] bg-[#F1F6F7] px-[1.2vw] py-[1.2vh] text-[1.6vw]"><span>Disbursement</span><span className="text-accent">Approval</span></div><div className="flex justify-between rounded-[.5vw] bg-[#F1F6F7] px-[1.2vw] py-[1.2vh] text-[1.6vw]"><span>Statement line</span><span className="text-accent">Match</span></div></div>
            <div className="h-[1.2vh] rounded-full bg-primary"/>
            <div className="mt-[1.6vh] flex flex-wrap gap-[.7vw]"><span className="rounded-full bg-[#E9F4F2] px-[1vw] py-[.6vh] text-[1.5vw] text-accent">Australia</span><span className="rounded-full bg-[#E9F4F2] px-[1vw] py-[.6vh] text-[1.5vw] text-accent">USA</span><span className="rounded-full bg-[#E9F4F2] px-[1vw] py-[.6vh] text-[1.5vw] text-accent">Great Britain</span></div>
          </section>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>10 / 15</span></footer>
    </div>
  );
}