import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, Dirent } from "node:fs";
import path from "node:path";

function isTestFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith(".e2e.ts");
}

function collectTestFiles(root: string, fragment: string): string[] {
  const matches: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = readdirSync(current, { withFileTypes: true }) as Dirent[];

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!isTestFile(entry.name)) {
        continue;
      }

      if (entry.name.includes(fragment)) {
        matches.push(path.relative(process.cwd(), fullPath));
      }
    }
  }

  return matches;
}

function resolveTargets(args: string[]): string[] {
  if (args.length === 0) {
    return ["tests/**/*.test.ts", "tests/**/*.e2e.ts"];
  }

  const targets = new Set<string>();
  const testsRoot = path.resolve(process.cwd(), "tests");
  const hasTestsDirectory = existsSync(testsRoot);

  for (const arg of args) {
    const trimmed = arg.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.includes("/") || trimmed.endsWith(".ts")) {
      const candidate = path.resolve(process.cwd(), trimmed);
      if (existsSync(candidate)) {
        targets.add(path.relative(process.cwd(), candidate));
        continue;
      }
    }

    const directTest = path.join("tests", `${trimmed}.test.ts`);
    if (existsSync(directTest)) {
      targets.add(directTest);
      continue;
    }

    const directE2E = path.join("tests", `${trimmed}.e2e.ts`);
    if (existsSync(directE2E)) {
      targets.add(directE2E);
      continue;
    }

    if (hasTestsDirectory) {
      const indirectMatches = collectTestFiles(testsRoot, trimmed);
      for (const match of indirectMatches) {
        targets.add(match);
      }
    }
  }

  if (targets.size === 0) {
    return ["tests/**/*.test.ts"];
  }

  return Array.from(targets);
}

const extraArgs = process.argv.slice(2);
const testTargets = resolveTargets(extraArgs);
const env = { ...process.env };

const result = spawnSync("tsx", ["--test", ...testTargets], {
  stdio: "inherit",
  env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
