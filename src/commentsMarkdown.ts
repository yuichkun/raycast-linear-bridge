import { IssueComment } from "./types";

export type CommentDateFormatter = (iso: string) => string;

const QUOTE_PREVIEW_LENGTH = 60;

type Thread = { root: IssueComment; replies: IssueComment[] };

// Short, relative-to-today timestamps keep the header line from crowding out the body:
// just the time for today's comments, month/day for this year, full date otherwise.
export function formatCommentDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return time;
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  if (date.getFullYear() === now.getFullYear()) return `${monthDay} ${time}`;
  return `${date.getFullYear()}/${monthDay} ${time}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// Renders an issue's comments as a "## Comments" markdown section for Detail — Raycast's
// Detail is markdown-only, so this is the whole presentation layer. Each comment is a list
// item and each reply a nested item under its root, so the list's own indentation carries
// the thread structure. Threads follow Linear's model (a root plus a flat list of replies),
// so nesting never goes deeper than one level. Roots and replies are both in creation
// order, matching Linear's own view.
export function commentsMarkdown(
  comments: IssueComment[],
  formatDate: CommentDateFormatter = (iso) => formatCommentDate(iso),
): string {
  if (comments.length === 0) return "## Comments\n\n_No comments yet._";

  const items = groupIntoThreads(comments).flatMap(({ root, replies }) => [
    renderComment(root, { depth: 0, marker: root.resolvedAt ? "✓ Resolved" : undefined }, formatDate),
    ...replies.map((reply) =>
      renderComment(
        reply,
        { depth: 1, marker: reply.id === root.resolvingCommentId ? "✓ Resolution" : undefined },
        formatDate,
      ),
    ),
  ]);

  return `## Comments\n\n${items.join("\n")}`;
}

function byCreatedAt(a: IssueComment, b: IssueComment): number {
  return a.createdAt.localeCompare(b.createdAt);
}

// A reply whose parent isn't in the list (deleted, say) is shown as its own root rather
// than dropped — silently losing a comment is worse than a slightly off indentation.
function groupIntoThreads(comments: IssueComment[]): Thread[] {
  const ids = new Set(comments.map((comment) => comment.id));
  const roots = comments.filter((comment) => !comment.parentId || !ids.has(comment.parentId)).sort(byCreatedAt);
  return roots.map((root) => ({
    root,
    replies: comments.filter((comment) => comment.parentId === root.id).sort(byCreatedAt),
  }));
}

function renderComment(
  comment: IssueComment,
  options: { depth: number; marker?: string },
  formatDate: CommentDateFormatter,
): string {
  const header = [`**${comment.authorName}**`, formatDate(comment.createdAt)];
  if (comment.quotedText) header.push(`on “${previewQuote(comment.quotedText)}”`);
  if (comment.editedAt) header.push("(edited)");
  if (options.marker) header.push(options.marker);
  if (comment.reactions.length > 0) {
    header.push(comment.reactions.map((reaction) => `${reaction.emoji} ${reaction.count}`).join(" "));
  }

  const bullet = `${" ".repeat(options.depth * 2)}- ${options.depth > 0 ? "↳ " : ""}`;
  const indent = " ".repeat(options.depth * 2 + 2);
  const bodyLines = demoteHeadings(comment.body.trim())
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : ""));

  // The two trailing spaces are a markdown hard line break: the body starts on its own
  // line without the blank line that would turn the list "loose" and double its spacing.
  return [`${bullet}${header.join(" · ")}  `, ...bodyLines].join("\n");
}

function previewQuote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > QUOTE_PREVIEW_LENGTH ? `${flat.slice(0, QUOTE_PREVIEW_LENGTH)}…` : flat;
}

// A comment body is arbitrary markdown. Its headings get pushed below the "## Comments"
// section heading, so a `#` or `##` inside a body can't read as a new section of the
// detail view. Fenced code blocks are left alone — a `# comment` line inside ```sh is code.
function demoteHeadings(body: string): string {
  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/^(#{1,6})(?=\s)/, (hashes) => "#".repeat(Math.min(6, hashes.length + 2)));
    })
    .join("\n");
}
