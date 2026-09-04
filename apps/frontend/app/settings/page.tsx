"use client";

import Link from "next/link";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
export default function Settings() {
  async function signOut() {
    await fetch(`${API}/api/auth/sign-out`, { method: "POST", credentials: "include" });
    window.location.href = "/";
  }
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-muted-foreground">
        ← Back
      </Link>
      <h1 className="mt-10 text-4xl font-semibold tracking-tight">Settings</h1>
      <button
        onClick={() => void signOut()}
        className="mt-8 rounded-md border border-border px-4 py-2 text-sm"
      >
        Sign out
      </button>
    </main>
  );
}
