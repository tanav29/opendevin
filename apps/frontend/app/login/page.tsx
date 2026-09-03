"use client";

import Link from "next/link";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
async function signIn() { const response = await fetch(`${API}/api/auth/sign-in/social`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ provider: "github", callbackURL: window.location.origin }) }); const data = (await response.json()) as { url?: string }; if (data.url) window.location.href = data.url; }
export default function Login() { return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6"><Link href="/" className="font-serif text-xl">OpenDevin</Link><div className="mt-8 rounded-lg border border-border bg-card p-6"><h1 className="font-serif text-2xl">Sign in</h1><p className="mt-2 text-sm text-muted-foreground">Use GitHub to access your projects.</p><button onClick={() => void signIn()} className="mt-6 w-full rounded-md bg-foreground px-4 py-2 text-sm text-background">Continue with GitHub</button></div></main>; }
