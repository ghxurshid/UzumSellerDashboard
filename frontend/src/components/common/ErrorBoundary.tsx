import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  readonly fallback: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  readonly error: Error | null;
}

/**
 * Render-error boundary.
 *
 * React still has no hook equivalent, so this stays a class. It catches render
 * and lifecycle throws only — async rejections surface through TanStack Query's
 * error state, which the screens render as a block instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) return this.props.fallback(error, this.reset);
    return this.props.children;
  }
}
