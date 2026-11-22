import {Component, type ErrorInfo, type ReactNode} from 'react';

type Props = {children: ReactNode};
type State = {error: Error | null};

/**
 * Catches render-time crashes so the app shows a readable message
 * instead of a blank white page.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ARCHIFORMA crashed:', error, info.componentStack);
  }

  private resetAndReload = () => {
    try {
      // Corrupt saved state is the most common cause of a crash on load.
      Object.keys(localStorage)
        .filter((k) => k.toLowerCase().includes('archiforma'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage may be unavailable */
    }
    location.reload();
  };

  render() {
    const {error} = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 p-6 font-sans">
        <div className="max-w-lg w-full bg-white border border-stone-200 rounded-xl shadow-sm p-6">
          <h1 className="text-lg font-semibold text-stone-900">ARCHIFORMA hit an error</h1>
          <p className="mt-2 text-sm text-stone-600">
            Something went wrong while loading the app. Reloading usually fixes it. If it keeps
            happening, reset the saved local data.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded bg-stone-100 p-3 text-xs text-red-700 whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => location.reload()}
              className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
            >
              Reload
            </button>
            <button
              onClick={this.resetAndReload}
              className="px-4 py-2 rounded-md border border-stone-300 text-stone-700 text-sm hover:bg-stone-100"
            >
              Reset local data &amp; reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
