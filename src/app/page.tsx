import { getPublicPageMetadata } from "@/server/metadata";
export function generateMetadata() {
  return getPublicPageMetadata({ title: "Make the call", path: "/" });
}
import { HomePageView } from "@/components/home/HomePageView";
import { getCurrentAccount } from "@/server/auth/guards";
import { getHomePageData } from "@/server/home/service";

export default async function HomePage() {
  const viewer = await getCurrentAccount();
  const data = await getHomePageData(viewer);
  return (
    <HomePageView
      data={data}
      viewer={
        viewer
          ? { role: viewer.role, emailVerified: viewer.emailVerified }
          : null
      }
    />
  );
}
