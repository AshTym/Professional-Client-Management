import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  activitiesTable,
  clientsTable,
  mattersTable,
  membershipsTable,
  workspacesTable,
} from "@workspace/db";
import {
  CloseMatterParams,
  CreateClientBody,
  CreateClientResponse,
  CreateMatterBody,
  CreateMatterResponse,
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  DashboardSummary,
  DeleteClientParams,
  GetClientParams,
  GetClientResponse,
  GetDashboardResponse,
  GetMatterParams,
  GetMatterResponse,
  GetWorkspaceResponse,
  ListActivityQueryParams,
  ListActivityResponse,
  ListClientsQueryParams,
  ListClientsResponse,
  ListMattersQueryParams,
  ListMattersResponse,
  UpdateClientBody,
  UpdateClientParams,
  UpdateClientResponse,
  UpdateMatterBody,
  UpdateMatterParams,
  UpdateMatterResponse,
} from "@workspace/api-zod";
import {
  firmAccess,
  identify,
  logActivity,
  membershipFor,
  workspaceContext,
} from "../lib/clientguard-auth";

const router: IRouter = Router();

router.get("/workspace", async (req, res): Promise<void> => {
  const identity = identify(req, res);
  if (!identity) return;
  const row = await membershipFor(identity.userId);
  res.json(GetWorkspaceResponse.parse(workspaceContext(identity, row)));
});

router.post("/workspace", async (req, res): Promise<void> => {
  const identity = identify(req, res);
  if (!identity) return;
  if (!identity.secondFactor) {
    res.status(403).json({
      error: "Set up and verify a second factor before creating a firm.",
      code: "second_factor_required",
      action: "Complete multi-factor authentication in account security settings.",
    });
    return;
  }

  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let created = false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identity.userId}))`);
    const [existing] = await tx
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, identity.userId))
      .limit(1);
    if (existing) return;

    const [workspace] = await tx
      .insert(workspacesTable)
      .values(parsed.data)
      .returning();
    await tx.insert(membershipsTable).values({
      workspaceId: workspace.id,
      clerkUserId: identity.userId,
      email: identity.email,
      displayName: identity.name || "Firm owner",
      role: "owner",
    });
    await tx.insert(activitiesTable).values({
      workspaceId: workspace.id,
      clerkUserId: identity.userId,
      actor: identity.name || identity.email || "Firm owner",
      action: "created the firm workspace",
      entityType: "workspace",
      entityId: workspace.id,
      entityLabel: workspace.name,
    });
    created = true;
  });

  const row = await membershipFor(identity.userId);
  const response = CreateWorkspaceResponse.parse(workspaceContext(identity, row));
  res.status(created ? 201 : 200).json(response);
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;

  const [clientCount] = await db
    .select({ value: count() })
    .from(clientsTable)
    .where(eq(clientsTable.workspaceId, access.workspaceId));
  const [activeClientCount] = await db
    .select({ value: count() })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.workspaceId, access.workspaceId),
        eq(clientsTable.status, "active"),
      ),
    );
  const [openMatterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(
      and(
        eq(mattersTable.workspaceId, access.workspaceId),
        eq(mattersTable.status, "open"),
      ),
    );
  const [overdueMatterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(
      and(
        eq(mattersTable.workspaceId, access.workspaceId),
        eq(mattersTable.status, "open"),
        lt(mattersTable.dueAt, new Date()),
      ),
    );
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.workspaceId, access.workspaceId))
    .orderBy(desc(activitiesTable.occurredAt))
    .limit(6);

  res.json(
    GetDashboardResponse.parse({
      clientCount: clientCount.value,
      activeClientCount: activeClientCount.value,
      openMatterCount: openMatterCount.value,
      overdueMatterCount: overdueMatterCount.value,
      recentActivity: activity,
    }),
  );
});

router.get("/activity", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const parsed = ListActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.workspaceId, access.workspaceId))
    .orderBy(desc(activitiesTable.occurredAt))
    .limit(parsed.data.limit);
  res.json(ListActivityResponse.parse(activity));
});

router.get("/clients", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const parsed = ListClientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [eq(clientsTable.workspaceId, access.workspaceId)];
  if (parsed.data.status) filters.push(eq(clientsTable.status, parsed.data.status));
  if (parsed.data.search?.trim()) {
    const pattern = `%${parsed.data.search.trim()}%`;
    filters.push(
      or(
        ilike(clientsTable.name, pattern),
        ilike(clientsTable.email, pattern),
        ilike(clientsTable.industry, pattern),
      )!,
    );
  }
  const clients = await db
    .select()
    .from(clientsTable)
    .where(and(...filters))
    .orderBy(desc(clientsTable.updatedAt));
  const [matterRows, activityRows] = await Promise.all([
    db
      .select({ clientId: mattersTable.clientId, value: count() })
      .from(mattersTable)
      .where(eq(mattersTable.workspaceId, access.workspaceId))
      .groupBy(mattersTable.clientId),
    db
      .select({
        clientId: activitiesTable.entityId,
        lastActivityAt: max(activitiesTable.occurredAt),
      })
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.workspaceId, access.workspaceId),
          eq(activitiesTable.entityType, "client"),
        ),
      )
      .groupBy(activitiesTable.entityId),
  ]);
  const matterCountByClient = new Map(matterRows.map((row) => [row.clientId, row.value]));
  const activityByClient = new Map(
    activityRows.map((row) => [row.clientId, row.lastActivityAt]),
  );
  res.json(
    ListClientsResponse.parse(
      clients.map((client) => ({
        ...client,
        matterCount: matterCountByClient.get(client.id) ?? 0,
        lastActivityAt: activityByClient.get(client.id) ?? null,
      })),
    ),
  );
});

router.post("/clients", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [client] = await db
    .insert(clientsTable)
    .values({
      ...parsed.data,
      workspaceId: access.workspaceId,
      owner: access.name || access.email || "Firm user",
    })
    .returning();
  await logActivity(access, "client", client.id, client.name, "created client");
  res.status(201).json(
    CreateClientResponse.parse({
      ...client,
      matterCount: 0,
      lastActivityAt: null,
    }),
  );
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, params.data.id),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!client) {
    res.status(404).json({ error: "Client not found." });
    return;
  }
  const [matterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(eq(mattersTable.clientId, client.id));
  const [lastActivity] = await db
    .select({ value: max(activitiesTable.occurredAt) })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.workspaceId, access.workspaceId),
        eq(activitiesTable.entityType, "client"),
        eq(activitiesTable.entityId, client.id),
      ),
    );
  res.json(
    GetClientResponse.parse({
      ...client,
      matterCount: matterCount.value,
      lastActivityAt: lastActivity.value,
    }),
  );
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = UpdateClientParams.safeParse(req.params);
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [client] = await db
    .update(clientsTable)
    .set(parsed.data)
    .where(
      and(
        eq(clientsTable.id, params.data.id),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found." });
    return;
  }
  await logActivity(access, "client", client.id, client.name, "updated client");
  const [matterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(eq(mattersTable.clientId, client.id));
  const [lastActivity] = await db
    .select({ value: max(activitiesTable.occurredAt) })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.workspaceId, access.workspaceId),
        eq(activitiesTable.entityType, "client"),
        eq(activitiesTable.entityId, client.id),
      ),
    );
  res.json(
    UpdateClientResponse.parse({
      ...client,
      matterCount: matterCount.value,
      lastActivityAt: lastActivity.value,
    }),
  );
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db
    .update(clientsTable)
    .set({ status: "archived" })
    .where(
      and(
        eq(clientsTable.id, params.data.id),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found." });
    return;
  }
  await logActivity(access, "client", client.id, client.name, "archived client");
  res.sendStatus(204);
});

router.get("/matters", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const parsed = ListMattersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [eq(mattersTable.workspaceId, access.workspaceId)];
  if (parsed.data.status) filters.push(eq(mattersTable.status, parsed.data.status));
  const rows = await db
    .select({ matter: mattersTable, clientName: clientsTable.name })
    .from(mattersTable)
    .innerJoin(
      clientsTable,
      and(
        eq(mattersTable.clientId, clientsTable.id),
        eq(mattersTable.workspaceId, clientsTable.workspaceId),
      ),
    )
    .where(
      and(
        ...filters,
        parsed.data.search?.trim()
          ? or(
              ilike(mattersTable.title, `%${parsed.data.search.trim()}%`),
              ilike(mattersTable.reference, `%${parsed.data.search.trim()}%`),
              ilike(clientsTable.name, `%${parsed.data.search.trim()}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(mattersTable.updatedAt));
  res.json(
    ListMattersResponse.parse(
      rows.map(({ matter, clientName }) => ({
        ...matter,
        clientName,
      })),
    ),
  );
});

