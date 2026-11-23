import { authenticated, authenticatedResponse } from "@/core/http/http-client";
import type { AgentAvailability, AgentNote, AgentRun, AgentStep } from "../domain/agent-run";

const runs = (project: string) => "projects/" + encodeURIComponent(project) + "/agent-runs";

/** Whether the design agent can run and what one run reserves (0 with the test agent). */
export const agentAvailability = (project: string, signal?: AbortSignal) => authenticated<AgentAvailability>(runs(project), { signal });

/** Reads the agent's events as they arrive. A disconnected stream never starts another run. */
export async function runDesignAgent(project: string, version: string, notes: AgentNote[], onStep: (step: AgentStep) => void, signal?: AbortSignal) {
  const response = await authenticatedResponse(runs(project) + "/stream", {
    method: "POST", headers: { Accept: "text/event-stream, application/json" }, body: JSON.stringify({ version, notes }), signal,
  });
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error("No se recibió la transmisión de pasos del agente.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += value;
      let end: number;
      while ((end = pending.indexOf("\n\n")) !== -1) {
        const event = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const [kind, data] = event.split("\n", 2);
        if (!data?.startsWith("data: ")) continue;
        const payload = JSON.parse(data.slice(6));
        if (kind === "event: step") onStep(payload as AgentStep);
        if (kind === "event: result") return payload as AgentRun;
        if (kind === "event: failure") throw new Error(payload.message);
      }
    }
    throw new Error("Se interrumpió la conexión con el agente. Revisa Cambios de diseño antes de volver a intentar.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** The steps of a past run, read from the agent's journal (agent_tool_call): the trail behind a change it proposed. */
export const agentRunSteps = (project: string, run: string, signal?: AbortSignal) =>
  authenticated<AgentStep[]>(runs(project) + "/" + encodeURIComponent(run), { signal });
