import React from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { LocaleContext } from '../lib/i18n/localeContext';


interface PanelBoundaryProps {
  readonly name: string;
  readonly label?: string | undefined;
  readonly resetKey?: string | undefined;
  readonly children: ReactNode;
}

type PanelBoundaryState = { readonly failure: undefined } | { readonly failure: { readonly message: string; readonly resetKey: string | undefined } };

export default class PanelBoundary extends React.Component<PanelBoundaryProps, PanelBoundaryState> {
  override state: PanelBoundaryState = { failure: undefined };

  static getDerivedStateFromError(error: unknown): Partial<PanelBoundaryState> {
    return { failure: { message: error instanceof Error ? error.message : String(error), resetKey: undefined } };
  }

  // eslint-disable-next-line stacki/no-null -- React's getDerivedStateFromProps answers null for "no change".
  static getDerivedStateFromProps(props: PanelBoundaryProps, state: PanelBoundaryState): PanelBoundaryState | null {
    if (state.failure === undefined) {
      // eslint-disable-next-line stacki/no-null -- see above.
      return null;
    }
    if (state.failure.resetKey === undefined) {
      return { failure: { ...state.failure, resetKey: props.resetKey ?? '' } };
    }
    if (state.failure.resetKey !== (props.resetKey ?? '')) {
      return { failure: undefined };
    }
    // eslint-disable-next-line stacki/no-null -- see above.
    return null;
  }

  static override contextType = LocaleContext;
  declare context: React.ContextType<typeof LocaleContext>;

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[${this.props.name}] render error contained by its panel`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { failure } = this.state;
    if (failure === undefined) {
      return this.props.children;
    }
    return (
      <div className="panel-boundary" role="alert">
        <div className="panel-boundary-title">{this.context.translate('ui.panelBoundary.title', { name: this.props.label ?? this.props.name })}</div>
        <div className="panel-boundary-message">{failure.message}</div>
        <button type="button" className="panel-boundary-retry" onClick={() => this.setState({ failure: undefined })}>
          {this.context.translate('ui.panelBoundary.retry')}
        </button>
      </div>
    );
  }
}
