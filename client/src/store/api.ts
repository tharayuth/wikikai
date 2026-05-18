import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

// ─── Types mirrored from server ───
export interface KnowledgeMeta {
  id: number;
  title: string;
  project: string | null;
  session_id: string | null;
  user_prompt: string | null;
  tokens_used: number | null;
  tags: string[];
  author: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  url: string;
}

export interface PageMeta {
  id: number;
  knowledge_id: number;
  position: number;
  title: string;
  summary: string | null;
  keywords: string[];
  created_at: string;
  updated_at: string;
  version: number;
  line_count: number;
  url: string;
}

export interface KnowledgeWithPages extends KnowledgeMeta {
  pages: PageMeta[];
}

export interface PageContent {
  id: number;
  knowledge_id: number;
  title: string;
  summary: string | null;
  keywords: string[];
  version: number;
  created_at: string;
  updated_at: string;
  total_lines: number;
  content: string;
}

export interface SearchHit {
  knowledge_id: number;
  knowledge_title: string;
  project: string | null;
  page_id: number;
  page_position: number;
  page_title: string;
  line: number;
  heading: {
    level: number;
    text: string;
    line: number;
    id: string;
  } | null;
  snippet: string;
  score: number;
  url: string;
  /** Set when the hit came from an `@N` block-id lookup. */
  block_id?: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
}

export interface KnowledgeListQuery {
  project?: string;
  session_id?: string;
  tag?: string;
  search?: string;
  limit?: number;
}

export interface PromptLogEntry {
  id: number;
  knowledge_id: number;
  page_id: number | null;
  page_version: number | null;
  tool_name: string | null;
  prompt: string;
  created_at: string;
}

export interface PromptLogResponse {
  knowledge_id: number;
  total: number;
  entries: PromptLogEntry[];
}

