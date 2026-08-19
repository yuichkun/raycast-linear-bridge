import { Color, Icon } from "@raycast/api";

// The team to default to wherever a team must be picked (Create Task, Promote to Linear).
// Hardcoded on purpose: this extension is built for one specific workspace, not as a
// general-purpose product, and "General" is where the vast majority of assigned issues
// already live there.
export const DEFAULT_TEAM_NAME = "General";

export function pickDefaultTeam<T extends { name: string }>(teams: T[]): T | undefined {
  return teams.find((team) => team.name === DEFAULT_TEAM_NAME) ?? teams[0];
}

export const PRIORITY_NAMES: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

// No priority (0) is intentionally absent — it's the default and should stay invisible
// in the list, per the design decision to keep priority a minor, optional attribute
// rather than something every task carries. High/Medium/Low use signal-strength bars
// (more bars = more important) — the same convention Linear's own app uses — instead of
// chevrons/minus signs that don't read as a priority scale at a glance. Urgent stays a
// distinct exclamation mark rather than "the strongest bar," matching Linear's own
// treatment of it as an out-of-band emergency level, not the top of the bar scale.
export const PRIORITY_ICONS: Record<number, Icon> = {
  1: Icon.ExclamationMark,
  2: Icon.Signal3,
  3: Icon.Signal2,
  4: Icon.Signal1,
};

export const PRIORITY_COLORS: Record<number, Color> = {
  1: Color.Red,
  2: Color.Orange,
  3: Color.Yellow,
  4: Color.SecondaryText,
};
