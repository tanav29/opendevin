import { api, convex } from "./convex";

type Session = {
  _id: string;
  _creationTime: number;
  createdAt: number;
  updatedAt: number;
  parts: string;
  [key: string]: unknown;
};
type SessionData = Record<string, unknown>;

type FindArgs = {
  where: { id: string };
  select?: { parts?: boolean };
};

const toDate = (value: unknown) =>
  typeof value === "number" ? new Date(value) : value;

function normalize(session: Session | null) {
  if (!session) return null;
  const { _id, _creationTime, ...data } = session;
  return { ...data, id: _id };
}

function defined<T extends SessionData>(data: T) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

export const db = {
  sessions: {
    async findUnique({ where, select }: FindArgs): Promise<any> {
      const session = normalize(
        (await convex.query(api.sessions.get, { id: where.id as never })) as unknown as Session | null,
      );
      if (!session) return null;
      if (select?.parts) return { parts: session.parts };
      return {
        ...session,
        createdAt: toDate(session.createdAt),
        updatedAt: toDate(session.updatedAt),
      };
    },

    async findMany(): Promise<any[]> {
      const sessions = await convex.query(api.sessions.list, {});
      return sessions.map((value) => {
        const session = normalize(value as unknown as Session);
        return session
          ? {
              ...session,
              createdAt: toDate(session.createdAt),
              updatedAt: toDate(session.updatedAt),
            }
          : null;
      });
    },

    async create({ data }: { data: SessionData }): Promise<any> {
      return normalize(
        (await convex.mutation(api.sessions.create, data as never)) as unknown as Session,
      );
    },

    async update({ where, data }: { where: { id: string }; data: SessionData }): Promise<any> {
      return normalize(
        (await convex.mutation(api.sessions.update, {
          id: where.id as never,
          ...defined(data),
        } as never)) as unknown as Session,
      );
    },

    async delete({ where }: { where: { id: string } }): Promise<void> {
      await convex.mutation(api.sessions.remove, { id: where.id as never });
    },
  },
};
