import { Color, getPreferenceValues, Icon, List } from "@raycast/api";
import { LinearClient, Issue } from "@linear/sdk";
import { useEffect, useState } from "react";

interface Preferences {
  linearApiKey: string;
}

export default function Command() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function fetchAssignedIssues() {
      try {
        const { linearApiKey } = getPreferenceValues<Preferences>();
        const client = new LinearClient({ apiKey: linearApiKey });
        const viewer = await client.viewer;
        const assignedIssues = await viewer.assignedIssues();
        setIssues(assignedIssues.nodes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch issues from Linear");
      } finally {
        setIsLoading(false);
      }
    }
    fetchAssignedIssues();
  }, []);

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
          title="Failed to connect to Linear"
          description={error}
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading}>
      {issues.map((issue) => (
        <List.Item key={issue.id} title={issue.title} />
      ))}
    </List>
  );
}
