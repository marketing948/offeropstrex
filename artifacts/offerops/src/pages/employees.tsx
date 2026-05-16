import { useState } from "react";
import { useListEmployees, getListEmployeesQueryKey, Employee } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus } from "lucide-react";
import { Link } from "wouter";
import { useWorkspace } from "@/lib/workspace-context";
import { wsQueryOpts } from "@/lib/ws-query";

export default function Employees() {
  const { activeWorkspaceId } = useWorkspace();
  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: employees, isLoading } = useListEmployees(wsParams, wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)));
  const [search, setSearch] = useState("");

  const filtered = employees?.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.email.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Operators</h1>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Operator
        </Button>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search operators..." 
            className="pl-8" 
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading operators...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No operators found.</TableCell>
              </TableRow>
            ) : (
              filtered.map(emp => (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium">{emp.name}</TableCell>
                  <TableCell>{emp.email}</TableCell>
                  <TableCell>
                    <Badge variant={emp.role === "admin" ? "default" : "secondary"}>
                      {emp.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={emp.status === "active" ? "outline" : "destructive"} className={emp.status === "active" ? "text-green-500 border-green-500/20" : ""}>
                      {emp.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/employees/${emp.id}`}>
                      <Button variant="ghost" size="sm">View</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
