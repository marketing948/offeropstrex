// Pivot Phase 0 — Tracker Campaigns page is gated.
//
// "Tracker campaigns" are Voluum-side artifacts. With Voluum disabled
// (ENABLE_VOLUUM=false), this page renders a static "disabled" notice
// instead of the Voluum-driven import view. Phase 5 will quarantine the
// real implementation; until then, kept here as a single-screen stub so
// any deep link or stale bookmark lands gracefully.

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Radio, ArrowRight } from "lucide-react";

export default function TrackerCampaigns() {
  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <Card className="border border-border shadow-sm">
        <CardContent className="py-10 px-8 flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Radio size={22} className="text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Tracker Campaigns are paused</h1>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-md">
              OfferOps is running in manual-first mode. The Voluum tracker
              integration is temporarily disabled while the new Campaign
              Operations workflow rolls out.
            </p>
          </div>
          <div className="flex gap-2 mt-2">
            <Link href="/ops">
              <Button size="sm" className="gap-1.5">
                Go to Operations Hub <ArrowRight size={14} />
              </Button>
            </Link>
            <Link href="/testing-batches">
              <Button size="sm" variant="outline">View Batches</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
