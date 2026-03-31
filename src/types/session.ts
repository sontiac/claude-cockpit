export interface Session {
  session_id: string;
  slug: string | null;
  first_message: number;
  last_message: number;
  message_count: number;
  tool_call_count: number;
  cwd: string;
  summary: string | null;
  model: string | null;
  git_branch: string | null;
}
