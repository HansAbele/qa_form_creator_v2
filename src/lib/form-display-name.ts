/**
 * Keeps technical form versions in storage/audit data while removing them
 * from operational labels such as cards, selectors, and evidence summaries.
 */
export function formDisplayName(title: string) {
  return title.replace(/\s*(?:[-–—·|]\s*)?v(?:ersion)?\s*\d+(?:\.\d+)*\s*$/i, "").trim();
}
