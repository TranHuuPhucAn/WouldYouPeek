import { parseAnswerRequest, submitAnswer } from "@/server/challenges/service";
import { handleRoute, readJsonBody } from "@/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const answer = parseAnswerRequest(await readJsonBody(request));
    const { id } = await context.params;
    return submitAnswer(id, answer);
  });
}
