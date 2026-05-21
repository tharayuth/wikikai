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

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AuthMeResponse {
  user: AuthUser | null;
  auth_enabled: boolean;
}

export interface ActivityLogEntry {
  id: number;
  created_at: string;
  source: "mcp" | "web";
  tool_name: string | null;
  action: "add" | "edit" | "delete" | "reorder" | "toggle" | "caption" | "upload" | "resize";
  target: "knowledge" | "page" | "block" | "image" | "task";
  knowledge_id: number | null;
  knowledge_title: string | null;
  page_id: number | null;
  page_title: string | null;
  block_id: number | null;
  block_caption: string | null;
  user_id: number | null;
  user_name: string | null;
}

export interface ActivityLogResponse {
  entries: ActivityLogEntry[];
  total: number;
}

export interface PromptLogResponse {
  knowledge_id: number;
  total: number;
  entries: PromptLogEntry[];
}

export const portalApi = createApi({
  reducerPath: "portalApi",
  baseQuery: fetchBaseQuery({ baseUrl: "/api/" }),
  tagTypes: [
    "Knowledge",
    "KnowledgeList",
    "Page",
    "PageRendered",
    "Revisions",
    "Projects",
    "PromptLog",
    "ActivityLog",
    "Auth",
  ],
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

    getAuthMe: builder.query<AuthMeResponse, void>({
      query: () => "auth/me",
      providesTags: [{ type: "Auth", id: "ME" }],
    }),

    login: builder.mutation<
      { user: AuthUser },
      { email: string; password: string }
    >({
      query: (body) => ({ url: "auth/login", method: "POST", body }),
      invalidatesTags: [{ type: "Auth", id: "ME" }],
    }),

    logout: builder.mutation<{ ok: true }, void>({
      query: () => ({ url: "auth/logout", method: "POST" }),
      invalidatesTags: [
        { type: "Auth", id: "ME" },
        { type: "KnowledgeList", id: "LIST" },
      ],
    }),

    getActivityLog: builder.query<
      ActivityLogResponse,
      { limit?: number; offset?: number; knowledge_id?: number } | void
    >({
      query: (args) => {
        const params = new URLSearchParams();
        const a = args ?? {};
        if (a.limit != null) params.set("limit", String(a.limit));
        if (a.offset != null) params.set("offset", String(a.offset));
        if (a.knowledge_id != null)
          params.set("knowledge_id", String(a.knowledge_id));
        const q = params.toString();
        return q ? `activity?${q}` : "activity";
      },
      providesTags: [{ type: "ActivityLog", id: "LIST" }],
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
      providesTags: (_r, _e, arg) => [
        { type: "PageRendered", id: arg.pageId },
      ],
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
      providesTags: (_r, _e, pid) => [{ type: "Revisions", id: pid }],
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
              { type: "PageRendered", id: arg.page_id },
              { type: "Revisions", id: arg.page_id },
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
        { type: "PageRendered", id: arg.page_id },
        { type: "Knowledge", id: arg.knowledge_id },
        { type: "KnowledgeList", id: "LIST" },
      ],
    }),

    pruneRevisions: builder.mutation<
      { removed: number; kept_versions: number[] },
      number
    >({
      query: (pid) => ({ url: `pages/${pid}/revisions`, method: "DELETE" }),
      invalidatesTags: (_r, _e, pid) => [
        { type: "Page", id: pid },
        { type: "Revisions", id: pid },
      ],
    }),

    toggleTaskAtIndex: builder.mutation<
      { index: number; done: boolean; version: number; updated_at: string },
      { pageId: number; index: number }
    >({
      query: ({ pageId, index }) => ({
        url: `pages/${pageId}/tasks/${index}/toggle`,
        method: "POST",
      }),
      // Refresh page metadata (so currentVersion + the active version
      // pill move forward) and the revision pill list — but NOT
      // PageRendered. Refetching the rendered HTML would yank the
      // article DOM and scroll-jump on every checkbox click.
      invalidatesTags: (_r, _e, arg) => [
        { type: "Page", id: arg.pageId },
        { type: "Revisions", id: arg.pageId },
      ],
    }),

    resizeInlineImage: builder.mutation<
      { id: number; version: number; updated_at: string },
      {
        pageId: number;
        /** Inline markdown image — pass src + occurrence. */
        src?: string;
        occurrence?: number;
        /** html-embed `<img>` — pass block_id + index instead. */
        block_id?: number;
        index?: number;
        width?: number;
        height?: number;
      }
    >({
      query: ({ pageId, src, occurrence, block_id, index, width, height }) => ({
        url: `pages/${pageId}/image-size`,
        method: "POST",
        body: { src, occurrence, block_id, index, width, height },
      }),
      // Same pattern as toggleTask — bump Page + Revisions but NOT
      // PageRendered. The client already applied the new size to the
      // live <img> during the drag, so a render-refetch would just
      // scroll-jump for no visible difference.
      invalidatesTags: (_r, _e, arg) => [
        { type: "Page", id: arg.pageId },
        { type: "Revisions", id: arg.pageId },
      ],
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
  useGetActivityLogQuery,
  useGetAuthMeQuery,
  useLoginMutation,
  useLogoutMutation,
  useToggleTaskAtIndexMutation,
  useResizeInlineImageMutation,
} = portalApi;
