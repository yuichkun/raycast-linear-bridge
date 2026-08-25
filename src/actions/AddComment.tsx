import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { FC } from "react";
import { addComment } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

// One field, one action: a comment is its own operation, independent of any state change.
// The sync queue carries it to Linear, so submitting returns instantly and works offline
// like every other mutation.
export const AddComment: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();

  const handleSubmit = async (values: { body: string }) => {
    const body = values.body.trim();
    if (!body) {
      await showToast({ style: Toast.Style.Failure, title: "Comment is empty" });
      return;
    }

    try {
      await addComment(task.id, body);
      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Added comment", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to add comment",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Form
      navigationTitle={`Comment on ${task.title}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Comment" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="body" title="Comment" placeholder="Markdown works here" autoFocus enableMarkdown />
    </Form>
  );
};
