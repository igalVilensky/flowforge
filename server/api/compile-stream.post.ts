import type { CompileMode, CompileProgressEvent } from "../../shared/types/compileJob";
import { isCompileMode, runCompilePipeline } from "./compile.post";

type CompileStreamBody = {
  input?: unknown;
  mode?: unknown;
};

function errorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;

    if (typeof record.statusMessage === "string") return record.statusMessage;
    if (typeof record.message === "string") return record.message;
  }

  return "Compile failed.";
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CompileStreamBody>(event);
  const rawInput = typeof body.input === "string" ? body.input : "";
  const trimmedInput = rawInput.trim();

  if (!trimmedInput) {
    throw createError({
      statusCode: 400,
      statusMessage: "Process description is required.",
    });
  }

  if (body.mode !== undefined && !isCompileMode(body.mode)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Compile mode must be demo, rule_only, balanced, or full.",
    });
  }

  const mode: CompileMode = isCompileMode(body.mode) ? body.mode : "demo";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = async (progressEvent: CompileProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(progressEvent)}\n\n`));
      };

      try {
        await runCompilePipeline({
          rawInput,
          mode,
          emit,
        });
      } catch (error) {
        await emit({
          type: "error",
          message: errorMessage(error),
          timestamp: new Date().toISOString(),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
