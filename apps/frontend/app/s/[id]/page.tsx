"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { Home } from "@/app/page";
import { useSessionSelection } from "@/components/providers";

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const { selectSession } = useSessionSelection();

  useEffect(() => {
    if (params.id) selectSession(params.id);
  }, [params.id, selectSession]);

  return <Home />;
}
