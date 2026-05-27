import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import crypto from "crypto";
import { signAuthToken, verifyAuthToken } from "../lib/auth-tokens.ts";

const router: IRouter = Router();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "offerops_salt").digest("hex");
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.email, email));

  if (!employee || !verifyPassword(password, employee.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (employee.status === "inactive") {
    res.status(401).json({ error: "Account is inactive" });
    return;
  }

  let token: string;
  try {
    token = signAuthToken(employee.id);
  } catch (err) {
    req.log.error({ err }, "Failed to sign auth token");
    res.status(500).json({ error: "Authentication is not configured" });
    return;
  }

  const { passwordHash: _, ...employeeData } = employee;

  res.json({
    employee: {
      ...employeeData,
      createdAt: employeeData.createdAt.toISOString(),
    },
    token,
  });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ success: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  const employeeId = verifyAuthToken(token);
  if (employeeId === null) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));

  if (!employee) {
    res.status(401).json({ error: "Employee not found" });
    return;
  }
  if (employee.status === "inactive") {
    res.status(401).json({ error: "Account is inactive" });
    return;
  }

  const { passwordHash: _, ...employeeData } = employee;

  res.json({
    ...employeeData,
    createdAt: employeeData.createdAt.toISOString(),
  });
});

export { hashPassword };

export async function getEmployeeFromToken(req: import("express").Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const employeeId = verifyAuthToken(token);
  if (employeeId === null) return null;

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));

  if (!employee || employee.status === "inactive") return null;
  return employee;
}

export default router;
