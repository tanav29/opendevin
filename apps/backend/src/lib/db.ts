import { api, convex } from "./convex";

const date = (value: number | undefined) => value === undefined ? undefined : new Date(value);
const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v instanceof Date ? v.getTime() : v]));
const session = (s: any) => s && ({ ...s, id: s._id, createdAt: date(s.createdAt), updatedAt: date(s.updatedAt), _id: undefined, _creationTime: undefined });

export const db: any = {
  sessions: {
    findUnique: async ({ where, select }: any) => { const s = session(await convex.query(api.sessions.get, { id: where.id })); return select?.parts ? (s && { parts: s.parts }) : s; },
    findMany: async () => (await convex.query(api.sessions.list, {})).map(session),
    create: async ({ data }: any) => session(await convex.mutation(api.sessions.create, data)),
    update: async ({ where, data }: any) => session(await convex.mutation(api.sessions.update, { id: where.id, ...clean(data) })),
  },
};