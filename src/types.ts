export type Theme = "warm" | "light" | "dark";
export interface Todo { id: string; text: string; done: boolean }
export interface Note {
  id: string;
  title: string;
  content: string;
  format: "text" | "markdown"; // Retained only for compatibility with saved v1 notes.
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  todos?: Todo[];
}
export interface HomeSettings { title: string; subtitle: string }
export interface TrashNote extends Note { deletedAt: number }
export interface Notebook { version: 1; theme: Theme; notes: Note[]; home?: HomeSettings; trash?: TrashNote[]; manualOrder?: boolean }
export interface ImageResult { requestId: string; path?: string; cancelled?: boolean; error?: string }
export interface BackupResult { requestId: string; phase?: "preview" | "exported" | "restored"; notes?: number; trash?: number; images?: number; createdAt?: number; cancelled?: boolean; error?: string }
export interface UpdateResult {
  requestId: string; phase: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "permission" | "installer" | "error";
  message?: string; progress?: number; ready?: boolean; release?: { version: string; notes: string; size: number };
}
declare global {
  interface Window {
    BetterNotepadUpdates?: { info(): string; check(id: string): void; download(id: string): void; install(id: string): void; cancel(id: string): void };
    betterNotepadUpdateResult?: (result: UpdateResult) => void;
    BetterNotepad?: {
      load(): string; save(data: string): string; pickImage(requestId: string): void;
      saveChecked?(data: string, expected: string): string; configureWidget?(): void; ready?(): void;
      exportBackup?(requestId: string): void; openBackup?(requestId: string): void;
      readBackup?(requestId: string): string; restoreBackup?(requestId: string, data: string): void;
      discardBackup?(requestId: string): void;
    };
    betterNotepadBack?: () => boolean;
    betterNotepadResume?: (noteId: string | null) => boolean;
    betterNotepadImageResult?: (result: ImageResult) => void;
    betterNotepadBackupResult?: (result: BackupResult) => void;
  }
}
