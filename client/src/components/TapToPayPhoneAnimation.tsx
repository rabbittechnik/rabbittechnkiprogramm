/** Kleine Illustration: Smartphone + kontaktlose Karte (Tap-to-Pay-Stil), rein visuell. */
export function TapToPayPhoneAnimation() {
  return (
    <div className="flex justify-center py-4" aria-hidden>
      <svg viewBox="0 0 220 200" className="w-full max-w-[220px] h-[200px] text-[#00d4ff]">
        <defs>
          <linearGradient id="ttp-card" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#64748b" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
        </defs>
        {/* NFC-Wellen */}
        {[0, 1, 2].map((i) => (
          <ellipse
            key={i}
            cx="118"
            cy="88"
            rx={28 + i * 18}
            ry={22 + i * 14}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity={0.45 - i * 0.12}
          >
            <animate
              attributeName="opacity"
              values={`${0.5 - i * 0.1};${0.15 + i * 0.05};${0.5 - i * 0.1}`}
              dur={`${1.8 + i * 0.3}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="rx"
              values={`${28 + i * 18};${32 + i * 20};${28 + i * 18}`}
              dur={`${1.8 + i * 0.3}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="ry"
              values={`${22 + i * 14};${26 + i * 16};${22 + i * 14}`}
              dur={`${1.8 + i * 0.3}s`}
              repeatCount="indefinite"
            />
          </ellipse>
        ))}
        {/* Telefon */}
        <rect x="78" y="28" width="84" height="144" rx="14" fill="#0a1220" stroke="#39ff14" strokeWidth="2" />
        <rect x="88" y="42" width="64" height="108" rx="4" fill="#060b13" stroke="#00d4ff" strokeOpacity="0.35" />
        <circle cx="120" cy="158" r="5" fill="#39ff14" opacity="0.85" />
        {/* Karte — zur Seite schwebend */}
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0; 14 0; 0 0; -6 0; 0 0"
            dur="2.8s"
            repeatCount="indefinite"
          />
          <rect x="12" y="76" width="52" height="34" rx="5" fill="url(#ttp-card)" stroke="#94a3b8" strokeWidth="1" />
          <rect x="18" y="88" width="22" height="14" rx="2" fill="#cbd5e1" opacity="0.5" />
          <line x1="18" y1="98" x2="56" y2="98" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
