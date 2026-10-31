import type { RoomSummary } from "@linkroom/shared";

/**
 * Formats a RoomSummary object into clean GitHub-flavored Markdown.
 */
export function summaryToMarkdown(title: string, summary: RoomSummary): string {
  const lines: string[] = [];
  lines.push(`# ${title.trim() || "Room Summary"}\n`);

  if (summary.overview?.trim()) {
    lines.push(`## Overview\n\n${summary.overview.trim()}\n`);
  }

  if (summary.sections?.length) {
    for (const section of summary.sections) {
      lines.push(`## ${section.heading.trim()}\n`);
      for (const point of section.points) {
        lines.push(`- ${point.text.trim()}`);
      }
      lines.push("");
    }
  }

  if (summary.key_terms?.length) {
    lines.push("## Key Terms\n");
    for (const term of summary.key_terms) {
      lines.push(`- **${term.term.trim()}**: ${term.meaning.trim()}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

/**
 * Formats a RoomSummary object into readable plain text.
 */
export function summaryToPlainText(title: string, summary: RoomSummary): string {
  const lines: string[] = [];
  const header = title.trim() || "ROOM SUMMARY";
  lines.push(`${header.toUpperCase()}\n${"=".repeat(header.length)}\n`);

  if (summary.overview?.trim()) {
    lines.push(`OVERVIEW:\n${summary.overview.trim()}\n`);
  }

  if (summary.sections?.length) {
    for (const section of summary.sections) {
      lines.push(`${section.heading.trim().toUpperCase()}:`);
      for (const point of section.points) {
        lines.push(`  * ${point.text.trim()}`);
      }
      lines.push("");
    }
  }

  if (summary.key_terms?.length) {
    lines.push("KEY TERMS:");
    for (const term of summary.key_terms) {
      lines.push(`  * ${term.term.trim()}: ${term.meaning.trim()}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}
