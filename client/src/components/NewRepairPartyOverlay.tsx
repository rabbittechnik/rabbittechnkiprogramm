/**
 * Vollflächiger „Party“-Overlay bei neuem Auftrag (pointer-events: none).
 * Dauer wird von der Eltern-Komponente gesteuert (active).
 */
export function NewRepairPartyOverlay({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-20 pointer-events-none overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute inset-0 animate-rt-party-vignette"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 20%, rgba(236,72,153,0.35), transparent 60%), radial-gradient(ellipse 50% 45% at 85% 75%, rgba(34,211,238,0.28), transparent 55%), radial-gradient(ellipse 45% 40% at 10% 80%, rgba(250,204,21,0.22), transparent 50%)",
        }}
      />
      <div
        className="absolute -inset-[40%] opacity-[0.18] animate-rt-party-spin mix-blend-screen"
        style={{
          background:
            "conic-gradient(from 0deg, transparent, rgba(255,255,255,0.5), transparent, rgba(168,85,247,0.6), transparent, rgba(34,211,238,0.5), transparent)",
          animationDuration: "6s",
        }}
      />
      <div className="absolute inset-0 opacity-30 animate-rt-party-strobe" />
      <Sparkles />
    </div>
  );
}

function Sparkles() {
  const spots = [
    { l: "6%", t: "14%", d: "0s", s: 0.7 },
    { l: "18%", t: "72%", d: "0.4s", s: 0.5 },
    { l: "88%", t: "18%", d: "0.2s", s: 0.85 },
    { l: "72%", t: "48%", d: "0.7s", s: 0.55 },
    { l: "42%", t: "22%", d: "0.1s", s: 0.65 },
    { l: "28%", t: "38%", d: "0.55s", s: 0.45 },
    { l: "58%", t: "68%", d: "0.3s", s: 0.75 },
    { l: "92%", t: "62%", d: "0.85s", s: 0.5 },
    { l: "12%", t: "52%", d: "0.15s", s: 0.6 },
    { l: "50%", t: "12%", d: "0.5s", s: 0.9 },
    { l: "38%", t: "82%", d: "0.25s", s: 0.55 },
    { l: "78%", t: "32%", d: "0.6s", s: 0.7 },
  ];
  return (
    <>
      {spots.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white shadow-[0_0_14px_3px_rgba(255,255,255,0.85)] animate-rt-party-sparkle"
          style={{
            left: p.l,
            top: p.t,
            width: `${10 * p.s}px`,
            height: `${10 * p.s}px`,
            animationDelay: p.d,
          }}
        />
      ))}
    </>
  );
}
