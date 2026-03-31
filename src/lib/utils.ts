export function shortenPath(fullPath: string): string {
  const home = "/Users/";
  if (fullPath.startsWith(home)) {
    const afterHome = fullPath.slice(home.length);
    const slashIdx = afterHome.indexOf("/");
    if (slashIdx !== -1) {
      return "~" + afterHome.slice(slashIdx);
    }
    return "~";
  }
  return fullPath;
}

export function pathBasename(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts[parts.length - 1] || fullPath;
}

export function generateId(): string {
  return crypto.randomUUID();
}
