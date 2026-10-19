import type { ChatMessage } from './hermesApi';

export function compactMessagesForMobile(messages: ChatMessage[]): ChatMessage[] {
  const compacted: ChatMessage[] = [];
  let toolCount = 0;
  let firstToolId = '';

  const flushTools = () => {
    if (!toolCount) return;
    compacted.push({
      id: `tool-summary-${firstToolId}-${toolCount}`,
      role: 'status',
      text: `${toolCount} tool action${toolCount === 1 ? '' : 's'} completed`,
      state: 'complete',
      meta: 'tool activity',
    });
    toolCount = 0;
    firstToolId = '';
  };

  for (const message of messages) {
    if (isToolLikeMessage(message)) {
      firstToolId ||= message.id;
      toolCount += 1;
      continue;
    }
    flushTools();
    if (message.role === 'status' && message.text === 'Thinking…' && compacted.some((seen) => seen.role === 'assistant' && seen.state === 'streaming')) continue;
    compacted.push(message);
  }
  flushTools();
  return compacted;
}

function isToolLikeMessage(message: ChatMessage): boolean {
  if (message.role === 'tool') return true;
  const meta = (message.meta ?? '').toLowerCase();
  return meta.includes('tool') || (message.role === 'status' && isToolArtifactText(message.text));
}

function isToolArtifactText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\[This response was interrupted by a user correction\.\]/i.test(trimmed)) return true;
  if (/^<untrusted_tool_result\b/i.test(trimmed)) return true;
  if (/^\[CONTEXT COMPACTION\s+[—-]\s+REFERENCE ONLY\]/i.test(trimmed)) return true;
  if (/^\[(terminal|browser[_\.]|read_file|search_files|execute_code|patch|write_file|process|tool|function)\]/im.test(trimmed)) return true;
  if (/\b(prompt\.submit|session\.resume|tool_calls?|tool_use|tool_result|function_call|jsonrpc|rpc|session_id)\b/i.test(trimmed) && /[{}]/.test(trimmed)) return true;
  if (/["'](output|exit_code|stderr|stdout|success|method|params|session_id|tool_call_id|function|arguments|content_base64)["']\s*:/i.test(trimmed)) return true;
  if (/```(?:json|text)?[\s\S]*?["'](method|params|session_id|output|exit_code|tool_call_id)["']\s*:/i.test(trimmed)) return true;
  return false;
}
