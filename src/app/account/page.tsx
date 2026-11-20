import { requirePageAccount } from "@/app/protected-page";
import { getCreatorProfile } from "@/server/account/creator-profile/service";
import { CreatorProfileForm } from "@/components/account/CreatorProfileForm";
import { AccountPanel } from "@/components/account/AccountPanel";
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>;
}) {
  const viewer = await requirePageAccount("/account");
  const query = await searchParams;
  const profile = viewer.role === "creator" ? await getCreatorProfile() : null;
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
      {profile && (
        <CreatorProfileForm
          key={viewer.id}
          initial={profile}
          viewerId={viewer.id}
        />
      )}
    </main>
  );
}
