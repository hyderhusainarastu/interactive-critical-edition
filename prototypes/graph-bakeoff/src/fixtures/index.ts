import type { BakeoffFixture, FixtureName } from "./types";
import { FIXTURE_NAMES } from "./types";

// Vite statically analyzes this glob at build time; every fixture JSON file
// under ./data is bundled and loadable synchronously via `.default`.
const modules = import.meta.glob("./data/fixture-*.json", { eager: true }) as Record<
  string,
  { default: BakeoffFixture }
>;

const byName = new Map<string, BakeoffFixture>();
for (const [path, mod] of Object.entries(modules)) {
  const match = /\/(fixture-[a-zA-Z0-9]+)\.json$/.exec(path);
  if (!match) continue;
  byName.set(match[1], mod.default);
}

export function isFixtureName(value: string | null): value is FixtureName {
  return value !== null && (FIXTURE_NAMES as readonly string[]).includes(value);
}

export function loadFixture(name: FixtureName): BakeoffFixture {
  const fixture = byName.get(name);
  if (!fixture) {
    throw new Error(
      `Fixture "${name}" not found — run "npm run generate:fixtures" to (re)generate src/fixtures/data/*.json.`,
    );
  }
  return fixture;
}

export { FIXTURE_NAMES };
export type { BakeoffFixture, FixtureName } from "./types";
