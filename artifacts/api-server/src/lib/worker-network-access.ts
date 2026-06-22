import type { Request, Response } from "express";
import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  db,
  workerAffiliateNetworksTable,
  affiliateNetworksTable,
} from "@workspace/db";
import { checkWorkspaceAccess } from "./workspace-access";
import { getEmployeeFromToken } from "../routes/auth";

export type WorkerNetworkScope = {
  isAdmin: boolean;
  employeeId: number;
  role: string;
  /** null = unrestricted (admin) */
  allowedNetworkIds: number[] | null;
  allowedNetworkNames: string[] | null;
};

export type AssignedNetworks = {
  ids: number[];
  names: string[];
};

export async function loadAssignedNetworksForEmployee(
  workspaceId: number,
  employeeId: number,
): Promise<AssignedNetworks> {
  const rows = await db
    .select({
      id: workerAffiliateNetworksTable.affiliateNetworkId,
      name: affiliateNetworksTable.name,
    })
    .from(workerAffiliateNetworksTable)
    .innerJoin(
      affiliateNetworksTable,
      eq(workerAffiliateNetworksTable.affiliateNetworkId, affiliateNetworksTable.id),
    )
    .where(
      and(
        eq(workerAffiliateNetworksTable.workspaceId, workspaceId),
        eq(workerAffiliateNetworksTable.employeeId, employeeId),
      ),
    );

  return {
    ids: rows.map((r) => r.id),
    names: rows.map((r) => r.name).filter((n): n is string => Boolean(n?.trim())),
  };
}

export async function resolveWorkerNetworkScope(
  req: Request,
  workspaceId: number,
): Promise<WorkerNetworkScope | null> {
  const employee = await getEmployeeFromToken(req);
  if (!employee) return null;

  if (employee.role === "admin") {
    return {
      isAdmin: true,
      employeeId: employee.id,
      role: employee.role,
      allowedNetworkIds: null,
      allowedNetworkNames: null,
    };
  }

  const assigned = await loadAssignedNetworksForEmployee(workspaceId, employee.id);
  return {
    isAdmin: false,
    employeeId: employee.id,
    role: employee.role,
    allowedNetworkIds: assigned.ids,
    allowedNetworkNames: assigned.names,
  };
}

/**
 * Validate workspace access and resolve worker network scope in one step.
 */
export async function requireWorkspaceWithNetworkScope(
  req: Request,
  res: Response,
  workspaceId: number,
): Promise<{ scope: WorkerNetworkScope } | null> {
  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return null;
  }

  if (access.employee.role === "admin") {
    return {
      scope: {
        isAdmin: true,
        employeeId: access.employee.id,
        role: access.employee.role,
        allowedNetworkIds: null,
        allowedNetworkNames: null,
      },
    };
  }

  const assigned = await loadAssignedNetworksForEmployee(workspaceId, access.employee.id);
  return {
    scope: {
      isAdmin: false,
      employeeId: access.employee.id,
      role: access.employee.role,
      allowedNetworkIds: assigned.ids,
      allowedNetworkNames: assigned.names,
    },
  };
}

/** Workers may only request their own employee_id; admins may request any. */
export function enforceEmployeeIdAccess(
  res: Response,
  scope: WorkerNetworkScope,
  requestedEmployeeId: number | null | undefined,
): boolean {
  if (requestedEmployeeId == null) return true;
  if (scope.isAdmin) return true;
  if (requestedEmployeeId !== scope.employeeId) {
    res.status(403).json({ error: "Access denied: cannot view another employee's data" });
    return false;
  }
  return true;
}

export function networkNameAllowed(
  scope: WorkerNetworkScope,
  networkName: string | null | undefined,
): boolean {
  if (scope.isAdmin || scope.allowedNetworkNames === null) return true;
  if (!networkName?.trim()) return false;
  const norm = networkName.trim().toLowerCase();
  return scope.allowedNetworkNames.some((n) => n.toLowerCase() === norm);
}

export function networkIdAllowed(
  scope: WorkerNetworkScope,
  networkId: number | null | undefined,
): boolean {
  if (scope.isAdmin || scope.allowedNetworkIds === null) return true;
  if (networkId == null) return false;
  return scope.allowedNetworkIds.includes(networkId);
}

/** SQL filter on testing_batches.affiliate_network for worker scope. */
export function affiliateNetworkNameSqlFilter(
  column: AnyColumn,
  scope: WorkerNetworkScope,
): SQL | undefined {
  if (scope.isAdmin || scope.allowedNetworkNames === null) return undefined;
  if (scope.allowedNetworkNames.length === 0) return sql`1 = 0`;
  return inArray(column, scope.allowedNetworkNames);
}

export function breakdownScopeFromWorker(scope: WorkerNetworkScope): {
  employeeId?: number;
  allowedNetworkNames?: string[];
} | undefined {
  if (scope.isAdmin) return undefined;
  return {
    employeeId: scope.employeeId,
    allowedNetworkNames: scope.allowedNetworkNames ?? [],
  };
}
