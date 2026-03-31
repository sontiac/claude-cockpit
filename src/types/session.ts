export interface Session {
  session_id: string;
  first_message: number;
  last_message: number;
  message_count: number;
  cwd: string;
  summary: string | null;
}
