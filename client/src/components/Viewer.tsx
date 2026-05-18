import { useEffect } from "react";
import { useGetKnowledgeQuery } from "../store/api";
import { PageContent } from "./PageContent";

interface Props {
  kid: number | null;
  pid: number | null;
  line: number | null;
  block: number | null;
  onPickPage: (pid: number) => void;
}

export function Viewer({ kid, pid, line, block, onPickPage }: Props) {
  const knowledge = useGetKnowledgeQuery(kid as number, { skip: kid === null });

  // Auto-pick first page if none selected
  useEffect(() => {
    if (kid === null) return;
    if (pid !== null) return;
    if (!knowledge.data || knowledge.data.pages.length === 0) return;
    onPickPage(knowledge.data.pages[0].id);
  }, [kid, pid, knowledge.data, onPickPage]);

  if (kid === null) {
    return (
      <section className="viewer">
        <div className="viewer-empty">
          <h2>WikiKai</h2>
          <p>
            Pick an entry on the left, or create one via the MCP tool <code>add_knowledge</code>
          </p>
        </div>
      </section>
    );
  }
  if (knowledge.isLoading) {
    return (
      <section className="viewer">
        <div className="viewer-empty">
          <p>Loading #{kid}…</p>
        </div>
      </section>
    );
  }
  if (knowledge.error || !knowledge.data) {
    return (
      <section className="viewer">
        <div className="viewer-empty">
          <h2>#{kid} not found</h2>
        </div>
      </section>
    );
  }

  const meta = knowledge.data;
  const activePid =
    pid && meta.pages.find((p) => p.id === pid)
      ? pid
      : meta.pages[0]?.id ?? null;

  return (
    <section className="viewer">
      {meta.pages.length === 0 ? (
        <article className="markdown-body">
          <div className="viewer-empty">
            <p>This knowledge has no pages yet</p>
            <p>
              Use <code>add_page(knowledge_id={kid}, ...)</code> to add one
            </p>
          </div>
        </article>
      ) : (
        activePid !== null && (
          <PageContent pageId={activePid} line={line} block={block} />
        )
      )}
    </section>
  );
}
