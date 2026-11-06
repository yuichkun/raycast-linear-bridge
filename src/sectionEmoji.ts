import { WorkflowStateType } from "./types";

// The emoji in front of each status section's title (🔥 In Progress, 📝 Todo, ...), mirroring
// todo-buddy's emoji-prefixed sections for at-a-glance scanning.
//
// Each status name gets its emoji once and keeps it: the assignments are saved (see
// storage.ts's retrieveSectionEmoji) and never revised. Handing them out in display order
// every render — the first started section on screen gets the first emoji, the next one the
// next — meant a section's emoji changed whenever another section appeared or emptied out, or
// a status was added to the workflow ahead of it. A rule computed from the current statuses
// (their order, their count) has the same flaw one step removed, so none is used: what was
// handed out stays handed out.
//
// One family of emoji per status type, so the type still reads at a glance, and several per
// family, so statuses of one type look different from each other (this workspace's General
// has six started ones). The families share no emoji. A new status takes the first one of its
// family nobody has; only when a type has more statuses than its family has emoji do two
// statuses share one.
const POOLS: Partial<Record<WorkflowStateType, readonly string[]>> = {
  started: ["🔥", "⚡", "🚀", "💪", "🎯", "🛠️", "⚙️", "🏃", "🌀", "⏳"],
  unstarted: ["📝", "🗒️", "📋", "📌", "📎", "🔖", "📒", "✏️", "🗓️", "📐"],
  triage: ["📥", "🔍", "❓", "🧐", "📨", "🚦", "⚖️", "🔬", "💡", "📮"],
  backlog: ["🗂️", "📦", "🧊", "🗄️", "📚", "💤", "🌱", "🗃️", "📁", "⏸️"],
};

// Status name -> emoji. Keyed by name because that's what a section is: same-named statuses of
// different teams share one section.
export type SectionEmoji = Record<string, string>;

export type SectionEmojiCandidate = { name: string; type: string; position?: number };

// A plain object read back from JSON, so a status named "constructor" must not find
// Object.prototype's.
export function emojiFor(sectionEmoji: SectionEmoji, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(sectionEmoji, name) ? sectionEmoji[name] : undefined;
}

const TYPE_ORDER = Object.keys(POOLS) as WorkflowStateType[];

// Adds an emoji for every status name not assigned one yet, and leaves every existing
// assignment as it is — including those of statuses that no longer exist, so their emoji isn't
// handed to another status. Names new at the same time are taken in the order they show in
// (type, then position in the workflow), so a first run looks the way the list always has with
// every section on screen. Returns `existing` itself when there's nothing to add.
export function assignSectionEmoji(existing: SectionEmoji, candidates: SectionEmojiCandidate[]): SectionEmoji {
  const fresh = candidates
    .filter(
      (candidate) => POOLS[candidate.type as WorkflowStateType] && emojiFor(existing, candidate.name) === undefined,
    )
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.type as WorkflowStateType) - TYPE_ORDER.indexOf(b.type as WorkflowStateType) ||
        (a.position ?? Infinity) - (b.position ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
  if (fresh.length === 0) return existing;

  const assigned = new Map(Object.entries(existing));
  for (const { name, type } of fresh) {
    if (assigned.has(name)) continue; // the same name from a second team
    const pool = POOLS[type as WorkflowStateType] ?? [];
    const taken = new Set(assigned.values());
    const free = pool.find((emoji) => !taken.has(emoji));
    // Every emoji of the family taken: go round it again, in order.
    const inFamily = [...assigned.values()].filter((emoji) => pool.includes(emoji)).length;
    assigned.set(name, free ?? pool[inFamily % pool.length]);
  }
  // fromEntries defines each name as the object's own key, even one like "__proto__".
  return Object.fromEntries(assigned);
}
