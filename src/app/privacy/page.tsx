import Link from "next/link";
import { getServerAppConfig } from "@/server/config";
import { getPublicPageMetadata } from "@/server/metadata";

export function generateMetadata() {
  return getPublicPageMetadata({
    title: "Privacy",
    path: "/privacy",
    description:
      "What Would You Peek? stores and which information is public or private.",
  });
}

export default function PrivacyPage() {
  const { supportEmail, releaseEnvironment } = getServerAppConfig();
  return (
    <main className="page-shell information-page">
      <div className="page-heading">
        <span className="eyebrow">YOUR INFORMATION</span>
        <h1>What the app keeps.</h1>
        <p>
          This page describes the information used by Would You Peek?’s current
          features.
        </p>
      </div>
      <section className="surface-card">
        <h2>Accounts and saved practice</h2>
        <p>
          Your account includes an email address, verification status, role and
          account identifiers. Supabase Auth handles passwords, verification and
          password recovery. Account cookies keep you signed in.
        </p>
        <p>
          Training sessions store the scenario versions you played, submitted
          choices, progress and timestamps. Your saved sessions and answers are
          available through your account; they are not displayed in the public
          Library.
        </p>
      </section>
      <section className="surface-card">
        <h2>Creator content and reports</h2>
        <p>
          Creator drafts are private to their creator. Publishing makes the
          scenario or playlist’s public preview, source attribution and creator
          display name available to visitors. Your account email is not used as
          your public creator credit. Published training content is available to
          eligible learners.
        </p>
        <p>
          Reports include the scenario version, reason, submitted text and the
          reporting account’s identifier. The project operator can review them
          and manage content visibility. Creators can see the operator’s
          visibility reason, but are not shown the reporter’s identity or
          private report text through the creator workspace.
        </p>
        <p>
          Previously saved sessions retain their original content snapshots when
          a creator changes or withdraws a publication.
        </p>
      </section>
      <section className="surface-card">
        <h2>Services your browser connects to</h2>
        <p>
          When an embedded video loads, your browser connects to YouTube, which
          processes that interaction under its own policies. Source links also
          take you to the recording provider.
        </p>
        {releaseEnvironment !== "local" ? (
          <p>
            The hosted application uses Vercel for application hosting and
            Supabase for accounts and database storage. Cloudflare Turnstile
            checks supported account forms for automated abuse. The configured
            email sender delivers verification and recovery messages. These
            services process the information needed to provide those functions,
            including connection and delivery information.
          </p>
        ) : (
          <p>
            This is a local installation. Its operator controls the configured
            database and email services. The hosted release also uses an
            authentication security check; local test accounts may use a local
            email inbox.
          </p>
        )}
        <p>
          The app does not include a learner advertising or behavioral analytics
          feature. Hosting and account services may retain operational logs.
          Application diagnostics are designed to omit passwords, tokens,
          private report text and message bodies.
        </p>
      </section>
      <section className="surface-card">
        <h2>Support and data requests</h2>
        <p>
          There is currently no self-service account deletion feature. Contact
          the operator about your account or data, and avoid sharing passwords,
          reset links or verification links.
        </p>
        {supportEmail ? (
          <p>
            Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
          </p>
        ) : (
          <p>
            No support email is configured for this local installation. Contact
            the person running it.
          </p>
        )}
        <p>
          <Link href="/help">Get help using the app →</Link>
        </p>
      </section>
    </main>
  );
}
