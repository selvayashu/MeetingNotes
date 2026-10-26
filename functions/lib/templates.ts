/** Meeting types. The ids are also a CHECK constraint on meetings.template and a list in src/lib/templates.ts (a test keeps all three equal). */
export const TEMPLATE_IDS = ['general', 'standup', 'one_on_one', 'client_call', 'interview', 'brainstorm'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export function normaliseTemplate(v: unknown): TemplateId {
  return (TEMPLATE_IDS as readonly unknown[]).includes(v) ? (v as TemplateId) : 'general'
}

/**
 * What to focus on for each type. These only steer the summary and which items are worth listing; the output shape
 * is always the same, so nothing downstream changes. Empty = the standard notes.
 */
const GUIDANCE: Record<TemplateId, string> = {
  general: '',
  standup:
    'This is a team stand-up. Where names are known, organise the summary person by person: what they did, what they plan to do, and any blockers. Treat a blocker as an action item only when someone said they would handle it.',
  one_on_one:
    'This is a one-to-one conversation between two people (for example a manager and a team member). Summarise the topics discussed, feedback given, goals or concerns raised, and the agreed follow-ups. Stay factual and neutral; do not judge or rate anyone.',
  client_call:
    'This is a call with a client or customer. Summarise what the client asked for or was worried about, what we committed to, open questions, and the next steps. Put commitments that have an owner or a date into the action items.',
  interview:
    'This is a job interview. Summarise the candidate\'s background and the topics covered, and what the interviewers said about next steps. Stay strictly factual about what was said: do not rate the candidate, compare them with anyone, or recommend hiring or rejecting. Never infer or mention age, gender, health, family, religion or any other personal characteristic.',
  brainstorm:
    'This is a brainstorming session. Summarise the main ideas raised, which ideas the group favoured or dropped and why, and what will be explored next. Only decisions that were explicitly made belong under "decisions".',
}

export function templateGuidance(id: unknown): string {
  return GUIDANCE[normaliseTemplate(id)]
}
