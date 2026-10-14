export default function Slide11() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]"><div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div><span className="text-[1.5vw] uppercase tracking-[.1em] text-muted">Firm-authorized integrations</span></header>
      <main className="flex h-[79vh] flex-col justify-center">
        <h1 className="font-display text-[3.8vw] font-bold leading-[1.08]">Connect your firm's approved tools</h1>
        <div className="mt-[4vh] grid flex-1 grid-cols-[1fr_.78fr] gap-[3vw]">
          <ul className="grid grid-cols-2 content-center gap-x-[2vw] gap-y-[1vh]">
            <li className="flex min-h-[14vh] gap-[1vw] border-t-2 border-accent py-[1.4vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Firm-owned connections for Google Calendar and Gmail, or Microsoft Outlook</span></li>
            <li className="flex min-h-[14vh] gap-[1vw] border-t-2 border-accent py-[1.4vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Sync confirmed planner items to a connected calendar</span></li>
            <li className="flex min-h-[14vh] gap-[1vw] border-t-2 border-accent py-[1.4vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Sync reviewed draft bills to Xero or QuickBooks Online</span></li>
            <li className="flex min-h-[14vh] gap-[1vw] border-t-2 border-accent py-[1.4vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-accent"/><span className="text-[2vw] leading-[1.3]">Send reviewed client updates only after a professional's explicit action</span></li>
            <li className="col-span-2 flex gap-[1vw] border-t-2 border-[#CFE4E0] py-[1.4vh]"><span className="mt-[.7vh] h-[.9vw] w-[.9vw] shrink-0 rounded-full bg-primary"/><span className="text-[2vw] leading-[1.3]">Each firm authorizes its own accounts</span></li>
          </ul>
          <div className="flex flex-col justify-center rounded-[1vw] bg-[#E9F4F2] p-[2.4vw]">
            <div className="text-[1.5vw] font-semibold uppercase tracking-[.12em] text-accent">Connected providers</div>
            <div className="mt-[2.5vh] grid grid-cols-2 gap-[1vw]"><div className="rounded-[.6vw] bg-white p-[1.5vw] text-[1.8vw] font-semibold">Google Calendar and Gmail</div><div className="rounded-[.6vw] bg-white p-[1.5vw] text-[1.8vw] font-semibold">Microsoft Outlook</div><div className="rounded-[.6vw] bg-white p-[1.5vw] text-[1.8vw] font-semibold">Xero</div><div className="rounded-[.6vw] bg-white p-[1.5vw] text-[1.8vw] font-semibold">QuickBooks Online</div></div>
          </div>
        </div>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>11 / 15</span></footer>
    </div>
  );
}