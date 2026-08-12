import { api, convex } from "./convex";

const date = (value: number | undefined) => value === undefined ? undefined : new Date(value);
const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v instanceof Date ? v.getTime() : v]));
const session = (s: any) => s && ({ ...s, id: s._id, createdAt: date(s.createdAt), updatedAt: date(s.updatedAt), _id: undefined, _creationTime: undefined });
const run = (r: any) => r && ({ ...r, id: r._id, sessionId: String(r.sessionId), planJson: r.planJson ?? "{}", createdAt: date(r.createdAt), updatedAt: date(r.updatedAt), startedAt: date(r.startedAt), finishedAt: date(r.finishedAt), cancelledAt: date(r.cancelledAt), _id: undefined, _creationTime: undefined });
const event = (e: any) => e && ({ ...e, id: e._id, runId: String(e.runId), createdAt: date(e.createdAt), _id: undefined, _creationTime: undefined });

export const db: any = {
  sessions: {
    findUnique: async ({ where, select }: any) => { const s = session(await convex.query(api.sessions.get, { id: where.id })); return select?.parts ? (s && { parts: s.parts }) : s; },
    findMany: async () => (await convex.query(api.sessions.list, {})).map(session),
    create: async ({ data }: any) => session(await convex.mutation(api.sessions.create, data)),
    update: async ({ where, data }: any) => session(await convex.mutation(api.sessions.update, { id: where.id, ...clean(data) })),
  },
  agentRun: {
    findUnique: async ({ where, include }: any) => { const r = run(await convex.query(api.runs.get, { id: where.id })); if (!r) return null; if (include?.session) r.session = session(await convex.query(api.sessions.get, { id: r.sessionId })); if (include?.artifacts) r.artifacts = (await convex.query(api.artifacts.list, { runId: r.id })).map((a: any) => ({ ...a, id: a._id, createdAt: date(a.createdAt) })); return r; },
    findFirst: async ({ where }: any) => { const rows = (await convex.query(api.runs.list, { sessionId: where.sessionId })).map(run); return rows.find((r: any) => where.status?.in?.includes(r.status)) ?? null; },
    findMany: async ({ where }: any) => (await convex.query(api.runs.list, { sessionId: where.sessionId })).map(run),
    create: async ({ data }: any) => run(await convex.mutation(api.runs.create, { ...data, planJson: data.planJson ?? "{}" })),
    update: async ({ where, data }: any) => run(await convex.mutation(api.runs.update, { id: where.id, ...clean(data) })),
  },
  runEvent: {
    aggregate: async ({ where }: any) => { const events = await convex.query(api.events.list, { runId: where.runId }); return { _max: { sequence: events.length ? Math.max(...events.map((e: any) => e.sequence)) : null } }; },
    create: async ({ data }: any) => event(await convex.mutation(api.events.append, { runId: data.runId, type: data.type, message: data.message, status: data.status, payloadJson: data.payloadJson })),
    findMany: async ({ where }: any) => (await convex.query(api.events.list, { runId: where.runId })).filter((e: any) => e.sequence > (where.sequence?.gt ?? 0)).map(event),
  },
  runArtifact: {
    createMany: async ({ data }: any) => convex.mutation(api.artifacts.createMany, { artifacts: data }),
    findFirst: async ({ where }: any) => { const rows = await convex.query(api.artifacts.list, { runId: where.runId }); const a = rows.find((x: any) => x.kind === where.kind); return a && { ...a, id: a._id, createdAt: date(a.createdAt) }; },
  },
};
