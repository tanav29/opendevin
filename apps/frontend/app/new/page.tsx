"use client";

import { useEffect } from "react";
import { Home } from "@/app/page";
import { useSessionSelection } from "@/components/providers";

/** The intentional starting point for a new workspace. */
export default function NewPage() {
  const { selectSession } = useSessionSelection();

  useEffect(() => {
    selectSession(null);
  }, [selectSession]);

  return <Home />;
}
