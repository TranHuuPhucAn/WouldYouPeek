import { requirePageAccount } from "@/app/protected-page";
import { AccountPanel } from "@/components/account/AccountPanel";
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>;
}) {
  const viewer = await requirePageAccount("/account");
  const query = await searchParams;
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">THE PERSON BEHIND THE CALL</span>
        <h1>Your account.</h1>
        {query.password === "updated" && (
          <p role="status">Your password has been updated.</p>
        )}
      </div>
      <AccountPanel key={viewer.id} viewer={viewer} />
    </main>
  );
}
