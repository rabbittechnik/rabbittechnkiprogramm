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
      <span className="font-display text-lg sm:text-xl font-bold italic tracking-wide text-white drop-shadow-[0_0_12px_rgba(0,212,255,0.5)]">
        RABBIT-TECHNIK
      </span>
    </div>
  );
}
