import { authenticated } from "@/core/http/http-client";
import type { AgentAvailability, AgentNote, AgentRun, AgentStep } from "../domain/agent-run";

const runs = (project: string) => "projects/" + encodeURIComponent(project) + "/agent-runs";

/** Whether the design agent can run and what one run reserves (0 with the test agent). */
export const agentAvailability = (project: string, signal?: AbortSignal) => authenticated<AgentAvailability>(runs(project), { signal });

/** Runs the agent over the notes of Editar; it answers when the run ends, with its steps and the draft it left. */
export const runDesignAgent = (project: string, version: string, notes: AgentNote[]) =>
  authenticated<AgentRun>(runs(project), { method: "POST", body: JSON.stringify({ version, notes }) });

/** The steps of a past run, read from the agent's journal (agent_tool_call): the trail behind a change it proposed. */
export const agentRunSteps = (project: string, run: string, signal?: AbortSignal) =>
  authenticated<AgentStep[]>(runs(project) + "/" + encodeURIComponent(run), { signal });
