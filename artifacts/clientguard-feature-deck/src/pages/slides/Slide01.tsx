export default function Slide01() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg px-[4vw] py-[4vh] font-body text-primary">
      <header className="flex h-[8vh] shrink-0 items-center justify-between border-b border-[#E2E8F0] pb-[1.5vh]">
        <div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[.4vw] bg-accent"/><span className="font-display text-[1.6vw] font-bold">ClientGuard</span></div>
        <div className="text-[1.5vw] font-medium uppercase tracking-[.1em] text-muted">Feature overview</div>
      </header>
      <main className="grid h-[79vh] grid-cols-[1.05fr_.95fr] items-center gap-[4vw]">
        <section className="flex flex-col justify-center">
          <div className="mb-[1.5vh] text-[1.5vw] font-semibold uppercase tracking-[.12em] text-accent">Client and matter management</div>
          <h1 className="font-display text-[5.4vw] font-extrabold leading-[1.03]">ClientGuard</h1>
          <p className="mt-[2.4vh] max-w-[42vw] text-[2.15vw] leading-[1.42] text-[#475569]">Client and matter management for law firms and financial-service providers.</p>
          <div className="mt-[4vh] grid grid-cols-2 gap-[1.4vw]">
            <div className="rounded-[.8vw] border border-[#E2E8F0] bg-white p-[1.8vw] shadow-[0_.5vw_1.5vw_rgba(30,58,95,.05)]"><div className="text-[1.5vw] font-semibold">Law firms</div><div className="mt-[1.2vh] h-[.45vw] w-[65%] rounded-full bg-accent/20"><div className="h-full w-[70%] rounded-full bg-accent"/></div></div>
            <div className="rounded-[.8vw] border border-[#E2E8F0] bg-white p-[1.8vw] shadow-[0_.5vw_1.5vw_rgba(30,58,95,.05)]"><div className="text-[1.5vw] font-semibold">Financial-service providers</div><div className="mt-[1.2vh] h-[.45vw] w-[65%] rounded-full bg-accent/20"><div className="h-full w-[82%] rounded-full bg-accent"/></div></div>
          </div>
        </section>
        <section className="flex h-[59vh] items-center">
          <div className="flex h-full w-full flex-col rounded-[1vw] border border-[#E2E8F0] bg-white p-[3vw] shadow-[0_.7vw_2vw_rgba(30,58,95,.08)]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-[2vh]"><div className="text-[1.7vw] font-semibold">A clearer path from intake to closeout</div><div className="h-[1.1vw] w-[1.1vw] rounded-full bg-accent"/></div>
            <div className="mt-[5vh] flex flex-1 items-end gap-[1.2vw] border-b-2 border-[#E2E8F0] pb-[2vh]">
              <div className="flex flex-1 flex-col items-center gap-[1.5vh]"><div className="h-[17vh] w-full rounded-t-[.5vw] bg-accent/20"/><span className="text-[1.5vw] font-medium text-muted">Intake</span></div>
              <div className="flex flex-1 flex-col items-center gap-[1.5vh]"><div className="h-[23vh] w-full rounded-t-[.5vw] bg-accent/40"/><span className="text-[1.5vw] font-medium text-muted">Review</span></div>
              <div className="flex flex-1 flex-col items-center gap-[1.5vh]"><div className="h-[29vh] w-full rounded-t-[.5vw] bg-accent/70"/><span className="text-[1.5vw] font-medium text-muted">Work</span></div>
              <div className="flex flex-1 flex-col items-center gap-[1.5vh]"><div className="h-[35vh] w-full rounded-t-[.5vw] bg-accent"/><span className="text-[1.5vw] font-medium text-muted">Closeout</span></div>
            </div>
            <div className="mt-[2.5vh] flex items-center gap-[1vw] text-[1.5vw] text-muted"><span className="h-[.7vw] w-[.7vw] rounded-full bg-accent"/><span>One firm-scoped workspace</span></div>
          </div>
        </section>
      </main>
      <footer className="absolute bottom-[3vh] left-[4vw] right-[4vw] flex items-center justify-between border-t border-[#E2E8F0] pt-[1.7vh] text-[1.5vw] text-muted"><span>ClientGuard</span><span>01 / 15</span></footer>
    </div>
  );
}