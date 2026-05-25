import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center">
      <Card className="mx-4 w-full max-w-md border border-border shadow-sm">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-2">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-xl font-bold tracking-tight">Page not found</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            This link may be outdated or mistyped. Head back to the Operations Hub to continue.
          </p>
          <Link href="/ops" className="mt-4 inline-block">
            <Button type="button" size="sm" className="gap-1.5">
              Operations Hub
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
