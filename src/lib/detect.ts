import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';

export type ProjectType =
  | 'kmp' | 'kotlin' | 'java'
  | 'node' | 'typescript' | 'react' | 'next'
  | 'python' | 'rust' | 'swift' | 'go' | 'flutter'
  | 'unknown';

export function detectProjectType(dir: string): ProjectType {
  const exists = (f: string) => existsSync(join(dir, f));

  if (exists('build.gradle.kts') || exists('build.gradle')) {
    if (exists('composeApp') || exists('gradle.properties')) {
      try {
        const gradle = readFileSync(join(dir, 'build.gradle.kts'), 'utf-8');
        if (gradle.includes('multiplatform') || gradle.includes('KotlinMultiplatform')) return 'kmp';
      } catch { /* ignore */ }
    }
    if (exists('pom.xml')) return 'java';
    return 'kotlin';
  }
  if (exists('pubspec.yaml')) return 'flutter';
  if (exists('Package.swift')) return 'swift';
  try {
    const entries = readdirSync(dir);
    if (entries.some(e => e.endsWith('.xcodeproj'))) return 'swift';
  } catch { /* ignore */ }
  if (exists('Cargo.toml')) return 'rust';
  if (exists('go.mod')) return 'go';
  if (exists('pyproject.toml') || exists('setup.py') || exists('requirements.txt')) return 'python';
  if (exists('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['next']) return 'next';
      if (allDeps['react']) return 'react';
      if (allDeps['typescript'] || exists('tsconfig.json')) return 'typescript';
    } catch { /* ignore */ }
    return 'node';
  }
  if (exists('pom.xml')) return 'java';
  return 'unknown';
}

export function detectProjectName(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    if (pkg.name) return pkg.name;
  } catch { /* ignore */ }
  return basename(resolve(dir));
}

export function detectMainBranch(dir: string): string {
  try {
    const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return ref.split('/').pop() ?? 'main';
  } catch { /* ignore */ }

  try {
    const branch = execSync('git branch --show-current', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (branch) return branch;
  } catch { /* ignore */ }

  return 'main';
}
