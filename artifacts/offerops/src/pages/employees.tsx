import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Employee } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, Pencil, UserCheck, UserX } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { authedJson } from "@/lib/api-fetch";

type ManagedEmployee = Employee & {
  workspaceIds?: number[];
  workspaceNames?: string[];
  affiliateNetworkIds?: number[];
  affiliateNetworkNames?: string[];
  initialPassword?: string;
};

type WorkspaceOption = { id: number; name: string };
type AffiliateNetworkOption = { id: number; workspaceId: number; name: string; isActive: boolean };
type StatusFilter = "active" | "inactive" | "all";
type FormState = {
  id?: number;
  name: string;
  email: string;
  password: string;
  role: "admin" | "employee";
  workspaceIds: number[];
  affiliateNetworkIds: number[];
};

const emptyForm: FormState = {
  name: "",
  email: "",
  password: "",
  role: "employee",
  workspaceIds: [],
  affiliateNetworkIds: [],
};

const statusFilters: StatusFilter[] = ["active", "inactive", "all"];

export default function Employees() {
  const { currentEmployee } = useAuth();
  const isAdmin = currentEmployee?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const employeesQueryKey = ["team-employees", statusFilter];
  const { data: employees = [], isLoading } = useQuery<ManagedEmployee[]>({
    queryKey: employeesQueryKey,
    enabled: isAdmin,
    queryFn: () => authedJson(`/api/employees?status=${statusFilter}`),
  });
  const { data: workspaces = [] } = useQuery<WorkspaceOption[]>({
    queryKey: ["team-workspaces"],
    enabled: isAdmin,
    queryFn: () => authedJson("/api/auth/my-workspaces"),
  });
  const { data: affiliateNetworks = [] } = useQuery<AffiliateNetworkOption[]>({
    queryKey: ["team-affiliate-networks", workspaces.map((workspace) => workspace.id).join(",")],
    enabled: isAdmin && workspaces.length > 0,
    queryFn: async () => {
      const nested = await Promise.all(
        workspaces.map((workspace) =>
          authedJson<AffiliateNetworkOption[]>(`/api/affiliate-networks?workspace_id=${workspace.id}`),
        ),
      );
      return nested.flat().filter((network) => network.isActive !== false);
    },
  });

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  const affiliateNetworkNameById = useMemo(
    () => new Map(affiliateNetworks.map((network) => [network.id, network.name])),
    [affiliateNetworks],
  );

  function upsertEmployeeInCache(employee: ManagedEmployee) {
    statusFilters.forEach((filter) => {
      queryClient.setQueryData<ManagedEmployee[]>(["team-employees", filter], (current) => {
        if (!current) return current;

        const withoutEmployee = current.filter((cached) => cached.id !== employee.id);
        const belongsInFilter = filter === "all" || employee.status === filter;
        if (!belongsInFilter) return withoutEmployee;

        const existingIndex = current.findIndex((cached) => cached.id === employee.id);
        if (existingIndex === -1) return [employee, ...withoutEmployee];

        const next = [...current];
        next[existingIndex] = employee;
        return next;
      });
    });
  }

  function labelList(names: string[] | undefined, ids: number[] | undefined, lookup: Map<number, string>) {
    if (names?.length) return names.join(", ");
    const resolvedNames = ids?.map((id) => lookup.get(id)).filter(Boolean);
    return resolvedNames?.length ? resolvedNames.join(", ") : "-";
  }

  const saveMutation = useMutation({
    mutationFn: async (state: FormState) => {
      const body = {
        name: state.name.trim(),
        email: state.email.trim(),
        role: state.role,
        workspaceIds: state.workspaceIds,
        affiliateNetworkIds: state.role === "employee" ? state.affiliateNetworkIds : [],
        ...(state.password.trim() ? { password: state.password.trim() } : {}),
      };
      return state.id
        ? authedJson<ManagedEmployee>(`/api/employees/${state.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : authedJson<ManagedEmployee>("/api/employees", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: (employee) => {
      upsertEmployeeInCache(employee);
      queryClient.invalidateQueries({ queryKey: ["team-employees"] });
      setFormOpen(false);
      setForm(emptyForm);
      toast({
        title: "User saved",
        description: employee.initialPassword ? `Temporary password: ${employee.initialPassword}` : undefined,
      });
    },
    onError: (e: unknown) => toast({
      title: "Could not save user",
      description: e instanceof Error ? e.message : String(e),
      variant: "destructive",
    }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ employee, status }: { employee: ManagedEmployee; status: "active" | "inactive" }) => {
      if (status === "inactive") {
        await authedJson(`/api/employees/${employee.id}`, { method: "DELETE" });
        return { ...employee, status };
      }
      const updatedEmployee = await authedJson<ManagedEmployee>(`/api/employees/${employee.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "active",
          workspaceIds: employee.workspaceIds ?? [],
          affiliateNetworkIds: employee.role === "employee" ? employee.affiliateNetworkIds ?? [] : [],
        }),
      });
      return updatedEmployee;
    },
    onSuccess: (employee) => {
      upsertEmployeeInCache(employee);
      queryClient.invalidateQueries({ queryKey: ["team-employees"] });
      toast({ title: "User status updated" });
    },
    onError: (e: unknown) => toast({
      title: "Could not update user",
      description: e instanceof Error ? e.message : String(e),
      variant: "destructive",
    }),
  });

  const selectableAffiliateNetworks = useMemo(
    () => affiliateNetworks.filter((network) => form.workspaceIds.includes(network.workspaceId)),
    [affiliateNetworks, form.workspaceIds],
  );

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.email.toLowerCase().includes(search.toLowerCase())
  );

  function openAddForm() {
    setForm({
      ...emptyForm,
      workspaceIds: workspaces.length === 1 ? [workspaces[0]!.id] : [],
    });
    setFormOpen(true);
  }

  function openEditForm(employee: ManagedEmployee) {
    setForm({
      id: employee.id,
      name: employee.name,
      email: employee.email,
      password: "",
      role: employee.role === "admin" ? "admin" : "employee",
      workspaceIds: employee.workspaceIds ?? [],
      affiliateNetworkIds: employee.affiliateNetworkIds ?? [],
    });
    setFormOpen(true);
  }

  function toggleWorkspace(id: number) {
    setForm((current) => {
      const workspaceIds = current.workspaceIds.includes(id)
        ? current.workspaceIds.filter((workspaceId) => workspaceId !== id)
        : [...current.workspaceIds, id];
      const allowedNetworkIds = new Set(
        affiliateNetworks
          .filter((network) => workspaceIds.includes(network.workspaceId))
          .map((network) => network.id),
      );
      return {
        ...current,
        workspaceIds,
        affiliateNetworkIds: current.affiliateNetworkIds.filter((networkId) => allowedNetworkIds.has(networkId)),
      };
    });
  }

  function toggleAffiliateNetwork(id: number) {
    setForm((current) => ({
      ...current,
      affiliateNetworkIds: current.affiliateNetworkIds.includes(id)
        ? current.affiliateNetworkIds.filter((networkId) => networkId !== id)
        : [...current.affiliateNetworkIds, id],
    }));
  }

  function submitForm() {
    if (!form.name.trim() || !form.email.trim() || form.workspaceIds.length === 0) {
      toast({ title: "Name, email, and workspace are required", variant: "destructive" });
      return;
    }
    if (form.role === "employee" && form.affiliateNetworkIds.length === 0) {
      toast({ title: "Workers need at least one affiliate network", variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  }

  const tableColumnCount = isAdmin ? 7 : 6;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Team</h1>
        {isAdmin && (
          <Button onClick={openAddForm}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search users..."
            className="pl-8" 
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active users</SelectItem>
            <SelectItem value="inactive">Deactivated users</SelectItem>
            <SelectItem value="all">All users</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Workspaces</TableHead>
              <TableHead>Affiliate Networks</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={tableColumnCount} className="text-center py-8 text-muted-foreground">Loading users...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tableColumnCount} className="text-center py-8 text-muted-foreground">No users found.</TableCell>
              </TableRow>
            ) : (
              filtered.map(emp => (
                <TableRow key={emp.id} className={emp.status === "inactive" ? "bg-muted/30 opacity-70" : undefined}>
                  <TableCell className="font-medium">{emp.name}</TableCell>
                  <TableCell>{emp.email}</TableCell>
                  <TableCell>
                    <Badge variant={emp.role === "admin" ? "default" : "secondary"}>
                      {emp.role === "admin" ? "Admin" : "Worker"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {labelList(emp.workspaceNames, emp.workspaceIds, workspaceNameById)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {emp.role === "admin"
                      ? "All assigned workspaces"
                      : labelList(emp.affiliateNetworkNames, emp.affiliateNetworkIds, affiliateNetworkNameById)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={emp.status === "active" ? "outline" : "destructive"} className={emp.status === "active" ? "text-green-500 border-green-500/20" : ""}>
                      {emp.status === "active" ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right space-x-1">
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEditForm(emp)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                        {emp.status === "active" ? (
                          <Button variant="ghost" size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ employee: emp, status: "inactive" })}>
                            <UserX className="h-3.5 w-3.5 mr-1" />
                            Deactivate
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ employee: emp, status: "active" })}>
                            <UserCheck className="h-3.5 w-3.5 mr-1" />
                            Reactivate
                          </Button>
                        )}
                      </>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={formOpen} onOpenChange={(open) => {
        setFormOpen(open);
        if (!open) setForm(emptyForm);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Name *</Label>
                <Input className="mt-1" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Email *</Label>
                <Input className="mt-1" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Role *</Label>
                <Select value={form.role} onValueChange={(value) => setForm((current) => ({
                  ...current,
                  role: value as "admin" | "employee",
                  affiliateNetworkIds: value === "admin" ? [] : current.affiliateNetworkIds,
                }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="employee">Worker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Temporary password</Label>
                <Input
                  className="mt-1"
                  type="password"
                  placeholder={form.id ? "Leave blank to keep current password" : "Auto-generate if blank"}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Assigned workspace(s) *</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {workspaces.map((workspace) => (
                  <label key={workspace.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Checkbox checked={form.workspaceIds.includes(workspace.id)} onCheckedChange={() => toggleWorkspace(workspace.id)} />
                    <span>{workspace.name}</span>
                  </label>
                ))}
              </div>
              {workspaces.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">No workspaces are assigned to your admin account.</p>
              )}
            </div>

            {form.role === "employee" && (
              <div>
                <Label className="text-xs">Assigned affiliate network(s) *</Label>
                <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                  {selectableAffiliateNetworks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Select a workspace with active affiliate networks.</p>
                  ) : (
                    selectableAffiliateNetworks.map((network) => {
                      const workspaceName = workspaces.find((workspace) => workspace.id === network.workspaceId)?.name;
                      return (
                        <label key={network.id} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={form.affiliateNetworkIds.includes(network.id)} onCheckedChange={() => toggleAffiliateNetwork(network.id)} />
                          <span>{network.name}{workspaceName ? ` · ${workspaceName}` : ""}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button onClick={submitForm} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
