import { fetchAssignedIssues } from "./repository/linearApi";
import { Task } from "./types";

export async function retrieveAllItems(): Promise<Task[]> {
  return fetchAssignedIssues();
}
