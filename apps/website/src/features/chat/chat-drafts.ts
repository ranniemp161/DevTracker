export interface ChatDraft {
  body: string;
  taskId?: string;
}

const drafts = new Map<string, ChatDraft>();

export function getChatDraft(projectId: string): ChatDraft | undefined {
  return drafts.get(projectId);
}

export function setChatDraft(projectId: string, draft: ChatDraft): void {
  if (!draft.body && !draft.taskId) {
    drafts.delete(projectId);
  } else {
    drafts.set(projectId, draft);
  }
}

export function clearChatDrafts(): void {
  drafts.clear();
}
