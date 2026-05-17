import Link from "next/link";
import { Avatar, Button, Card, CardContent } from "@esharevice/ui";
import { requireAuth } from "../../lib/auth";
import { api, ApiError } from "../../lib/api";
import { signOutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage(): Promise<React.ReactElement> {
  await requireAuth("/profile");

  let displayName = "You";
  let email = "";
  try {
    const me = await api.me();
    displayName = `${me.first_name} ${me.last_name}`.trim() || me.email;
    email = me.email;
  } catch (err) {
    // 401 here would mean the access token was rejected by the API even though
    // we have a valid session cookie — unusual but recoverable by re-logging in.
    if (err instanceof ApiError && err.status === 401) {
      displayName = "(session expired)";
    } else {
      throw err;
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <Card>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar size="lg" name={displayName} />
            <div className="grid gap-1">
              <h1 className="text-xl font-semibold tracking-tight">{displayName}</h1>
              {email && <p className="text-sm text-fg-muted">{email}</p>}
            </div>
          </div>

          <hr className="my-6 border-border" />

          <div className="flex gap-2">
            <Link href="/">
              <Button variant="ghost" size="sm">Back to home</Button>
            </Link>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">Sign out</Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
