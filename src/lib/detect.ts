import { existsSync } from "node:fs";
import { join } from "node:path";
import { findUp } from "find-up";
import type { ProjectType } from "../types.js";

const SIGNATURES: [ProjectType, string[]][] = [
  ["kmp", ["gradle.properties", "composeApp"]],
  ["flutter", ["pubspec.yaml"]],
  ["next", ["next.config.js", "next.config.mjs", "next.config.ts"]],
  ["react", ["vite.config.ts", "vite.config.js"]],
  ["typescript", ["tsconfig.json"]],
  ["node", ["package.json"]],
  ["kotlin", ["build.gradle.kts", "build.gradle"]],
  ["java", ["pom.xml", "build.gradle"]],
  ["python", ["pyproject.toml", "setup.py", "requirements.txt"]],
  ["rust", ["Cargo.toml"]],
  ["swift", ["Package.swift", "*.xcodeproj"]],
  ["go", ["go.mod"]],
];

export async function detectProjectType(dir: string): Promise<ProjectType> {
  for (const [type, files] of SIGNATURES) {
    for (const f of files) {
      if (f.includes("*")) {
        // simple glob-like check
        const found = await findUp(f, { cwd: dir, type: "file" });
        if (found) return type;
      } else if (existsSync(join(dir, f))) {
        return type;
      }
    }
  }
  return "unknown";
}

export function getProjectName(dir: string): string {
  return dir.split("/").pop() ?? "unknown";
}
