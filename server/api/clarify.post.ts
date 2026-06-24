import type { ClarificationSessionResponse } from "../../shared/types/clarificationSession";
import { clarificationSessionRequestSchema } from "../schemas/clarificationSession.schema";
import { runClarificationConversationAgent } from "../services/clarificationConversationAgent";

export default defineEventHandler(async (event): Promise<ClarificationSessionResponse> => {
    const body = await readBody<unknown>(event);
    const parsed = clarificationSessionRequestSchema.safeParse(body);

    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            statusMessage: "Clarification request must include original_input and optional answers.",
            data: parsed.error.flatten(),
        });
    }

    return runClarificationConversationAgent({
        originalInput: parsed.data.original_input,
        answers: parsed.data.answers ?? [],
    });
});