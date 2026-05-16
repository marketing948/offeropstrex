import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import crypto from "crypto";

const router: IRouter = Router();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "offerops_salt").digest("hex");
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

function generateToken(employeeId: number): string {
  return Buffer.from(`${employeeId}:${Date.now()}:offerops_secret`).toString("base64");
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

  const token = generateToken(employee.id);

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
  let employeeId: number;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    employeeId = parseInt(decoded.split(":")[0], 10);
    if (isNaN(employeeId)) throw new Error("Invalid token");
  } catch {
    res.status(401).json({ error: "Invalid token" });
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
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const employeeId = parseInt(decoded.split(":")[0], 10);
    if (isNaN(employeeId)) return null;
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
    return employee ?? null;
  } catch {
    return null;
  }
}

export default router;
