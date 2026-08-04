export function formatMessageTextForMobile(text: string): string {
  return text
    .replace(/```(?:text|md|markdown)?\s*\n([\s\S]*?)\n```/gi, (_, body: string) => body.trim())
    .replace(/```\s*\n([\s\S]*?)\n```/g, (_, body: string) => body.trim())
    .replace(/```(?:text|md|markdown)?/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
