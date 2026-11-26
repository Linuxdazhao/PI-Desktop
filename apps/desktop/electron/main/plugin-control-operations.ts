import { createHash } from "node:crypto";
import type { McpControlInvokeInput, McpControlOperation } from "./mcp-control";
import { SESSION_COLLABORATION_OPERATIONS } from "./session-collaboration-control";

const AGENT_SUBMIT = "agent/submit";
const MAX_TEXT_BYTES = 64 * 1024;

export function pluginControlOperations(
  channels: Readonly<Record<string, string>>,
  collaboration: boolean,
): McpControlOperation[] {
  const operations = collaboration ? [...SESSION_COLLABORATION_OPERATIONS] : [];
  if (channels.agentQueuePush) operations.push({
    id: AGENT_SUBMIT,
    channel: channels.agentQueuePush,
    description: "Send approved text to a Desktop conversation, or queue it while the conversation is busy.",
    risk: "dangerous",
    argumentShape: ["{sessionId,content,requestId}"],
    pluginOnly: true,
  });
  return operations;
}

export function pluginControlArgs(input: McpControlInvokeInput, args: unknown[]): unknown[] {
  if (input.operation !== AGENT_SUBMIT) return args;
  const pluginId = input.pluginContext?.pluginId;
  if (input.source !== "plugin" || !pluginId) {
    throw Object.assign(new Error("Agent submission requires a plugin context"), { code: "PERMISSION_DENIED" });
  }
  const request = args[0];
  const invalid = () => Object.assign(new Error("A local session, content and request ID are required"), { code: "INVALID_PARAMS" });
  if (args.length !== 1 || !request || typeof request !== "object" || Array.isArray(request)) throw invalid();
  const { sessionId, content, requestId } = request as Record<string, unknown>;
  if (
    typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 128 ||
    sessionId.startsWith("native-pi:") || sessionId.startsWith("remote:") ||
    typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > MAX_TEXT_BYTES ||
    typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(requestId)
  ) throw invalid();
  // User-approved text follows the same admission and queue as the Composer.
  // All other prompt and queue fields belong to the Desktop.
  const key = createHash("sha256").update(JSON.stringify([pluginId, sessionId, requestId])).digest("hex");
  return [{ sessionId, content, idempotencyKey: `plugin-submit:${key}` }];
}
