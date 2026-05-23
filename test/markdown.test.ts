import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render/markdown.js";

describe("renderMarkdown", () => {
  it("renders basic markdown", async () => {
    const out = await renderMarkdown("# Hello\n\nworld **bold**");
    expect(out).toContain("<h1");
    expect(out).toContain("Hello");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("adds id attributes to headings", async () => {
    const out = await renderMarkdown("## Section One\n\ntext");
    expect(out).toMatch(/<h2[^>]+id="section-one"/);
  });

  it("sizes images via title 'WxH' suffix", async () => {
    const out = await renderMarkdown(`![cat](/img/abc.png "300x200")`);
    expect(out).toMatch(/<img[^>]+src="\/img\/abc\.png"/);
    expect(out).toMatch(/style="max-width:300px;max-height:200px;width:auto;height:auto"/);
    // Size hint is consumed — no leftover title attribute
    expect(out).not.toMatch(/title="300x200"/);
  });

  it("sizes images via title 'Wx' (width only)", async () => {
    const out = await renderMarkdown(`![](/img/x.jpg "400x")`);
    expect(out).toMatch(/style="max-width:400px;width:auto;height:auto"/);
    expect(out).not.toMatch(/max-height/);
  });

  it("sizes images via 'h=N' tokens, keeping the rest as caption title", async () => {
    const out = await renderMarkdown(`![photo](/img/y.png "garuda emblem h=200")`);
    expect(out).toMatch(/style="max-height:200px;width:auto;height:auto"/);
    expect(out).toMatch(/title="garuda emblem"/);
  });

  it("leaves images alone when title carries no size hint", async () => {
    const out = await renderMarkdown(`![logo](/img/z.svg "company logo")`);
    expect(out).not.toMatch(/style=/);
    expect(out).toMatch(/title="company logo"/);
  });

  it("renders GFM task list items as checkboxes with per-page index", async () => {
    const out = await renderMarkdown("- [ ] alpha\n- [x] beta\n- [ ] gamma");
    expect(out).toMatch(/<ul[^>]+class="[^"]*contains-task-list/);
    expect(out).toMatch(/<li[^>]+class="[^"]*task-list-item[^"]*"[^>]*>\s*<input[^>]*data-task-index="0"[^>]*>\s*alpha/);
    expect(out).toMatch(/data-task-index="1"[^>]*checked[^>]*>\s*beta/);
    expect(out).toMatch(/data-task-index="2"[^>]*>\s*gamma/);
    // Indices keep counting across separate lists
  });

  it("rewrites <input type=checkbox> inside html-embed with shared index + strips disabled", async () => {
    const md =
      "- [ ] one\n\n```html-embed\n<table><tr><td><input type=\"checkbox\" checked disabled></td></tr><tr><td><input type=\"checkbox\" disabled></td></tr></table>\n```\n\n- [x] two";
    const out = await renderMarkdown(md);
    // GFM tasks get indices 0 and 3 (with html-embed checkboxes taking 1, 2)
    expect(out).toMatch(/data-task-index="0"[^>]*>\s*one/);
    expect(out).toMatch(/data-task-index="1"[^>]*checked/);
    expect(out).toMatch(/data-task-index="2"[^>]*>(?![^<]*checked)/);
    expect(out).toMatch(/data-task-index="3"[^>]*checked[^>]*>\s*two/);
    // disabled is gone everywhere
    expect(out).not.toMatch(/disabled/);
  });

  it("does not treat fenced code block lines as task items", async () => {
    const md = "```md\n- [ ] looks like a task but isn't\n```\n\n- [x] real task";
    const out = await renderMarkdown(md);
    // Only one task-list checkbox should be emitted, index 0
    const matches = out.match(/data-task-index="\d+"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('data-task-index="0"');
  });

  it("renders tables", async () => {
    const out = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("<td");
  });

  it("renders mermaid fence as <pre class=\"mermaid\">", async () => {
    const out = await renderMarkdown(
      "```mermaid\nflowchart LR\n  A --> B\n```",
    );
    expect(out).toContain('<pre class="mermaid">');
    expect(out).toContain("flowchart LR");
  });

  it("escapes HTML inside mermaid content", async () => {
    const out = await renderMarkdown(
      "```mermaid\n</pre><script>alert(1)</script>\n```",
    );
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders chart fence with valid JSON to canvas with escaped data-chart", async () => {
    const cfg = { type: "bar", data: { labels: ["a"], datasets: [{ data: [1] }] } };
    const out = await renderMarkdown(
      "```chart\n" + JSON.stringify(cfg) + "\n```",
    );
    expect(out).toContain('<canvas class="chart"');
    expect(out).toContain('data-chart="');
    // attribute value must not contain raw double quotes that break parsing
    const m = out.match(/data-chart="([^"]+)"/);
    expect(m).not.toBeNull();
    const decoded = m![1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    expect(JSON.parse(decoded)).toEqual(cfg);
  });

  it("renders chart-grid fence with multiple cards and optional title", async () => {
    const items = [
      { title: "Doughnut", type: "doughnut", data: { labels: ["a"], datasets: [{ data: [1] }] } },
      { type: "bar", data: { labels: ["x"], datasets: [{ data: [2] }] } },
    ];
    const out = await renderMarkdown(
      "```chart-grid\n" + JSON.stringify(items) + "\n```",
    );
    expect(out).toContain('class="chart-grid"');
    // 2 cards, 2 canvases
    expect(out.match(/<canvas/g)?.length).toBe(2);
    expect(out).toContain("Doughnut"); // title rendered for first
    // ensure title isn't smuggled into data-chart of the first
    const m = out.match(/<canvas class="chart" data-chart="([^"]+)"/);
    expect(m).not.toBeNull();
    const decoded = m![1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const parsed = JSON.parse(decoded);
    expect(parsed.title).toBeUndefined();
    expect(parsed.type).toBe("doughnut");
  });

  it("shows error on chart-grid non-array", async () => {
    const out = await renderMarkdown("```chart-grid\n{\"type\":\"bar\"}\n```");
    expect(out).toContain("chart-grid error");
    expect(out).not.toContain("<canvas");
  });

  it("shows error message on invalid chart JSON", async () => {
    const out = await renderMarkdown("```chart\n{not json}\n```");
    expect(out).toContain("chart error");
    expect(out).not.toContain("<canvas");
  });

  it("renders stats fence as grid of cards", async () => {
    const stats = [
      { num: "44K", label: "Factories" },
      { num: "164K", label: "Datasets", color: "blue" },
    ];
    const out = await renderMarkdown(
      "```stats\n" + JSON.stringify(stats) + "\n```",
    );
    expect(out).toContain('class="stats-bar"');
    expect(out).toContain("44K");
    expect(out).toContain("Factories");
    expect(out).toContain("164K");
    expect(out).toContain("stat-card");
    // class contains color modifier
    expect(out).toMatch(/stat-card[^"]*\bblue\b/);
  });

  it("renders steps fence with numbered cards and markdown body", async () => {
    const steps = [
      { title: "Step A", body: "Use `code` and **bold**." },
      { title: "Step B", body: "Second.\n\nMulti-paragraph ok." },
      { title: "Step C", body: "Third" },
    ];
    const out = await renderMarkdown("```steps\n" + JSON.stringify(steps) + "\n```");
    expect(out).toContain('class="steps-grid"');
    expect(out.match(/step-card/g)?.length).toBe(3);
    // Auto-numbered 1, 2, 3
    expect(out).toMatch(/<div class="step-num">1<\/div>/);
    expect(out).toMatch(/<div class="step-num">2<\/div>/);
    expect(out).toMatch(/<div class="step-num">3<\/div>/);
    // Markdown rendered (code + bold)
    expect(out).toContain("<code>code</code>");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("honours custom step number when n is provided", async () => {
    const out = await renderMarkdown(
      '```steps\n[{"n": "①", "title": "X", "body": "y"}]\n```',
    );
    expect(out).toContain("①");
  });

  it("shows error on steps non-array", async () => {
    const out = await renderMarkdown('```steps\n{"title":"x"}\n```');
    expect(out).toContain("steps error");
  });

  it("escapes HTML in stats labels", async () => {
    const stats = [{ num: "1", label: "<img src=x onerror=alert(1)>" }];
    const out = await renderMarkdown("```stats\n" + JSON.stringify(stats) + "\n```");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img");
  });

  it("disables raw HTML (security)", async () => {
    const out = await renderMarkdown("<script>alert(1)</script>");
    expect(out).not.toContain("<script>alert(1)</script>");
  });

  it("renders code blocks with shiki highlighting", async () => {
    const out = await renderMarkdown("```js\nconst x = 1;\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("shiki");
  });

  it("renders unknown language code blocks as plain pre/code", async () => {
    const out = await renderMarkdown("```unknownLang999\nhello\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("hello");
  });

  it("attaches data-block-id to a table when followed by a {@N} paragraph", async () => {
    const out = await renderMarkdown(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n{@77}",
    );
    expect(out).toMatch(/<table[^>]+data-block-id="77"/);
    // The annotation paragraph must not leak into the rendered output
    expect(out).not.toContain("{@77}");
  });

  it("converts `[ ]`/`[x]` at the start of a table cell to clickable checkboxes", async () => {
    const out = await renderMarkdown(
      "| Step | Done |\n|------|------|\n| Build | [x] |\n| Ship | [ ] |\n",
    );
    expect(out).toMatch(
      /<td[^>]*>\s*<input type="checkbox"[^>]*data-task-index="0"[^>]*checked/,
    );
    expect(out).toMatch(
      /<td[^>]*>\s*<input type="checkbox"[^>]*data-task-index="1"(?![^>]*checked)/,
    );
    // Raw `[ ]` / `[x]` should not survive in the cell text
    expect(out).not.toMatch(/>\s*\[\s*\]\s*</);
    expect(out).not.toMatch(/>\s*\[x\]\s*</);
  });

  it("converts `[ ]`/`[x]` anywhere in a table cell (not just at the start)", async () => {
    const out = await renderMarkdown(
      "| Note | OK |\n|------|----|\n| Step 1 [x] more | [ ] |\n",
    );
    // Mid-cell [x] gets converted to checkbox idx=0 (left-most in source)
    expect(out).toMatch(/<input type="checkbox"[^>]*data-task-index="0"[^>]*checked/);
    // Right cell [ ] is idx=1
    expect(out).toMatch(/<input type="checkbox"[^>]*data-task-index="1"(?![^>]*checked)/);
    // The literal `[x]` text must NOT survive
    expect(out).not.toContain("[x] more");
    // But the surrounding text does
    expect(out).toMatch(/Step 1\s*<input/);
    expect(out).toMatch(/<\/?input[^>]*>\s*more/);
  });

  it("leaves `[xyz]` and markdown links alone — only `[ ]`/`[x]`/`[X]` become checkboxes", async () => {
    const out = await renderMarkdown(
      "| Cell |\n|------|\n| see [link](http://x) and [abc] |\n",
    );
    expect(out).not.toMatch(/<input type="checkbox"/);
    expect(out).toContain("[abc]");
    expect(out).toContain('href="http://x"');
  });

  it("renders block-caption div for a fenced rich block with a quoted caption", async () => {
    const out = await renderMarkdown(
      '```stats {@77 "Q1 KPIs at a glance"}\n[{"num":"42","label":"answer"}]\n```',
    );
    expect(out).toMatch(
      /<div class="block-caption">Q1 KPIs at a glance<\/div>/,
    );
    // Caption should NOT survive as literal text in the fence info / cards
    expect(out).not.toContain("{@77");
  });

  it("renders block-caption div on a markdown table with caption annotation", async () => {
    const out = await renderMarkdown(
      '| a | b |\n|---|---|\n| 1 | 2 |\n\n{@88 "Sample 2-row table"}',
    );
    expect(out).toMatch(
      /<div class="block-caption">Sample 2-row table<\/div>/,
    );
    expect(out).not.toContain("{@88");
  });

  it("escapes HTML in block-caption text", async () => {
    const out = await renderMarkdown(
      '```mermaid {@99 "Architecture: <api> → DB"}\nflowchart TD\nA --> B\n```',
    );
    expect(out).toContain(
      '<div class="block-caption">Architecture: &lt;api&gt; → DB</div>',
    );
  });

  it("wraps the annotated table with a positioning container + block badge", async () => {
    const out = await renderMarkdown(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n{@88}",
    );
    // Wrapper opens before the table and closes after, with the badge inside.
    expect(out).toMatch(
      /<div class="table-wrap">\s*<table[^>]+data-block-id="88"[\s\S]*?<\/table>\s*<button[^>]+class="block-badge"[^>]+data-block-id="88"[^>]*>@88<\/button>\s*<\/div>/,
    );
  });

  it("renders a stray {@N} as a normal paragraph when not preceded by a table", async () => {
    const out = await renderMarkdown("Just some text.\n\n{@42}");
    expect(out).toContain("{@42}");
    expect(out).not.toMatch(/data-block-id="42"/);
  });

  it("wraps annotated `text` code fences in rich-block-code with badge", async () => {
    const out = await renderMarkdown(
      "```text {@101}\nhello world\n```",
    );
    expect(out).toMatch(
      /<div class="rich-block-code language-text"[^>]+data-block-id="101"/,
    );
    expect(out).toMatch(/<code[^>]+data-block-id="101"/);
    expect(out).toMatch(
      /<button[^>]+class="block-badge"[^>]+data-block-id="101"[^>]*>@101<\/button>/,
    );
  });

  it("wraps annotated `typescript` code fences in rich-block-code with badge", async () => {
    const out = await renderMarkdown(
      "```typescript {@102}\nconst x: number = 1;\n```",
    );
    expect(out).toMatch(
      /<div class="rich-block-code language-typescript"[^>]+data-block-id="102"/,
    );
    expect(out).toMatch(/<code[^>]+data-block-id="102"/);
    expect(out).toMatch(/data-block-id="102"[^>]*>@102/);
  });

  it("wraps annotated `bash` code fences in rich-block-code with badge", async () => {
    const out = await renderMarkdown(
      "```bash {@103}\necho hello\n```",
    );
    expect(out).toMatch(
      /<div class="rich-block-code language-bash"[^>]+data-block-id="103"/,
    );
    expect(out).toMatch(/<code[^>]+data-block-id="103"/);
    expect(out).toMatch(/data-block-id="103"[^>]*>@103/);
  });

  it("does NOT wrap `python` code fences in rich-block-code (not in allow-list)", async () => {
    const out = await renderMarkdown(
      "```python {@104}\nprint('hi')\n```",
    );
    // No code wrapper, no badge — python falls through the standard
    // highlight path with the `{@104}` info stripped.
    expect(out).not.toMatch(/rich-block-code/);
    expect(out).not.toMatch(/class="block-badge"[^>]+data-block-id="104"/);
  });
});

describe("buildToc", () => {
  it("extracts h2 and h3 with ids in order", async () => {
    const { buildToc } = await import("../src/render/markdown.js");
    const md = "# Title\n## First\nx\n### Sub\ny\n## Second\nz";
    const toc = buildToc(md);
    expect(toc).toEqual([
      { level: 2, id: "first", text: "First" },
      { level: 3, id: "sub", text: "Sub" },
      { level: 2, id: "second", text: "Second" },
    ]);
  });

  it("returns empty array when no headings", () => {
    return import("../src/render/markdown.js").then(({ buildToc }) => {
      expect(buildToc("just text")).toEqual([]);
    });
  });
});
