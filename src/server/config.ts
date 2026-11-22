import "server-only";
import { ApiError } from "./http";

const unavailable = () =>
  new ApiError(
    "STORAGE_UNAVAILABLE",
    "The application is temporarily unavailable. Please try again later.",
  );
const loopback = (host: string) =>
  ["127.0.0.1", "localhost", "[::1]"].includes(host);

function url(value: string | undefined): string {
  try {
    if (!value || value.trim() !== value || /\s/.test(value)) throw new Error();
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw new Error();
    return parsed.origin;
  } catch {
    throw unavailable();
  }
}
export function getPublicSupabaseConfig() {
  const supabaseUrl = url(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (
    !publishableKey?.trim() ||
    /\s/.test(publishableKey) ||
    publishableKey.startsWith("sb_secret_")
  )
    throw unavailable();
  // Legacy local anon JWTs are allowed; service-role JWTs must never reach this client.
  try {
    const payload = JSON.parse(
      Buffer.from(publishableKey.split(".")[1] ?? "", "base64url").toString(),
    );
    if (payload.role === "service_role") throw unavailable();
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  return { url: supabaseUrl, publishableKey };
}
export function getServerAppConfig() {
  const publicConfig = getPublicSupabaseConfig();
  const appOrigin = url(process.env.NEXT_PUBLIC_APP_URL);
  const deploymentMode = process.env.WYP_DEPLOYMENT_MODE;
  const appUrl = new URL(appOrigin),
    supabaseUrl = new URL(publicConfig.url);
  if (deploymentMode === "local") {
    if (
      !loopback(appUrl.hostname) ||
      !loopback(supabaseUrl.hostname) ||
      process.env.VERCEL_ENV ||
      process.env.WYP_RELEASE_ENVIRONMENT
    )
      throw unavailable();
    return {
      ...publicConfig,
      appOrigin,
      deploymentMode,
      releaseEnvironment: "local" as const,
      supportEmail: null,
      turnstileSiteKey: null,
    };
  }
  const releaseEnvironment = process.env.WYP_RELEASE_ENVIRONMENT;
  const projectRef = process.env.WYP_SUPABASE_PROJECT_REF;
  const supportEmail = process.env.WYP_SUPPORT_EMAIL;
  const turnstileSiteKey = process.env.WYP_TURNSTILE_SITE_KEY;
  if (
    deploymentMode !== "hosted" ||
    !["preview", "production"].includes(releaseEnvironment ?? "") ||
    appUrl.protocol !== "https:" ||
    appUrl.port ||
    loopback(appUrl.hostname) ||
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(appUrl.hostname) ||
    /(^|\.)(localhost|local|test|invalid)$/.test(appUrl.hostname) ||
    !projectRef ||
    !/^[a-z]{20}$/.test(projectRef) ||
    publicConfig.url !== `https://${projectRef}.supabase.co` ||
    !supportEmail ||
    /\s/.test(supportEmail) ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
      supportEmail,
    ) ||
    supportEmail.length > 254 ||
    !turnstileSiteKey ||
    /\s/.test(turnstileSiteKey) ||
    !/^0x[0-9A-Za-z_-]{10,100}$/.test(turnstileSiteKey) ||
    /^0x[0-9]{16,}/.test(turnstileSiteKey) ||
    (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== releaseEnvironment)
  )
    throw unavailable();
  return {
    ...publicConfig,
    appOrigin,
    deploymentMode,
    releaseEnvironment: releaseEnvironment as "preview" | "production",
    supportEmail,
    turnstileSiteKey,
  };
}
