import bgWater from "../assets/bg-water.jpg";
import bgEnchanted from "../assets/bg-enchanted.jpg";
import bgForest from "../assets/bg-forest.jpg";
import bgAurora from "../assets/bg-aurora.jpg";
import bgDawn from "../assets/bg-dawn.jpg";
import bgLagoon from "../assets/bg-lagoon.jpg";

export interface Theme {
  id: string;
  name: string;
  /** Image URL — a Vite-hashed bundle URL (built-in) or an asset:// URL (custom). */
  image: string;
  /**
   * Scrim strength multiplier. The base scrim gradient is multiplied by this,
   * so brighter images can darken their overlay (keeping UI text legible) and
   * darker images can lighten it (showing more of the scene). 1 = base.
   */
  scrim: number;
  /** True for user-uploaded backgrounds (removable in the picker). */
  custom?: boolean;
}

export const THEMES: Theme[] = [
  { id: "water", name: "Deep Water", image: bgWater, scrim: 0.85 },
  { id: "enchanted", name: "Enchanted Forest", image: bgEnchanted, scrim: 0.95 },
  { id: "forest", name: "Forest & River", image: bgForest, scrim: 0.95 },
  { id: "aurora", name: "Aurora", image: bgAurora, scrim: 0.9 },
  { id: "dawn", name: "Dawn", image: bgDawn, scrim: 1.15 },
  { id: "lagoon", name: "Lagoon", image: bgLagoon, scrim: 1.3 },
];

export const DEFAULT_THEME_ID = "water";
