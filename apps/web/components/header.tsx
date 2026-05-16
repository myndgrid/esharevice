import Link from "next/link";
import { Avatar, Button } from "@esharevice/ui";
import { auth } from "../lib/auth";
import { ThemeToggle } from "./theme-toggle";

export async function Header(): Promise<React.ReactElement> {
  const session = await auth();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-fg hover:text-accent transition-colors"
        >
          e-Sharevice
        </Link>

        <nav className="flex items-center gap-3">
          <ThemeToggle />
          {session ? (
            <>
              <Link href="/items/new">
                <Button variant="primary" size="md">+ New</Button>
              </Link>
              <Link href="/profile" aria-label="Open profile">
                <Avatar size="sm" name="You" />
              </Link>
            </>
          ) : (
            <>
              <Link href="/api/auth/login?return_to=/&signup=1" prefetch={false}>
                <Button variant="secondary" size="md">Sign up</Button>
              </Link>
              <Link href="/api/auth/login?return_to=/" prefetch={false}>
                <Button variant="primary" size="md">Sign in</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
