"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  github: { login: string | null; avatarUrl: string | null; profileUrl: string | null };
};

export function useSession() {
  const [data, setData] = useState<Me | null>(null);
  useEffect(() => {
    let dead = false;
    fetch(`${API}/api/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!dead) setData(d as Me | null);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);
  return data;
}
