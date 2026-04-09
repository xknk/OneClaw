/** 与后端 `TaskRecord` / `TaskStatus` 对齐的客户端类型（便于 UI 展示） */

export type TaskStatus =
    | "draft"
    | "planned"
    | "running"
    | "pending_approval"
    | "review"
    | "approved"
    | "rejected"
    | "done"
    | "failed"
    | "cancelled";

export interface TaskStateTransition {
    at: string;
    from: TaskStatus;
    to: TaskStatus;
    reason?: string;
    meta?: Record<string, unknown>;
}

export type TaskTimelineEntry =
    | {
          kind: "transition";
          at: string;
          from: TaskStatus;
          to: TaskStatus;
          reason?: string;
          meta?: Record<string, unknown>;
      }
    | {
          kind: "note";
          at: string;
          text: string;
          meta?: Record<string, unknown>;
      }
    | {
          kind: "step";
          at: string;
          stepIndex: number;
          label?: string;
          summary?: string;
          ok?: boolean;
          durationMs?: number;
          meta?: Record<string, unknown>;
      };

export interface TaskCheckpoint {
    stepIndex: number;
    label?: string;
    payload?: Record<string, unknown>;
    at: string;
}

export interface TaskRecord {
    taskId: string;
    title: string;
    status: TaskStatus;
    createdAt: string;
    updatedAt: string;
    failureReason?: string;
    checkpoint?: TaskCheckpoint;
    transitions: TaskStateTransition[];
    timeline: TaskTimelineEntry[];
    templateId?: string;
    params?: Record<string, unknown>;
    meta?: Record<string, unknown>;
}

export interface TaskTemplateSummary {
    id: string;
    defaultTitle: string;
    defaultParams: Record<string, unknown>;
}
