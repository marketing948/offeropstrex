import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAffiliateNetworks,
  useListGeos,
  useListWorkspaceTrafficSources,
  getListAffiliateNetworksQueryKey,
  getListGeosQueryKey,
  getListWorkspaceTrafficSourcesQueryKey,
} from "@workspace/api-client-react";
import { authedJson } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/workspace-context";
import { wsQueryOpts } from "@/lib/ws-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ProductionCampaign = {
  id: number;
  campaignName: string;
  campaignPurpose: string;
};

export type ProductionLiveCampaignFormProps = {
  workingParents: ProductionCampaign[];
  onCreated: () => void;
  onCancel: () => void;
};

export function ProductionLiveCampaignForm({
  workingParents,
  onCreated,
  onCancel,
}: ProductionLiveCampaignFormProps) {
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: trafficSources = [] } = useListWorkspaceTrafficSources(
    tsParams,
    wsQueryOpts(activeWorkspaceId, getListWorkspaceTrafficSourcesQueryKey(tsParams)),
  );
  const { data: affiliateNetworks = [] } = useListAffiliateNetworks(
    tsParams,
    wsQueryOpts(activeWorkspaceId, getListAffiliateNetworksQueryKey(tsParams)),
  );
  const { data: geos = [] } = useListGeos(
    tsParams,
    wsQueryOpts(activeWorkspaceId, getListGeosQueryKey(tsParams)),
  );

  const [campaignPurpose, setCampaignPurpose] = useState<"testing" | "working" | "scaling">("working");
  const [campaignName, setCampaignName] = useState("");
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const [trafficSourceId, setTrafficSourceId] = useState("");
  const [voluumCampaignId, setVoluumCampaignId] = useState("");
  const [campaignUrl, setCampaignUrl] = useState("");
  const [affiliateNetworkId, setAffiliateNetworkId] = useState("");
  const [geoId, setGeoId] = useState("");
  const [parentCampaignId, setParentCampaignId] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  const parentOptions = useMemo(
    () => workingParents.filter((c) => c.campaignPurpose === "working"),
    [workingParents],
  );

  const isScaling = campaignPurpose === "scaling";
  const isTestOrWorking = campaignPurpose === "working" || campaignPurpose === "testing";

  async function submit() {
    if (!activeWorkspaceId) return;
    if (!campaignName.trim() || !voluumCampaignId.trim() || !campaignUrl.trim()) {
      toast({ title: "Fill all required fields", variant: "destructive" });
      return;
    }
    if (isScaling && !parentCampaignId) {
      toast({ title: "Select a parent working campaign", variant: "destructive" });
      return;
    }
    if (!isScaling && (!trafficSourceId || !affiliateNetworkId || !geoId)) {
      toast({ title: "Network, GEO, and traffic source are required", variant: "destructive" });
      return;
    }

    setPending(true);
    try {
      const body: Record<string, unknown> = {
        workspaceId: activeWorkspaceId,
        campaignName: campaignName.trim(),
        campaignPurpose,
        voluumCampaignId: voluumCampaignId.trim(),
        campaignUrl: campaignUrl.trim(),
        notes: notes.trim() || null,
      };
      if (isScaling) {
        body.parentCampaignId = Number(parentCampaignId);
      } else {
        body.platform = platform;
        body.trafficSourceId = Number(trafficSourceId);
        body.affiliateNetworkId = Number(affiliateNetworkId);
        body.geoId = Number(geoId);
      }

      await authedJson("/api/production-live-campaigns", {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast({ title: "Manual campaign added" });
      void queryClient.invalidateQueries({ queryKey: ["live-campaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["live-campaign-filter-options"] });
      onCreated();
    } catch (e: unknown) {
      toast({
        title: "Could not create campaign",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Manual campaigns are outside CampaignOps testing batches. They start <strong>live</strong> immediately
        and do not create tasks or advance batches.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Campaign Type *</Label>
          <Select
            value={campaignPurpose}
            onValueChange={(v) => setCampaignPurpose(v as "testing" | "working" | "scaling")}
          >
            <SelectTrigger className="mt-1 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="testing">Test</SelectItem>
              <SelectItem value="working">Working (proven offers)</SelectItem>
              <SelectItem value="scaling">Scaling (derivative)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isTestOrWorking && (
          <div>
            <Label className="text-xs">OS *</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as "ios" | "android")}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ios">iOS</SelectItem>
                <SelectItem value="android">Android</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div>
        <Label className="text-xs">Campaign name *</Label>
        <Input className="mt-1 h-9" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
      </div>
      {isScaling ? (
        <div>
          <Label className="text-xs">Parent working campaign *</Label>
          <Select value={parentCampaignId} onValueChange={setParentCampaignId}>
            <SelectTrigger className="mt-1 h-9">
              <SelectValue placeholder="Select parent" />
            </SelectTrigger>
            <SelectContent>
              {parentOptions.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.campaignName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Network, GEO, traffic source, and platform are inherited from the parent working campaign.
          </p>
        </div>
      ) : (
        <>
          <div>
            <Label className="text-xs">Traffic source *</Label>
            <Select value={trafficSourceId} onValueChange={setTrafficSourceId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {trafficSources.map((ts) => (
                  <SelectItem key={ts.id} value={String(ts.id)}>
                    {ts.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Affiliate network *</Label>
              <Select value={affiliateNetworkId} onValueChange={setAffiliateNetworkId}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Select network" />
                </SelectTrigger>
                <SelectContent>
                  {affiliateNetworks.map((n) => (
                    <SelectItem key={n.id} value={String(n.id)}>
                      {n.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">GEO *</Label>
              <Select value={geoId} onValueChange={setGeoId}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Select GEO" />
                </SelectTrigger>
                <SelectContent>
                  {geos.filter((g) => g.isActive !== false).map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.code}{g.name ? ` — ${g.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </>
      )}
      <div>
        <Label className="text-xs">Voluum Campaign ID *</Label>
        <Input
          className="mt-1 h-9 font-mono text-sm"
          value={voluumCampaignId}
          onChange={(e) => setVoluumCampaignId(e.target.value)}
          placeholder="Permanent Voluum identity"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Copy from Voluum URL or settings — not tags. Used for future metrics sync.
        </p>
      </div>
      <div>
        <Label className="text-xs">Voluum Campaign URL *</Label>
        <Input
          className="mt-1 h-9"
          value={campaignUrl}
          onChange={(e) => setCampaignUrl(e.target.value)}
          placeholder="https://…"
        />
      </div>
      <div>
        <Label className="text-xs">Notes</Label>
        <Textarea className="mt-1 min-h-[4rem]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void submit()} disabled={pending}>
          {pending ? "Creating…" : "Add manual campaign"}
        </Button>
      </div>
    </div>
  );
}