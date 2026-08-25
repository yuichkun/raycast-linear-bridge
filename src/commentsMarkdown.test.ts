import { describe, expect, it } from "vitest";
import { commentsMarkdown, formatCommentDate } from "./commentsMarkdown";
import { IssueComment } from "./types";

// Date-only formatter so expectations don't depend on the machine's locale/timezone.
const date = (iso: string) => iso.slice(0, 10);

function comment(id: string, overrides: Partial<IssueComment> = {}): IssueComment {
  return {
    id,
    body: `body of ${id}`,
    createdAt: "2026-08-21T00:00:00.000Z",
    authorName: "yogo",
    reactions: [],
    ...overrides,
  };
}

describe("commentsMarkdown", () => {
  it("renders a placeholder when there are no comments", () => {
    expect(commentsMarkdown([], date)).toBe("## Comments\n\n_No comments yet._");
  });

  it("renders root comments as list items in creation order, body on its own line", () => {
    const later = comment("b", { createdAt: "2026-08-22T00:00:00.000Z" });
    const earlier = comment("a", { createdAt: "2026-08-21T00:00:00.000Z" });

    expect(commentsMarkdown([later, earlier], date)).toBe(
      ["## Comments", "", "- **yogo** · 2026-08-21  ", "  body of a", "- **yogo** · 2026-08-22  ", "  body of b"].join(
        "\n",
      ),
    );
  });

  it("nests replies under their root, in creation order", () => {
    const root = comment("root");
    const secondReply = comment("r2", { parentId: "root", authorName: "binge", createdAt: "2026-08-23T00:00:00.000Z" });
    const firstReply = comment("r1", { parentId: "root", authorName: "shiina", createdAt: "2026-08-22T00:00:00.000Z" });

    expect(commentsMarkdown([root, secondReply, firstReply], date)).toBe(
      [
        "## Comments",
        "",
        "- **yogo** · 2026-08-21  ",
        "  body of root",
        "  - ↳ **shiina** · 2026-08-22  ",
        "    body of r1",
        "  - ↳ **binge** · 2026-08-23  ",
        "    body of r2",
      ].join("\n"),
    );
  });

  it("keeps multi-line bodies indented inside their item", () => {
    const multiLine = comment("a", { body: "first line\n\nsecond paragraph" });

    expect(commentsMarkdown([multiLine], date)).toBe(
      ["## Comments", "", "- **yogo** · 2026-08-21  ", "  first line", "", "  second paragraph"].join("\n"),
    );
  });

  it("marks a resolved thread on its root and the resolving reply", () => {
    const root = comment("root", { resolvedAt: "2026-08-23T00:00:00.000Z", resolvingCommentId: "r1" });
    const reply = comment("r1", { parentId: "root", createdAt: "2026-08-22T00:00:00.000Z" });

    const markdown = commentsMarkdown([root, reply], date);

    expect(markdown).toContain("- **yogo** · 2026-08-21 · ✓ Resolved  ");
    expect(markdown).toContain("  - ↳ **yogo** · 2026-08-22 · ✓ Resolution  ");
  });

  it("shows what an inline comment is anchored to, flattened and truncated", () => {
    const short = comment("a", { quotedText: "the  quoted\nbit" });
    const long = comment("b", { quotedText: "x".repeat(80) });

    expect(commentsMarkdown([short], date)).toContain("**yogo** · 2026-08-21 · on “the quoted bit”");
    expect(commentsMarkdown([long], date)).toContain(`on “${"x".repeat(60)}…”`);
  });

  it("flags edited comments and puts reactions on the header line", () => {
    const edited = comment("a", {
      editedAt: "2026-08-22T00:00:00.000Z",
      reactions: [
        { emoji: "👍", count: 2 },
        { emoji: "🎉", count: 1 },
      ],
    });

    expect(commentsMarkdown([edited], date)).toContain("- **yogo** · 2026-08-21 · (edited) · 👍 2 🎉 1  ");
  });

  it("pushes headings inside a body below the Comments heading, leaving code fences alone", () => {
    const withHeadings = comment("a", { body: "# Title\n## Sub\n```sh\n# not a heading\n```\n###### deep" });

    expect(commentsMarkdown([withHeadings], date)).toContain(
      "  ### Title\n  #### Sub\n  ```sh\n  # not a heading\n  ```\n  ###### deep",
    );
  });

  it("shows a reply whose parent is missing as its own root instead of dropping it", () => {
    const orphan = comment("r", { parentId: "gone" });

    const markdown = commentsMarkdown([orphan], date);

    expect(markdown).toContain("- **yogo** · 2026-08-21  \n  body of r");
    expect(markdown).not.toContain("↳");
  });
});

describe("formatCommentDate", () => {
  // Local-time constructors so this runs the same in any timezone.
  const now = new Date(2026, 7, 25, 18, 0);

  it("shows only the time for a comment from today", () => {
    expect(formatCommentDate(new Date(2026, 7, 25, 15, 31).toISOString(), now)).toBe("15:31");
    expect(formatCommentDate(new Date(2026, 7, 25, 9, 5).toISOString(), now)).toBe("09:05");
  });

  it("adds month/day for a comment from this year", () => {
    expect(formatCommentDate(new Date(2026, 6, 31, 9, 4).toISOString(), now)).toBe("7/31 09:04");
  });

  it("adds the year for older comments", () => {
    expect(formatCommentDate(new Date(2025, 11, 24, 23, 59).toISOString(), now)).toBe("2025/12/24 23:59");
  });
});
