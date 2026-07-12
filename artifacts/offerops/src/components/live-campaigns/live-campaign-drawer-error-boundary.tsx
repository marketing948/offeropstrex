/**
 * Drawer-local error boundary — a single malformed campaign must never replace
 * the whole Live Campaigns page with the app-level "Something went wrong".
 *
 * On failure it shows an inline recoverable fallback inside the drawer and keeps
 * the underlying table usable. The component stack / root error is still logged
 * through the shared safe client-error logger (no sensitive data exposed).
 */

import React from "react";
import { reportClientError } from "@/lib/error-reporter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Resets the boundary when the selected campaign changes. */
  resetKey?: string | number | null;
  children: React.ReactNode;
};

type State = { hasError: boolean; referenceId: string | null };

function makeReferenceId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `drw-${Date.now().toString(36)}-${rand}`;
}

export class LiveCampaignDrawerErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, referenceId: null };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidUpdate(prev: Props): void {
    // Reset the boundary when a different campaign is selected so a prior
    // failure doesn't stick to a healthy row.
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, referenceId: null });
    }
  }

  componentDidCatch(error: Error): void {
    const referenceId = makeReferenceId();
    this.setState({ referenceId });
    reportClientError(error, {
      source: "drawer-error-boundary",
      requestId: referenceId,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Sheet open={this.props.open} onOpenChange={(v) => !v && this.props.onClose()}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="text-left text-lg">Could not load campaign details</SheetTitle>
            <SheetDescription className="text-left">
              This campaign could not be displayed. The rest of Live Campaigns is
              still available.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {this.state.referenceId && (
              <p className="text-xs text-slate-500">
                Reference ID:{" "}
                <span className="font-mono">{this.state.referenceId}</span>
              </p>
            )}
            <Button variant="outline" onClick={this.props.onClose}>
              Close drawer
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }
}
