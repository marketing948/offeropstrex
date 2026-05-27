import { eq } from "drizzle-orm";
import { db, workspacesTable, type Workspace } from "@workspace/db";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "./secrets-encryption.ts";

export type RedactedWorkspace = Omit<Workspace, "voluumAccessKey"> & {
  hasVoluumCredentials: boolean;
  voluumCredentialStatus: "configured" | "missing";
  voluumAccessKeySuffix: string | null;
};

export function hasVoluumAccessKeyStored(stored: string | null | undefined): boolean {
  return !!(stored?.trim());
}

export function encryptVoluumAccessKeyForStorage(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const trimmed = plaintext.trim();
  if (!trimmed) return null;
  return encryptSecret(trimmed);
}

export function decryptVoluumAccessKeyFromStorage(stored: string | null | undefined): string | null {
  if (!hasVoluumAccessKeyStored(stored)) return null;
  return decryptSecret(stored!);
}

export function maskVoluumAccessKeySuffix(plaintext: string | null | undefined): string | null {
  if (!plaintext || plaintext.length < 4) return null;
  return plaintext.slice(-4);
}

export function getVoluumCredentialsFromWorkspace(
  workspace: Pick<Workspace, "voluumAccessId" | "voluumAccessKey" | "voluumApiBaseUrl" | "voluumWorkspaceId">,
): {
  accessId: string;
  accessKey: string;
  apiBaseUrl: string;
  voluumWorkspaceId: string | null;
} {
  return {
    accessId: workspace.voluumAccessId?.trim() ?? "",
    accessKey: decryptVoluumAccessKeyFromStorage(workspace.voluumAccessKey) ?? "",
    apiBaseUrl: workspace.voluumApiBaseUrl?.trim() ?? "",
    voluumWorkspaceId: workspace.voluumWorkspaceId?.trim() || null,
  };
}

export function isVoluumFullyConfigured(
  workspace: Pick<Workspace, "voluumAccessId" | "voluumAccessKey" | "voluumWorkspaceId">,
): boolean {
  return !!(
    workspace.voluumAccessId?.trim() &&
    hasVoluumAccessKeyStored(workspace.voluumAccessKey) &&
    workspace.voluumWorkspaceId?.trim()
  );
}

export function redactWorkspaceForApi(workspace: Workspace): RedactedWorkspace {
  const accessKeyPlain = decryptVoluumAccessKeyFromStorage(workspace.voluumAccessKey);
  const hasVoluumCredentials = !!(
    workspace.voluumAccessId?.trim() && hasVoluumAccessKeyStored(workspace.voluumAccessKey)
  );

  const { voluumAccessKey: _removed, ...rest } = workspace;

  return {
    ...rest,
    hasVoluumCredentials,
    voluumCredentialStatus: hasVoluumCredentials ? "configured" : "missing",
    voluumAccessKeySuffix: maskVoluumAccessKeySuffix(accessKeyPlain),
  };
}

/** Re-encrypt legacy plaintext access keys on workspace update (migrate-on-write). */
export async function migrateLegacyVoluumAccessKeyIfNeeded(
  workspaceId: number,
  stored: string | null | undefined,
): Promise<void> {
  if (!stored?.trim() || isEncryptedSecret(stored)) return;

  await db
    .update(workspacesTable)
    .set({
      voluumAccessKey: encryptSecret(stored),
      updatedAt: new Date(),
    })
    .where(eq(workspacesTable.id, workspaceId));
}
