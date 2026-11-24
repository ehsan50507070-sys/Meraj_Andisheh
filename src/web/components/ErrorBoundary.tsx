import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  buildSafeErrorReport,
  type SafeErrorReport,
} from '../../core/services/securityAuditService';
import { envConfig } from '../../infrastructure/config/envConfig';
import { ServerErrorPage } from '../pages/ServerErrorPage';
import { appContainer } from '../services/appContainer';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  report: SafeErrorReport | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    report: null,
  };

  public static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    const augmentedError =
      info.componentStack && error instanceof Error
        ? Object.assign(new Error(error.message), {
            stack: [error.stack, info.componentStack].filter(Boolean).join('\n'),
          })
        : error;

    const report = buildSafeErrorReport(
      augmentedError,
      envConfig.isDevelopment,
      appContainer.clock,
      appContainer.logger,
    );
    this.setState({
      hasError: true,
      report,
    });
  }

  public componentDidMount(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this.handleHashChange);
    }
  }

  public componentWillUnmount(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this.handleHashChange);
    }
  }

  private readonly handleHashChange = (): void => {
    if (this.state.hasError) {
      this.setState({
        hasError: false,
        report: null,
      });
    }
  };

  private readonly handleReset = (): void => {
    this.setState({
      hasError: false,
      report: null,
    });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ServerErrorPage
          currentRoute="#/error/500"
          report={this.state.report}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}
