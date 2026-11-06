import { describe, expect, it } from "vitest";
import { assignSectionEmoji, emojiFor, SectionEmojiCandidate } from "./sectionEmoji";

const started = (name: string, position: number): SectionEmojiCandidate => ({ name, type: "started", position });

describe("assignSectionEmoji", () => {
  it("gives each status of a type its own emoji, in workflow order", () => {
    const assigned = assignSectionEmoji({}, [
      started("Pending", 5),
      started("In Progress", 2),
      started("Long Running", 9),
    ]);

    expect(assigned).toEqual({ "In Progress": "🔥", Pending: "⚡", "Long Running": "🚀" });
  });

  it("draws each type from its own family", () => {
    const assigned = assignSectionEmoji({}, [
      started("In Progress", 2),
      { name: "Todo", type: "unstarted", position: 1 },
      { name: "Triage", type: "triage", position: 0 },
      { name: "Backlog", type: "backlog", position: 0 },
    ]);

    expect(assigned).toEqual({ "In Progress": "🔥", Todo: "📝", Triage: "📥", Backlog: "🗂️" });
  });

  // The bug: emoji were handed out in display order on every render, so adding a status ahead
  // of others (or a section emptying out) moved every emoji after it.
  it("never changes an assigned emoji when a status is added, even ahead of it in the workflow", () => {
    const before = assignSectionEmoji({}, [started("In Progress", 2), started("Pending", 5)]);

    const after = assignSectionEmoji(before, [
      started("New First", 1),
      started("In Progress", 2),
      started("Pending", 5),
    ]);

    expect(after).toEqual({ "In Progress": "🔥", Pending: "⚡", "New First": "🚀" });
  });

  it("keeps a removed status's emoji to itself rather than handing it to the next new one", () => {
    const before = assignSectionEmoji({}, [started("In Progress", 2), started("Pending", 5)]);

    const after = assignSectionEmoji(before, [started("In Progress", 2), started("Reviewing", 6)]);

    expect(after).toEqual({ "In Progress": "🔥", Pending: "⚡", Reviewing: "🚀" });
  });

  it("gives a status shared by several teams one emoji", () => {
    const assigned = assignSectionEmoji({}, [
      started("In Progress", 2),
      started("In Progress", 2),
      started("Pending", 5),
    ]);

    expect(assigned).toEqual({ "In Progress": "🔥", Pending: "⚡" });
  });

  it("leaves out types that get no section of their own", () => {
    const assigned = assignSectionEmoji({}, [
      { name: "Done", type: "completed", position: 3 },
      { name: "Canceled", type: "canceled", position: 4 },
    ]);

    expect(assigned).toEqual({});
  });

  // Lets the caller skip writing the file when nothing changed.
  it("returns the same object when every status already has an emoji", () => {
    const existing = { "In Progress": "🔥" };

    expect(assignSectionEmoji(existing, [started("In Progress", 2)])).toBe(existing);
  });

  it("only shares emoji within a type once the type has more statuses than its family has emoji", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => started(`S${i}`, i));

    const assigned = assignSectionEmoji({}, eleven);
    const emojis = eleven.map((candidate) => assigned[candidate.name]);

    expect(new Set(emojis.slice(0, 10)).size).toBe(10);
    expect(emojis[10]).toBe(emojis[0]);
  });

  it("handles status names that are also Object.prototype's keys", () => {
    const assigned = assignSectionEmoji({}, [started("constructor", 1), started("__proto__", 2)]);

    expect(emojiFor(assigned, "constructor")).toBe("🔥");
    expect(emojiFor(assigned, "__proto__")).toBe("⚡");
    expect(emojiFor(assigned, "toString")).toBeUndefined();
  });
});
