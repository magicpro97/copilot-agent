export type ProjectType =
  | "kmp" | "kotlin" | "java"
  | "node" | "typescript" | "react" | "next"
  | "python" | "rust" | "swift" | "go" | "flutter"
  | "unknown";

export interface SessionInfo {
  id: string;
  cwd?: string;
  gitRoot?: string;
  branch?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CopilotProcess {
  pid: number;
  elapsed: string;
  tty: string;
  command: string;
  sessionId?: string;
}
