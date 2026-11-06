import { SectionEmoji } from "../sectionEmoji";
import { updateJsonFile } from "./fileStore";

// In environment.supportPath, like settings.json, rather than LocalStorage: the assignments
// have to outlive Raycast's "Clear Local Storage & Cache", or every section's emoji would be
// handed out afresh. Kept apart from settings.json, which holds what the user chose.
const SECTION_EMOJI_FILE = "sectionEmoji.json";

export async function updateSectionEmoji(update: (current: SectionEmoji) => SectionEmoji): Promise<SectionEmoji> {
  const { next } = await updateJsonFile<SectionEmoji>(SECTION_EMOJI_FILE, {}, update);
  return next;
}
