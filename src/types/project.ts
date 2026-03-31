export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  terminals: number;
  command: string | null;
}
