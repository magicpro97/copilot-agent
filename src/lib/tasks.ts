import type { ProjectType } from "../types.js";

interface TaskPrompt {
  title: string;
  prompt: string;
  priority: number;
}

const COMMON_TASKS: TaskPrompt[] = [
  {
    title: "Fix TODOs",
    prompt:
      "Scan for TODO, FIXME, HACK comments. Fix the most impactful ones. Run tests to verify.",
    priority: 1,
  },
  {
    title: "Update dependencies",
    prompt:
      "Check for outdated dependencies. Update patch/minor versions that are safe. Run tests after updating.",
    priority: 2,
  },
  {
    title: "Improve test coverage",
    prompt:
      "Find untested public functions. Write tests for the most critical ones. Target 80%+ coverage.",
    priority: 3,
  },
  {
    title: "Fix lint warnings",
    prompt:
      "Run the project linter. Fix all warnings without changing behavior. Run tests.",
    priority: 4,
  },
  {
    title: "Improve documentation",
    prompt:
      "Review README and code docs. Add missing JSDoc/KDoc for public APIs. Update outdated sections.",
    priority: 5,
  },
  {
    title: "Security audit",
    prompt:
      "Check for common security issues: hardcoded secrets, SQL injection, XSS, insecure defaults. Fix any found.",
    priority: 6,
  },
];

const TYPE_TASKS: Partial<Record<ProjectType, TaskPrompt[]>> = {
  kmp: [
    {
      title: "KMP: Optimize Compose",
      prompt:
        "Review Compose UI code for recomposition issues. Add @Stable/@Immutable where needed. Check remember usage.",
      priority: 2,
    },
    {
      title: "KMP: Check expect/actual",
      prompt:
        "Review expect/actual declarations. Ensure all platforms have proper implementations. Check for missing iOS/Desktop actuals.",
      priority: 3,
    },
    {
      title: "KMP: Room migrations",
      prompt:
        "Check Room database schema. Ensure migrations are defined for schema changes. Add missing migration tests.",
      priority: 4,
    },
  ],
  typescript: [
    {
      title: "TS: Strict type safety",
      prompt:
        "Find `any` types and loose assertions. Replace with proper types. Enable stricter tsconfig options if safe.",
      priority: 2,
    },
  ],
  react: [
    {
      title: "React: Performance",
      prompt:
        "Find unnecessary re-renders. Add React.memo, useMemo, useCallback where beneficial. Check bundle size.",
      priority: 2,
    },
  ],
  python: [
    {
      title: "Python: Type hints",
      prompt:
        "Add type hints to public functions. Run mypy to check type safety. Fix any type errors.",
      priority: 2,
    },
  ],
  node: [
    {
      title: "Node: Error handling",
      prompt:
        "Review async error handling. Add try/catch for unhandled promises. Check for missing error middleware.",
      priority: 2,
    },
  ],
};

export function getTasksForProject(type: ProjectType): TaskPrompt[] {
  const specific = TYPE_TASKS[type] ?? [];
  return [...specific, ...COMMON_TASKS].sort(
    (a, b) => a.priority - b.priority,
  );
}