router.post("/matters", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = CreateMatterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [client] = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, parsed.data.clientId),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!client) {
    res.status(404).json({ error: "Client not found in this firm." });
    return;
  }
  const reference = `MAT-${new Date().getFullYear()}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
  const [matter] = await db
    .insert(mattersTable)
    .values({
      ...parsed.data,
      workspaceId: access.workspaceId,
      reference,
      dueAt: parsed.data.dueAt ?? null,
    })
    .returning();
  await logActivity(access, "matter", matter.id, matter.title, "created matter");
  res.status(201).json(CreateMatterResponse.parse({ ...matter, clientName: client.name }));
});

router.get("/matters/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const params = GetMatterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({ matter: mattersTable, clientName: clientsTable.name })
    .from(mattersTable)
    .innerJoin(
      clientsTable,
      and(
        eq(mattersTable.clientId, clientsTable.id),
        eq(mattersTable.workspaceId, clientsTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(mattersTable.id, params.data.id),
        eq(mattersTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  res.json(GetMatterResponse.parse({ ...row.matter, clientName: row.clientName }));
});

router.patch("/matters/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = UpdateMatterParams.safeParse(req.params);
  const parsed = UpdateMatterBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.clientId) {
    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(
        and(
          eq(clientsTable.id, parsed.data.clientId),
          eq(clientsTable.workspaceId, access.workspaceId),
        ),
      )
      .limit(1);
    if (!client) {
      res.status(404).json({ error: "Client not found in this firm." });
      return;
    }
  }
  const [matter] = await db
    .update(mattersTable)
    .set({
      ...parsed.data,
      dueAt: parsed.data.dueAt === undefined ? undefined : parsed.data.dueAt,
    })
    .where(
      and(
        eq(mattersTable.id, params.data.id),
        eq(mattersTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, matter.clientId),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  await logActivity(access, "matter", matter.id, matter.title, "updated matter");
  res.json(
    UpdateMatterResponse.parse({
      ...matter,
      clientName: client?.name ?? "Unknown client",
    }),
  );
});

router.delete("/matters/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = CloseMatterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [matter] = await db
    .update(mattersTable)
    .set({ status: "closed" })
    .where(
      and(
        eq(mattersTable.id, params.data.id),
        eq(mattersTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  await logActivity(access, "matter", matter.id, matter.title, "closed matter");
  res.sendStatus(204);
});

export default router;
