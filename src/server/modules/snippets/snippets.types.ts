// Message snippets — DB row + API DTO types. Mirrors /api/snippets POST.

export interface SnippetRow {
  id: string;
  title: string;
  body: string;
  sort_order: number;
}

export interface Snippet {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
}
