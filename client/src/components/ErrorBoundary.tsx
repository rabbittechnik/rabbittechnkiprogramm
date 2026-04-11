import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060b13] px-6">
        <div className="max-w-md w-full text-center space-y-5">
          <svg className="mx-auto w-16 h-16" viewBox="0 0 48 48" fill="none">
            <ellipse cx="24" cy="28" rx="14" ry="12" fill="white" />
            <ellipse cx="16" cy="14" rx="5" ry="12" fill="white" />
            <ellipse cx="32" cy="14" rx="5" ry="12" fill="white" />
            <circle cx="19" cy="26" r="2.5" fill="#060b13" />
            <circle cx="29" cy="26" r="2.5" fill="#060b13" />
          </svg>
          <h1 className="text-xl font-bold text-red-400">Etwas ist schiefgelaufen</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Die App hat einen unerwarteten Fehler erkannt. Das tut uns leid. Du kannst die Seite neu laden oder zum
            Dashboard zurückkehren.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[52px] px-6 rounded-xl font-semibold bg-[#00d4ff] text-[#060b13] active:scale-[0.97]"
            >
              Seite neu laden
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.href = "/";
              }}
              className="min-h-[52px] px-6 rounded-xl font-semibold border border-zinc-600 text-zinc-300 active:scale-[0.97]"
            >
              Zum Dashboard
            </button>
          </div>
          <details className="text-left">
            <summary className="text-xs text-zinc-600 cursor-pointer">Technische Details</summary>
            <pre className="mt-2 text-[11px] text-zinc-500 bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
