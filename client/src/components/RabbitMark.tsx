/** Kompaktes Rabbit-Logo für Header (Mockup: weißes Kaninchen) */
export function RabbitMark({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="24" cy="28" rx="14" ry="12" fill="white" />
      <ellipse cx="16" cy="14" rx="5" ry="12" fill="white" />
      <ellipse cx="32" cy="14" rx="5" ry="12" fill="white" />
      <circle cx="19" cy="26" r="2.5" fill="#060b13" />
      <circle cx="29" cy="26" r="2.5" fill="#060b13" />
      <ellipse cx="24" cy="32" rx="3" ry="2" fill="#ffb8c6" opacity="0.5" />
    </svg>
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col leading-none ${className}`}>
      <span className="font-cyber text-xl sm:text-2xl md:text-3xl font-extrabold italic tracking-[0.12em] text-white uppercase drop-shadow-[0_0_20px_rgba(0,212,255,0.65),0_0_40px_rgba(0,212,255,0.25)]">
        RABBIT-TECHNIK
      </span>
    </div>
  );
}
