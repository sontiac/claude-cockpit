import { shortenPath } from "../../lib/utils";

interface SessionFilterProps {
  paths: string[];
  value: string | null;
  onChange: (path: string | null) => void;
}

export function SessionFilter({ paths, value, onChange }: SessionFilterProps) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-white/5 border border-card-border rounded-lg px-2 py-1 text-xs text-foreground outline-none focus:border-accent-cyan"
    >
      <option value="">All projects</option>
      {paths.map((p) => (
        <option key={p} value={p}>
          {shortenPath(p)}
        </option>
      ))}
    </select>
  );
}
