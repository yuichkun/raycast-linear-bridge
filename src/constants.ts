import { Color, Icon } from "@raycast/api";

export const PRIORITY_NAMES: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

// No priority (0) is intentionally absent — it's the default and should stay invisible
// in the list, per the design decision to keep priority a minor, optional attribute
// rather than something every task carries.
export const PRIORITY_ICONS: Record<number, Icon> = {
  1: Icon.ExclamationMark,
  2: Icon.ChevronUp,
  3: Icon.Minus,
  4: Icon.ChevronDown,
};

export const PRIORITY_COLORS: Record<number, Color> = {
  1: Color.Red,
  2: Color.Orange,
  3: Color.Yellow,
  4: Color.SecondaryText,
};
