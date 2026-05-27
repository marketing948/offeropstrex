import React from "react";
import { reportClientError } from "@/lib/error-reporter";

type AppErrorBoundaryState = {
  hasError: boolean;
  requestId: string | null;
};

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false, requestId: null };

  static getDerivedStateFromError(_error: unknown): AppErrorBoundaryState {
    return { hasError: true, requestId: null };
  }

  componentDidCatch(error: Error): void {
    const requestId =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("last_request_id")
        : null;
    this.setState({ requestId });
    reportClientError(error, { source: "error-boundary", requestId });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The app hit an unexpected problem. Please refresh and try again.
          </p>
          {this.state.requestId ? (
            <p className="text-xs text-muted-foreground">
              Reference ID: <span className="font-mono">{this.state.requestId}</span>
            </p>
          ) : null}
        </div>
      </div>
    );
  }
}
