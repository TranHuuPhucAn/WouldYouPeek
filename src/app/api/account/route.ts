import { getAccount } from "@/server/account/service";
import { handleRoute } from "@/server/http";
export async function GET() {
  return handleRoute(getAccount);
}
