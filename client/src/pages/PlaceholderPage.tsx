import { RtShell } from "../components/RtShell";

type Props = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: Props) {
  return (
    <RtShell title={title}>
      <div className="max-w-2xl rt-panel rt-panel-amber">
        <p className="text-zinc-300 leading-relaxed">{description}</p>
        <p className="mt-4 text-sm text-zinc-500">Dieser Bereich kann später mit Lagerverwaltung, Auswertung oder Systemeinstellungen befüllt werden.</p>
      </div>
    </RtShell>
  );
}