export const portalApi = createApi({
  reducerPath: "portalApi",
  baseQuery: fetchBaseQuery({ baseUrl: "/api/" }),
  tagTypes: ["Knowledge", "KnowledgeList", "Page", "Projects", "PromptLog"],
  endpoints: (builder) => ({
    listProjects: builder.query<
      { projects: { name: string; count: number; registered: boolean }[] },
      void
    >({
      query: () => "projects",
      providesTags: [{ type: "Projects", id: "LIST" }],
    }),
    addProject: builder.mutation<
      { name: string; created_at: string },
      { name: string }
    >({
      query: (body) => ({ url: "projects", method: "POST", body }),
      invalidatesTags: [{ type: "Projects", id: "LIST" }],
    }),
    removeProject: builder.mutation<
      { name: string; removed: boolean },
      { name: string }
    >({
      query: ({ name }) => ({
        url: `projects/${encodeURIComponent(name)}`,
        method: "DELETE",
      }),
      invalidatesTags: [{ type: "Projects", id: "LIST" }],
    }),

    listPageTitles: builder.query<
      { knowledge_id: number; id: number; position: number; title: string }[],
      void
    >({
      query: () => "page-titles",
      providesTags: [{ type: "Page", id: "TITLES" }],
    }),

    listKnowledge: builder.query<KnowledgeMeta[], KnowledgeListQuery | void>({
      query: (params) => ({
        url: "knowledge",
        params: { limit: 500, ...(params ?? {}) },
      }),
      providesTags: (result) =>
        result
          ? [
              { type: "KnowledgeList", id: "LIST" },
              ...result.map((k) => ({ type: "Knowledge" as const, id: k.id })),
            ]
          : [{ type: "KnowledgeList", id: "LIST" }],
    }),

    getKnowledge: builder.query<KnowledgeWithPages, number>({
      query: (id) => `knowledge/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Knowledge", id }],
    }),

    getPromptLog: builder.query<PromptLogResponse, number>({
      query: (id) => `knowledge/${id}/prompts`,
      providesTags: (_r, _e, id) => [{ type: "PromptLog", id }],
    }),

    deleteKnowledge: builder.mutation<{ id: number; deleted: true }, number>({
      query: (id) => ({ url: `knowledge/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, id) => [
        { type: "KnowledgeList", id: "LIST" },
        { type: "Knowledge", id },
        { type: "Projects", id: "LIST" },
      ],
    }),

    updateKnowledge: builder.mutation<
      { id: number; version: number; updated_at: string },
      { id: number; title?: string; project?: string | null; tags?: string[] }
    >({
      query: ({ id, ...body }) => ({
        url: `knowledge/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_r, _e, arg) => [
        { type: "KnowledgeList", id: "LIST" },
        { type: "Knowledge", id: arg.id },
        { type: "Projects", id: "LIST" },
        { type: "PromptLog", id: arg.id },
      ],
    }),

    getPage: builder.query<PageContent, number>({
      query: (pid) => `pages/${pid}`,
      providesTags: (_r, _e, pid) => [{ type: "Page", id: pid }],
    }),

    getPageRendered: builder.query<
      string,
      { pageId: number; version?: number }
    >({
      query: ({ pageId, version }) => ({
        url: `pages/${pageId}/rendered`,
        params: version ? { version } : undefined,
        responseHandler: (r) => r.text(),
      }),
      providesTags: (_r, _e, arg) => [{ type: "Page", id: arg.pageId }],
    }),

    listRevisions: builder.query<
      {
        page_id: number;
        current_version: number;
        revisions: {
          version: number;
          title: string;
          summary: string | null;
          created_at: string;
          line_count: number;
          is_current: boolean;
        }[];
      },
      number
    >({
      query: (pid) => `pages/${pid}/revisions`,
      providesTags: (_r, _e, pid) => [{ type: "Page", id: pid }],
    }),

    getPageRaw: builder.query<string, number | { pageId: number; version?: number }>({
      query: (arg) => {
        const pid = typeof arg === "number" ? arg : arg.pageId;
        const version = typeof arg === "number" ? undefined : arg.version;
        return {
          url: `pages/${pid}/raw`,
          params: version ? { version } : undefined,
          responseHandler: (r) => r.text(),
        };
      },
      providesTags: (_r, _e, arg) => {
        const pid = typeof arg === "number" ? arg : arg.pageId;
        return [{ type: "Page", id: pid }];
      },
    }),

    updatePage: builder.mutation<
      { id: number; knowledge_id: number; version: number; updated_at: string },
      { page_id: number; content?: string; title?: string; summary?: string; keywords?: string[] }
    >({
      query: ({ page_id, ...body }) => ({
        url: `pages/${page_id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (result, _e, arg) =>
        result
          ? [
              { type: "Page", id: arg.page_id },
              { type: "Knowledge", id: result.knowledge_id },
              { type: "KnowledgeList", id: "LIST" },
              { type: "PromptLog", id: result.knowledge_id },
            ]
          : [],
    }),

    deletePage: builder.mutation<{ id: number; deleted: true }, { page_id: number; knowledge_id: number }>({
      query: ({ page_id }) => ({ url: `pages/${page_id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, arg) => [
        { type: "Page", id: arg.page_id },
        { type: "Knowledge", id: arg.knowledge_id },
        { type: "KnowledgeList", id: "LIST" },
      ],
    }),

    pruneRevisions: builder.mutation<
      { removed: number; kept_versions: number[] },
      number
    >({
      query: (pid) => ({ url: `pages/${pid}/revisions`, method: "DELETE" }),
      invalidatesTags: (_r, _e, pid) => [{ type: "Page", id: pid }],
    }),

    toggleTaskAtIndex: builder.mutation<
      { index: number; done: boolean; version: number; updated_at: string },
      { pageId: number; index: number }
    >({
      query: ({ pageId, index }) => ({
        url: `pages/${pageId}/tasks/${index}/toggle`,
        method: "POST",
      }),
      // Same rationale as toggleChecklistItem — optimistic DOM flip is
      // enough; refetch would yank the article and scroll-jump.
      invalidatesTags: [],
    }),

    toggleChecklistItem: builder.mutation<
      {
        page_id: number;
        knowledge_id: number;
        version: number;
        block_id: number;
        index: number;
        done: boolean;
        item_text: string;
        url: string;
      },
      { block_id: number; index: number; done: boolean }
    >({
      query: ({ block_id, index, done }) => ({
        url: `blocks/${block_id}/checklist/${index}`,
        method: "PATCH",
        body: { done },
      }),
      // Intentionally do NOT invalidate Page/Knowledge tags here. The
      // optimistic .done class flip already reflects the new state in
      // the DOM, and refetching the rendered HTML would replace the
      // article element + scroll the viewport back to the top on every
      // click. The user's next navigation refreshes naturally.
      invalidatesTags: [],
    }),

    search: builder.query<
      SearchResponse,
      { q: string; limit?: number; projects?: string[] }
    >({
      query: ({ q, limit = 20, projects }) => ({
        url: "search",
        params: {
          q,
          limit,
          ...(projects && projects.length > 0
            ? { projects: projects.join(",") }
            : {}),
        },
      }),
    }),
  }),
});

export const {
  useListKnowledgeQuery,
  useListPageTitlesQuery,
  useGetKnowledgeQuery,
  useDeleteKnowledgeMutation,
  useUpdateKnowledgeMutation,
  useGetPageQuery,
  useGetPageRenderedQuery,
  useGetPageRawQuery,
  useUpdatePageMutation,
  useDeletePageMutation,
  usePruneRevisionsMutation,
  useSearchQuery,
  useLazySearchQuery,
  useListRevisionsQuery,
  useListProjectsQuery,
  useAddProjectMutation,
  useRemoveProjectMutation,
  useGetPromptLogQuery,
  useToggleChecklistItemMutation,
  useToggleTaskAtIndexMutation,
} = portalApi;
