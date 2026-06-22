import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeHelp, setHelpLang, setHelpTab } from "../store/uiSlice";

export function HelpModal() {
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.ui.helpOpen);
  const tab = useAppSelector((s) => s.ui.helpTab);
  const lang = useAppSelector((s) => s.ui.helpLang);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(closeHelp());
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, dispatch]);

  if (!open) return null;

  return (
    <div className="modal-backdrop show" onClick={() => dispatch(closeHelp())}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header help-header">
          <div className="help-tabs">
            <button
              className={`help-tab${tab === "user" ? " active" : ""}`}
              onClick={() => dispatch(setHelpTab("user"))}
            >
              {lang === "en" ? "User Guide" : "คู่มือผู้ใช้"}
            </button>
            <button
              className={`help-tab${tab === "mcp" ? " active" : ""}`}
              onClick={() => dispatch(setHelpTab("mcp"))}
            >
              {lang === "en" ? "MCP" : "MCP"}
            </button>
          </div>
          <div className="help-lang-switch">
            <button
              className={`help-lang${lang === "en" ? " active" : ""}`}
              onClick={() => dispatch(setHelpLang("en"))}
            >
              EN
            </button>
            <button
              className={`help-lang${lang === "th" ? " active" : ""}`}
              onClick={() => dispatch(setHelpLang("th"))}
            >
              TH
            </button>
          </div>
          <button className="help-close" onClick={() => dispatch(closeHelp())} title="Close (Esc)">
            ×
          </button>
        </div>
        <div className="help-body">
          {tab === "user"
            ? lang === "en"
              ? <UserGuideEn />
              : <UserGuideTh />
            : lang === "en"
              ? <McpGuideEn />
              : <McpGuideTh />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USER GUIDE — English
// ═══════════════════════════════════════════════════════════════
function UserGuideEn() {
  return (
    <div className="help-content">
      <h2>WikiKai — User Guide</h2>
      <p>
        A portal for browsing <strong>knowledge documents</strong>. Each knowledge document
        contains multiple <strong>pages</strong> (tabs) of markdown content with Mermaid
        diagrams, Chart.js graphs, and stat cards.
      </p>

      <h3>Layout</h3>
      <ul>
        <li>
          <strong>Left sidebar</strong> — all knowledge entries, grouped by project, sorted by most recently updated
        </li>
        <li>
          <strong>Right content area</strong> — tab strip for pages, rendered markdown body
        </li>
        <li>
          <strong>Search box (top)</strong> — filters sidebar by title/tag (single char works); full-text content search across all pages when you type ≥ 3 characters (Thai/CJK supported via trigram index)
        </li>
      </ul>

      <h3>ID notation — &amp; vs #</h3>
      <p>
        Two different markers so the same number doesn't get confused with a different scope:
      </p>
      <table>
        <thead><tr><th>Symbol</th><th>Means</th><th>Where you see it</th></tr></thead>
        <tbody>
          <tr><td><code>&amp;N</code></td><td>knowledge id (the whole document / topic)</td><td>sidebar badge, header big badge, info popover</td></tr>
          <tr><td><code>#N</code></td><td>page id (a tab inside a document)</td><td>tab strip, row-2 meta, search results</td></tr>
        </tbody>
      </table>
      <p>
        Example: <code>&amp;3 #12</code> = page id 12, which lives inside knowledge id 3.
        URLs use the same convention with <code>&amp;</code> in the path and <code>#</code> in the fragment:
        <code>/&amp;3/#12:42</code>.
      </p>

      <h3>Navigation</h3>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>How</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Open a knowledge</td><td>Click an item in the sidebar</td></tr>
          <tr><td>Switch page</td><td>Click a tab above the content</td></tr>
          <tr><td>Reorder or move a page</td><td>Grab a page's drag handle (⋮⋮, appears on hover in the sidebar) → drag <strong>up/down</strong> to reorder within the topic, or drop it <strong>onto another topic</strong> to move the page there (it appends to that topic's pages). The target topic highlights while you hover it</td></tr>
          <tr><td>Add a knowledge / page</td><td>Hover a <strong>project header</strong> in the sidebar → click the <Kbd>+</Kbd> to create a new knowledge in that project. To add a <strong>page</strong>, click the <code>&amp;N</code> badge (sidebar topic row or topbar) → <Kbd>Add page</Kbd>. Both prompt for a title, then open the new entry</td></tr>
          <tr><td>Filter sidebar by project</td><td>Click the <Kbd>⏷ ทุก project</Kbd> button next to the <strong>WikiKai</strong> logo (top-left of the topbar) → check / uncheck projects. The input at the top of the dialog plus the <Kbd>+ เพิ่ม</Kbd> button registers a brand-new empty project so it shows up in the picker before you've moved any documents into it. 🗑 deletes the project + all its knowledge (typed-confirm required)</td></tr>
          <tr><td>Star important topics</td><td>Click the star button on a sidebar topic, or the star button just before <Kbd>i</Kbd> in the header. Use the star button beside the sidebar filter input to show starred topics only. Stars are saved in this browser localStorage, not shared metadata</td></tr>
          <tr><td>Move knowledge to a different project</td><td>Open the info popover (<Kbd>i</Kbd>), click the <strong>project</strong> row → inline editor with autocomplete. Type a known project or any new name; Enter saves, Esc cancels. Empty value detaches the knowledge from any project</td></tr>
          <tr><td>Show info (session, tokens, prompt)</td><td>Click the <Kbd>i</Kbd> button left of the title</td></tr>
          <tr><td>Knowledge actions (copy / add page / edit / delete)</td><td>Click the <code>&amp;N</code> badge — in the topbar <strong>or</strong> on a sidebar topic row — to open the same menu: copy id, copy content, add page, rename, delete</td></tr>
          <tr><td>Search within content</td><td>Type ≥ 3 chars in the search box → click result → jumps to that line (Thai, English, mixed — substring match)</td></tr>
          <tr><td>Toggle light/dark</td><td>Click <Kbd>☾</Kbd> / <Kbd>☀</Kbd></td></tr>
          <tr><td>Refresh</td><td>Click <Kbd>↻</Kbd></td></tr>
          <tr><td>Open help (this dialog)</td><td>Click <Kbd>?</Kbd></td></tr>
          <tr><td>Close any dialog</td><td>Press <Kbd>Esc</Kbd> or click outside</td></tr>
        </tbody>
      </table>

      <h3>Deep-link URLs (shareable)</h3>
      <p>
        Knowledge lives in the <strong>path</strong> (with the <code>&amp;</code> marker), the page lives in
        the <strong>fragment</strong> (after <code>#</code>). The URL bar shows where you are at a glance:
      </p>
      <table>
        <thead><tr><th>URL</th><th>Goes to</th></tr></thead>
        <tbody>
          <tr><td><code>/&amp;2</code></td><td>knowledge &amp;2, first tab (auto-picked)</td></tr>
          <tr><td><code>/&amp;2/#5</code></td><td>knowledge &amp;2, opens tab with page #5</td></tr>
          <tr><td><code>/&amp;2/#5:42</code></td><td>knowledge &amp;2, page #5, scrolls near line 42</td></tr>
          <tr><td colSpan={2} style={{ paddingTop: 8, color: "var(--text-3)" }}>Legacy URLs still work:</td></tr>
          <tr><td><code>/#&amp;2/5:42</code></td><td>same as <code>/&amp;2/#5:42</code></td></tr>
          <tr><td><code>/#2/5:42</code></td><td>same as <code>/&amp;2/#5:42</code> (oldest format)</td></tr>
        </tbody>
      </table>

      <h3>Edit / Delete</h3>
      <ul>
        <li><strong>Edit raw</strong> — opens a modal to edit the raw markdown of the current page; saving re-renders immediately</li>
        <li><strong>Delete page</strong> — removes the current page only; other pages in the knowledge stay</li>
      </ul>

      <h3>Content features</h3>
      <ul>
        <li><strong>Mermaid diagrams</strong> — Flowchart, ER, Sequence, Gantt, State (rendered client-side, theme-aware)</li>
        <li><strong>Chart.js</strong> — Bar, Line, Doughnut, etc. (interactive, hover for tooltips). Use a single <code>```chart</code> fence for one chart, or <code>```chart-grid</code> with a JSON array of configs to lay them side-by-side</li>
        <li><strong>Stat cards</strong> — number boxes with semantic colors (purple/blue/green/amber/red/cyan)</li>
        <li><strong>Step cards</strong> — <code>```steps</code> takes a JSON array of <code>{`{ title, body }`}</code> objects (body supports markdown). Auto-numbered circles, responsive grid</li>
        <li><strong>HTML embed</strong> — <code>```html-embed</code> for <em>flexible content</em>: richer tables (row colors, col-span, sticky headers), custom card/grid layouts, inline SVG, <code>&lt;details&gt;</code>, iframes. Inline <code>style</code> + scoped <code>&lt;style&gt;</code> + classes all work. <code>&lt;script&gt;</code> is inert by design</li>
        <li><strong>Inline image (recommended)</strong> — once uploaded via <code>add_image</code>, embed the <code>/img/&lt;hash&gt;.&lt;ext&gt;</code> path with plain markdown <code>![alt](/img/…)</code>. Works in paragraphs, list items, AND markdown table cells. Sizing via the title slot — <code>![alt](src "WxH")</code>, <code>"Wx"</code>, <code>"xH"</code>, or <code>"caption w=300 h=200"</code>. <strong>Drag the right/bottom/corner of any rendered image</strong> to resize live — the new size is persisted back to the title slot. <strong>Click the image</strong> to open a fullscreen lightbox. Aspect ratio is always preserved (max-width / max-height + auto on the other axis)</li>
        <li><strong>Image gallery — <code>```images</code> fence</strong> (specialised) — JSON array of <code>{`{ src, alt?, caption? }`}</code>; renders a uniform thumbnail grid with click-to-lightbox. Useful for 4+ side-by-side screenshots. For 1–3 images, plain markdown above is simpler and now equivalent</li>
        <li><strong>Importing an image (for AI)</strong> — <code>add_image</code> accepts <strong><code>{`{ path }`}</code></strong> to import a file that's already on the server machine (the server reads it off disk — no base64, so it's far cheaper on tokens), or <code>{`{ data_base64, mime_type }`}</code> for files elsewhere. Path import is off until the server sets <code>WIKIKAI_IMAGE_IMPORT_ROOTS</code></li>
        <li><strong>Interactive checkboxes</strong> — write a GFM task list <code>- [ ] item</code> / <code>- [x] item</code> anywhere a markdown list goes; the renderer turns each into a real clickable checkbox. <strong>Plain markdown tables work too</strong> — drop <code>[ ]</code> or <code>[x]</code> anywhere inside any cell (start, middle, multiple per cell) and each becomes a live checkbox sharing the same task-index counter. Wrap a literal <code>`[x]`</code> in backticks if you want to keep it as text. Raw <code>&lt;input type="checkbox"&gt;</code> markup inside <code>html-embed</code> is also clickable. <em>Clicking a box writes back to the source immediately</em> (page version bumped, revision snapshot, FTS reindexed). AI flips them via the <code>toggle_task</code> MCP tool — e.g. "tick task 3 on this page"</li>
        <li><strong>Images in HTML embed</strong> — alternatively, write <code>&lt;img src="/img/..." /&gt;</code> (or any external URL) inside an <code>html-embed</code> block when the image needs to sit beside text in a custom flex/grid layout. External URLs are also OK but only internal <code>/img/</code> paths are recoverable + visible to <code>get_image</code></li>
        <li><strong>Block ids <code>@N</code> + captions</strong> — every rich block (mermaid / chart / chart-grid / stats / steps / html-embed / images) gets a globally-unique id, shown as a small pill in the block's corner. Click to open a small menu — copy <code>@N</code> or jump straight into the editor at this block. <strong>Plain markdown tables</strong> also get an id via a trailing <code>{`{@N}`}</code> line. Each annotation can carry an optional <strong>caption</strong>: <code>{`{@123 "Architecture: API → DB"}`}</code> — renders as small italic text below the block (like an HTML <code>&lt;figcaption&gt;</code>) and lets AI answer "what is @123?" cheaply via <code>get_block({"{ id, summary: true }"})</code></li>
        <li><strong>Tables and code blocks</strong> — standard markdown plus Shiki syntax highlighting</li>
        <li><strong>Heading anchors</strong> — hover a heading to reveal <code>#</code> for copying a deep link to that section</li>
      </ul>

      <h3>Creating new content</h3>
      <p>
        This portal <strong>receives content via MCP</strong> — there is no "Create new" button in
        the UI. Documents are created by an MCP client (e.g. Claude Code, Claude Desktop). See the{" "}
        <em>MCP</em> tab for details.
      </p>

      <h3>Per-project permissions</h3>
      <p>
        Admins can grant each user <code>view</code> or <code>edit</code> access to specific
        projects via <strong>Manage users → Edit → Project access</strong>. Users without a grant
        see nothing in that project — the sidebar, search, and the MCP API all filter to what they
        are allowed to see. Admins have full access to all projects automatically.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USER GUIDE — Thai
// ═══════════════════════════════════════════════════════════════
function UserGuideTh() {
  return (
    <div className="help-content">
      <h2>WikiKai — คู่มือใช้งาน</h2>
      <p>
        Portal สำหรับเปิดดู <strong>knowledge</strong> — แต่ละ knowledge เป็นเอกสาร 1 เรื่อง
        ประกอบด้วยหลาย <strong>page</strong> (tab) เก็บเนื้อหา markdown พร้อม Mermaid diagram, Chart.js
        และ stats card
      </p>

      <h3>โครงสร้างหน้าจอ</h3>
      <ul>
        <li><strong>Sidebar ซ้าย</strong> — รายการ knowledge ทั้งหมด, group ตาม project, เรียงตามล่าสุดอัปเดต</li>
        <li><strong>Content ขวา</strong> — tab strip ของ page + เนื้อหา markdown</li>
        <li><strong>Search box</strong> ด้านบน — กรอง sidebar ด้วย title/tag (ตัวอักษรเดียวก็ได้), หรือ full-text search เนื้อหาทุก page เมื่อพิมพ์ ≥ 3 ตัวอักษร (รองรับภาษาไทย/CJK ผ่าน trigram index)</li>
      </ul>

      <h3>สัญลักษณ์ id — &amp; กับ #</h3>
      <p>ใช้สัญลักษณ์ต่างกันเพื่อไม่ให้สับสนเมื่อเลขซ้ำกัน:</p>
      <table>
        <thead><tr><th>สัญลักษณ์</th><th>หมายถึง</th><th>เจอที่ไหน</th></tr></thead>
        <tbody>
          <tr><td><code>&amp;N</code></td><td>knowledge id (เอกสารทั้งเล่ม / หัวข้อใหญ่)</td><td>badge ใน sidebar, header, info popover</td></tr>
          <tr><td><code>#N</code></td><td>page id (tab ใน document)</td><td>tab strip, แถว meta บรรทัด 2, ผลลัพธ์ search</td></tr>
        </tbody>
      </table>
      <p>
        ตัวอย่าง: <code>&amp;3 #12</code> = page id 12 ที่อยู่ใน knowledge id 3.
        URL ใช้รูปแบบเดียวกัน — <code>&amp;</code> อยู่ใน path, <code>#</code> อยู่ใน fragment:
        <code>/&amp;3/#12:42</code>
      </p>

      <h3>การนำทาง</h3>
      <table>
        <thead><tr><th>การกระทำ</th><th>วิธี</th></tr></thead>
        <tbody>
          <tr><td>เลือก knowledge</td><td>คลิกใน sidebar</td></tr>
          <tr><td>สลับ page</td><td>คลิก tab ด้านบนเนื้อหา</td></tr>
          <tr><td>จัดลำดับ / ย้าย page</td><td>จับ handle ลาก (⋮⋮ โผล่เมื่อ hover ใน sidebar) → ลาก <strong>ขึ้น/ลง</strong> เพื่อจัดลำดับใน topic เดิม หรือวาง <strong>บน topic อื่น</strong> เพื่อย้าย page ไปที่นั่น (ต่อท้าย page ของ topic นั้น). topic เป้าหมายจะ highlight ตอน hover</td></tr>
          <tr><td>เพิ่ม knowledge / page</td><td>เอาเมาส์ชี้ที่ <strong>หัว project</strong> ใน sidebar → คลิก <Kbd>+</Kbd> เพื่อสร้าง knowledge ใหม่ใน project นั้น. ส่วนการเพิ่ม <strong>page</strong> ให้คลิก badge <code>&amp;N</code> (ที่แถว topic ใน sidebar หรือ topbar) → <Kbd>Add page</Kbd>. ทั้งคู่จะถามชื่อก่อน แล้วเปิดรายการใหม่ให้</td></tr>
          <tr><td>กรอง sidebar ตาม project</td><td>คลิกปุ่ม <Kbd>⏷ ทุก project</Kbd> ติดกับโลโก้ <strong>WikiKai</strong> มุมซ้ายบนของ topbar → ติ๊ก / เอาออก. ใน dialog มี input ด้านบน + ปุ่ม <Kbd>+ เพิ่ม</Kbd> สำหรับสร้าง project ว่าง (โผล่ใน picker ทันที — รอย้าย knowledge เข้าไป). ปุ่ม 🗑 ลบ project + knowledge ในนั้นทั้งหมด (ต้องพิมพ์ชื่อยืนยัน)</td></tr>
          <tr><td>Star topic สำคัญ</td><td>คลิกปุ่มดาวบนรายการใน sidebar หรือปุ่มดาวก่อน <Kbd>i</Kbd> ใน header. ปุ่มดาวข้างช่อง filter ใน sidebar ใช้กรองให้เห็นเฉพาะ topic ที่ star ไว้. ค่า star เก็บใน localStorage ของ browser นี้ ไม่ใช่ metadata ที่แชร์กับคนอื่น</td></tr>
          <tr><td>ย้าย knowledge ไปอีก project</td><td>เปิด info popover (<Kbd>i</Kbd>) → คลิกแถว <strong>project</strong> → ช่อง input พร้อม autocomplete project ที่มี. พิมพ์ชื่อ project เดิม หรือชื่อใหม่ก็ได้, Enter = บันทึก, Esc = ยกเลิก. เว้นว่าง = ถอด project ออก</td></tr>
          <tr><td>ดูข้อมูล (session, tokens, prompt)</td><td>คลิกปุ่ม <Kbd>i</Kbd> ด้านซ้ายของ title</td></tr>
          <tr><td>เมนู knowledge (คัดลอก / เพิ่ม page / แก้ชื่อ / ลบ)</td><td>คลิก badge <code>&amp;N</code> — ที่ topbar <strong>หรือ</strong> ที่แถว topic ใน sidebar — เปิดเมนูเดียวกัน: คัดลอก id, คัดลอกเนื้อหา, เพิ่ม page, แก้ชื่อ, ลบ</td></tr>
          <tr><td>ค้นในเนื้อหา</td><td>พิมพ์ในกล่อง search ≥ 3 ตัวอักษร → คลิกผลลัพธ์ → เด้งไปบรรทัดนั้น (ไทย/อังกฤษ/ผสม — substring match)</td></tr>
          <tr><td>สลับ light/dark</td><td>คลิก <Kbd>☾</Kbd> / <Kbd>☀</Kbd></td></tr>
          <tr><td>Refresh</td><td>คลิก <Kbd>↻</Kbd></td></tr>
          <tr><td>เปิด help (หน้านี้)</td><td>คลิก <Kbd>?</Kbd></td></tr>
          <tr><td>ปิด dialog</td><td>กด <Kbd>Esc</Kbd> หรือคลิกข้างนอก</td></tr>
        </tbody>
      </table>

      <h3>URL deep-link (share ได้)</h3>
      <p>
        Knowledge อยู่ใน <strong>path</strong> (ใช้สัญลักษณ์ <code>&amp;</code>), page อยู่ใน
        <strong>fragment</strong> (หลัง <code>#</code>) — URL bar บอกตำแหน่งได้ในตัวเอง:
      </p>
      <table>
        <thead><tr><th>URL</th><th>เปิดที่ไหน</th></tr></thead>
        <tbody>
          <tr><td><code>/&amp;2</code></td><td>knowledge &amp;2, เปิด tab แรกอัตโนมัติ</td></tr>
          <tr><td><code>/&amp;2/#5</code></td><td>knowledge &amp;2, เปิด tab page #5</td></tr>
          <tr><td><code>/&amp;2/#5:42</code></td><td>knowledge &amp;2, page #5, scroll ใกล้บรรทัด 42</td></tr>
          <tr><td colSpan={2} style={{ paddingTop: 8, color: "var(--text-3)" }}>URL รูปแบบเก่ายังใช้ได้:</td></tr>
          <tr><td><code>/#&amp;2/5:42</code></td><td>เทียบเท่า <code>/&amp;2/#5:42</code></td></tr>
          <tr><td><code>/#2/5:42</code></td><td>เทียบเท่า <code>/&amp;2/#5:42</code> (รูปแบบเดิมที่สุด)</td></tr>
        </tbody>
      </table>

      <h3>แก้ไข / ลบ</h3>
      <ul>
        <li><strong>Edit raw</strong> — เปิด modal แก้ markdown ทั้งหน้า (raw .md), Save แล้วระบบ render ใหม่ทันที</li>
        <li><strong>Delete page</strong> — ลบ page เดียว (page อื่นใน knowledge ยังอยู่)</li>
      </ul>

      <h3>ฟีเจอร์ในเนื้อหา</h3>
      <ul>
        <li><strong>Mermaid diagram</strong> — Flowchart, ER, Sequence, Gantt, State (render ฝั่ง browser, เปลี่ยน theme ตาม light/dark)</li>
        <li><strong>Chart.js</strong> — Bar, Line, Doughnut ฯลฯ (interactive, hover ดู tooltip). ใช้ <code>```chart</code> สำหรับ 1 กราฟ, หรือ <code>```chart-grid</code> รับ JSON array เพื่อแสดงหลายกราฟเรียงข้างกันแบบ responsive</li>
        <li><strong>Stats card</strong> — กล่องตัวเลขสำคัญ (สี: purple/blue/green/amber/red/cyan)</li>
        <li><strong>Step cards</strong> — <code>```steps</code> รับ JSON array ของ <code>{`{ title, body }`}</code> (body รองรับ markdown). เลขกลม auto-number ลอยอยู่บนหัว card, จัด grid อัตโนมัติ</li>
        <li><strong>HTML embed</strong> — <code>```html-embed</code> สำหรับ <em>เนื้อหายืดหยุ่น</em>: ตารางที่ตกแต่งได้เต็มที่ (สีพื้นแถว, col-span, sticky header), การ์ด/grid layout เอง, SVG inline, <code>&lt;details&gt;</code>, iframe. ใช้ inline <code>style</code> + <code>&lt;style&gt;</code> scoped + class ได้ทุกอย่าง. <code>&lt;script&gt;</code> ไม่ทำงานโดยดีไซน์</li>
        <li><strong>Inline image (แนะนำ)</strong> — ภาพที่ <code>add_image</code> อัปโหลดแล้วใช้ <code>/img/&lt;hash&gt;.&lt;ext&gt;</code> ฝังด้วย <code>![alt](/img/…)</code>: ใน paragraph, list item, หรือ cell ของ markdown table. ขนาดผ่าน title slot — <code>![alt](src "WxH")</code> / <code>"Wx"</code> / <code>"xH"</code> / <code>"caption w=300 h=200"</code>. <strong>Drag ขอบขวา/ล่าง/มุมล่างขวา</strong> ของภาพเพื่อปรับขนาด — ค่าใหม่ persist กลับ title slot ทันที. <strong>คลิกที่ภาพ</strong> เพื่อเปิด lightbox เต็มจอ. Aspect ratio รักษาเสมอ (max-* + auto)</li>
        <li><strong>Image gallery (<code>```images</code> fence)</strong> — ใช้เฉพาะกรณีอยากได้ thumbnail grid 4+ ภาพเรียงกัน. JSON array <code>{`{ src, alt?, caption? }`}</code>; คลิก thumbnail → lightbox. ถ้า 1–3 ภาพ ใช้ markdown ปกติด้านบนดีกว่า (มี lightbox + resize handle อยู่แล้ว)</li>
        <li><strong>การนำภาพเข้า (สำหรับ AI)</strong> — <code>add_image</code> รับ <strong><code>{`{ path }`}</code></strong> เพื่อ import ไฟล์ที่อยู่บนเครื่อง server อยู่แล้ว (server อ่านจาก disk เอง — ไม่ส่ง base64 จึงประหยัด token มาก) หรือ <code>{`{ data_base64, mime_type }`}</code> สำหรับไฟล์ที่อยู่ที่อื่น. การ import ด้วย path จะปิดไว้จนกว่า server จะตั้ง <code>WIKIKAI_IMAGE_IMPORT_ROOTS</code></li>
        <li><strong>Interactive checkbox</strong> — เขียน GFM task list <code>- [ ] item</code> / <code>- [x] item</code> ใน list ปกติ; renderer แปลงเป็น checkbox จริงคลิกได้. <strong>ตาราง markdown ปกติก็ได้</strong> — ใส่ <code>[ ]</code> หรือ <code>[x]</code> ที่ไหนก็ได้ใน cell (ต้น, กลาง, หลายอันใน cell เดียว) — ทุกอันเป็น checkbox คลิกได้ใช้ task-index counter เดียวกัน. อยากให้เป็น text จริงให้ใส่ backtick ครอบ — เช่น <code>`[x]`</code>. <code>&lt;input type="checkbox"&gt;</code> ใน <code>html-embed</code> ก็คลิกได้. <em>คลิกแล้ว save กลับ markdown ทันที</em> (bump page version + revision snapshot + FTS reindex). AI ใช้ MCP tool <code>toggle_task</code> ก็ได้ผลเดียวกัน (เช่น "tick task 3")</li>
        <li><strong>Image ใน HTML embed</strong> — หรือใช้ <code>&lt;img src="/img/..." /&gt;</code> (หรือ URL ภายนอก) ใน <code>html-embed</code> เมื่อต้องการภาพคู่กับ text ใน layout เอง. URL ภายนอกก็ได้ แต่เฉพาะ <code>/img/</code> ภายในที่ <code>get_image</code> ดูได้ + กู้คืนได้</li>
        <li><strong>Block id <code>@N</code> + caption</strong> — rich block ทุกชนิด + ตาราง markdown ได้ <code>@N</code> ระดับ global. annotation มี caption ได้: <code>{`{@123 "คำบรรยายภาพ"}`}</code> — render เป็นข้อความ italic เล็กใต้ block (เหมือน HTML <code>&lt;figcaption&gt;</code>). AI ถาม "what is @123?" ผ่าน <code>get_block({"{ id, summary: true }"})</code> ได้ราคาถูก ๆ — ไม่ต้องดึง body</li>
        <li><strong>Tables, code blocks</strong> — markdown ปกติ + syntax highlight (Shiki)</li>
        <li><strong>Heading anchor</strong> — hover ที่ heading จะมี <code>#</code> สำหรับ copy URL ของหัวข้อ</li>
      </ul>

      <h3>การสร้างเนื้อหา</h3>
      <p>
        Portal นี้ <strong>รับเนื้อหาผ่าน MCP</strong> — ไม่มีปุ่ม "Create new" ในหน้า UI
        เพราะการสร้างจะทำผ่าน MCP client (เช่น Claude Code, Claude Desktop) ดูรายละเอียดที่ tab{" "}
        <em>MCP</em>
      </p>

      <h3>สิทธิ์ระดับโปรเจกต์</h3>
      <p>
        Admin สามารถกำหนดสิทธิ์ <code>view</code> หรือ <code>edit</code> ให้ user รายคนต่อ
        โปรเจกต์ผ่านเมนู <strong>Manage users → Edit → Project access</strong>. User ที่ไม่ได้รับ
        สิทธิ์จะมองไม่เห็นเนื้อหาของโปรเจกต์นั้นเลย — sidebar, search, และ MCP API กรองให้อัตโนมัติ.
        Admin มีสิทธิ์เต็มทุกโปรเจกต์โดยอัตโนมัติ.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MCP GUIDE — English
// ═══════════════════════════════════════════════════════════════
function McpGuideEn() {
  return (
    <div className="help-content">
      <h2>MCP — For MCP Clients</h2>
      <p>
        WikiKai exposes an <strong>MCP Streamable HTTP endpoint</strong> at <code>/mcp</code>. An
        MCP client (e.g. Claude Code) connects and calls tools to create, read, or edit knowledge.
      </p>

      <h3>Register the MCP server</h3>
      <p>Add to <code>~/.claude/settings.json</code>:</p>
      <pre><code>{`{
  "mcpServers": {
    "wikikai": {
      "type": "http",
      "url": "http://<your-lan-ip>:3939/mcp"
    }
  }
}`}</code></pre>
      <p>Restart Claude Code — the client will see all the tools below.</p>

      <h3>Tools — Knowledge (whole documents)</h3>
      <table>
        <thead><tr><th>Tool</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>add_knowledge</code></td><td>Create a new document. Accepts title + project + session_id + user_prompt + tokens_used + optional first_page. Returns <code>{`{ id, url }`}</code></td></tr>
          <tr><td><code>edit_knowledge</code></td><td>Update metadata (title / project / tags / session_id / user_prompt / tokens_used) — content is unchanged</td></tr>
          <tr><td><code>list_knowledge</code></td><td>List metadata only (filterable by project / tag / session_id / search) — content is not returned, saving tokens</td></tr>
          <tr><td><code>get_knowledge</code></td><td>Return metadata + page list (with line counts) — useful for discovering what pages exist</td></tr>
          <tr><td><code>delete_knowledge</code></td><td>Delete a document and all its pages (cascade)</td></tr>
          <tr><td><code>get_outline</code></td><td>Return the tree of page titles + heading hierarchy <strong>without body</strong> — cheapest way to scan a doc, then <code>read_page</code> only what you need</td></tr>
        </tbody>
      </table>

      <h3>Tools — Pages (chapters / tabs)</h3>
      <table>
        <thead><tr><th>Tool</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>add_page</code></td><td>Add a page to a knowledge — accepts title + content + summary + keywords + position</td></tr>
          <tr><td><code>edit_page</code></td><td>Update content / title / summary / keywords (replace mode)</td></tr>
          <tr><td><code>append_page</code></td><td>Append text to the end of a page <strong>without re-reading it first</strong> — fast and race-safe</td></tr>
          <tr><td><code>delete_page</code></td><td>Delete one page; remaining pages compact their positions automatically</td></tr>
          <tr><td><code>list_pages</code></td><td>List all pages (every field except content)</td></tr>
          <tr><td><code>reorder_pages</code></td><td>Change tab order — pass an array of page_ids as the new order (must be a permutation of all existing pages)</td></tr>
          <tr><td><code>move_page_to_knowledge</code></td><td>Move a page into a <strong>different</strong> knowledge — keeps its id, history + images; lands at <code>position</code> or the end. (Humans: drag a page's handle onto another topic in the sidebar.)</td></tr>
        </tbody>
      </table>

      <h3>Tools — Fine-grained editing</h3>
      <table>
        <thead><tr><th>Tool</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>read_page</code></td><td>Read a page or just a line range — returns content + total_lines + <strong>parent knowledge structure</strong> (title + sibling pages with <code>is_current</code>) so you don't need a separate <code>get_knowledge</code> call. <strong>Two modes</strong>: <code>mode: "summary"</code> (DEFAULT) collapses every annotated rich block + table to a one-line <code>[@N kind 25 lines: caption]</code> placeholder + adds a <code>blocks</code> index — 5–10× token saving. <code>mode: "full"</code> returns verbatim markdown with <code>hash</code>; switch to it immediately before any <code>edit_lines</code>. <strong>html-embed inline <code>style="..."</code> is stripped by default</strong> in full mode (saves 50–70%/block); pass <code>include_styles: true</code> when working on presentation</td></tr>
          <tr><td><code>edit_lines</code></td><td>Replace lines [start..end] with new_text. ⚠️ Line numbers shift after every edit — pass <code>expected_hash</code> from a recent <code>read_page</code> to gate against stale edits</td></tr>
          <tr><td><code>edit_section</code></td><td><strong>Recommended</strong> — replace the body under an exact heading line (e.g. <code>"## 3. Performance"</code>) up to the next equal-or-higher heading. More stable than line-based edits</td></tr>
          <tr><td><code>replace_text</code></td><td>Literal find/replace across one page or every page of a knowledge</td></tr>
        </tbody>
      </table>

      <h3>Tools — Search + helper</h3>
      <table>
        <thead><tr><th>Tool</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>search</code></td><td>SQLite FTS5 across content / title / keywords. Returns <code>{`{ kid, pid, line, snippet, url }`}</code> for every hit</td></tr>
          <tr><td><code>get_block</code></td><td>Fetch a rich block by its <code>@N</code> id in one call. Returns <code>{`{ kind, caption, source, inner, line_start, line_end, page_id, page_title, knowledge_id, url }`}</code>. Works for fenced rich blocks <em>and</em> markdown tables. <code>summary: true</code> → skip body; for tables you get <code>columns</code> + <code>row_count</code> + caption instead — cheap probe of large tables. <code>include_styles: true</code> → keep inline <code>style</code> attrs (html-embed kind only; default strips them, saves 50–70%)</td></tr>
          <tr><td><code>set_block_caption</code></td><td>Set / update / clear the caption on a block's annotation (rewrites <code>{`{@N "caption"}`}</code> in source). Args: <code>{`{ id, caption }`}</code> — pass <code>null</code> or empty string to remove. Caption is the same idea as an HTML <code>&lt;figcaption&gt;</code> — short text describing what the block IS, so future <code>get_block({"{ summary: true }"})</code> probes answer "what is @47?" cheaply</td></tr>
          <tr><td><code>get_table_row</code></td><td>Get a single data row of a markdown-table block as a <code>{`{ columnName: cellText }`}</code> object. Args: <code>{`{ block_id, index }`}</code> — <code>index</code> is 0-based; negative wraps from end (<code>-1</code> = last row). When you don't know the index, use <code>find_table_rows</code> instead</td></tr>
          <tr><td><code>find_table_rows</code></td><td>Search inside a table without pulling the whole body. Args: <code>{`{ block_id, q?, where?, columns?, limit? }`}</code> — <code>q</code> = substring (case-insensitive), <code>where</code> = exact column=value (AND across keys), <code>columns</code> = restrict <code>q</code> to these columns, <code>limit</code> default 50 / max 500. Returns <code>{`{ matches: [{row_index, columns, source_line, url}], total_matched, truncated }`}</code></td></tr>
          <tr><td><code>get_example</code></td><td>Markdown reference. <strong>3 read modes</strong> to keep tokens low: <code>outline_only:true</code> (heading list only) · <code>line_start/line_end</code> (slice) · default (full). <code>kind</code> = full / minimal / mermaid / chart / stats / steps / er / html</td></tr>
          <tr><td><code>get_prompt_log</code></td><td>Read the rolling prompt log for a knowledge. Every mutation tool accepts an opt-in <code>user_prompt</code> field; when present it's truncated to 500 chars and stored against the resulting page + version. Returns <code>{`{ page_id?, page_version?, tool_name, prompt, created_at }`}</code> entries newest-first — use to answer "why did revision N happen?"</td></tr>
          <tr><td><code>toggle_task</code></td><td>Flip a plain <code>- [ ]</code> / <code>- [x]</code> task on a page. Args: <code>{`{ page_id, index }`}</code> where <code>index</code> is the 0-based position of the checkbox top-down (skipping any inside fenced code). Same write-back path the rendered UI uses</td></tr>
        </tbody>
      </table>

      <h3>Block ids (<code>@N</code>) + captions</h3>
      <p>
        Every rendered rich block (mermaid / chart / chart-grid / stats / steps / html-embed) is stamped with a globally-unique id. The source carries it as <code>```mermaid {`{@123}`}</code>; the UI shows a small <code>@123</code> pill in the block's top-left corner on hover (click for a menu: copy or jump-to-edit). Users can then say "update @47" and you can <code>get_block({"{ id: 47 }"})</code> directly without searching.
      </p>
      <p>
        <strong>Captions</strong> — annotation can carry a quoted caption: <code>```mermaid {`{@123 "Architecture: API → DB"}`}</code>. Renders as small italic text directly below the block (semantically the same as an HTML <code>&lt;figcaption&gt;</code> / a Word figure caption). AI can probe "what is @123?" cheaply via <code>get_block({"{ id, summary: true }"})</code> — returns the caption without the body. Set/update/clear via <code>set_block_caption({"{ id, caption }"})</code>.
      </p>
      <p>
        <strong>Read whole pages efficiently</strong> — <code>read_page({"{ page_id, mode: \"summary\" }"})</code> returns a skeleton where every annotated block + table collapses to a one-line <code>[@N kind: caption]</code> placeholder. AI sees the page's structure + every block's caption in 5–10× fewer tokens than a full read, then picks which <code>@N</code> to fetch in full via <code>get_block</code>.
      </p>
      <p>
        <strong>Plain markdown tables</strong> also get an id — author it as a trailing <code>{`{@N}`}</code> line under the table (with one blank line in between):
      </p>
      <pre style={{ fontSize: 12, lineHeight: 1.4 }}>{`| col a | col b |
|-------|-------|
| 1     | 2     |

{@123}`}</pre>
      <p style={{ color: "var(--text-2)", fontSize: 12 }}>
        The renderer attaches it as <code>data-block-id</code> on the <code>&lt;table&gt;</code> so search-flash works. <code>injectBlockIds</code> auto-inserts the annotation on save when missing. Three read tools, pick the cheapest:
      </p>
      <ul>
        <li><code>get_block({"{ id, summary: true }"})</code> — probe schema only (<code>columns</code> + <code>row_count</code>), no body</li>
        <li><code>get_table_row({"{ block_id, index }"})</code> — one row by index (<code>-1</code> = last)</li>
        <li><code>find_table_rows({"{ block_id, q?, where?, columns?, limit? }"})</code> — search inside the table (substring or exact column match) without pulling the whole body</li>
        <li><code>get_block({"{ id }"})</code> — full source/inner. Use sparingly for tables &gt; ~100 rows</li>
      </ul>

      <h4>Converting a block to a different type — keep the <code>@N</code></h4>
      <p>
        When AI converts <code>@123</code> from a markdown table to an <code>html-embed</code> (or stats → mermaid, etc.), the id should stay so existing <code>@123</code> references keep working. Best practice: include the annotation in the new source — fence: <code>{"```html-embed {@123}"}</code>; table: trailing <code>{"{@123}"}</code> line. <strong>If the new source omits it</strong>, <code>edit_lines</code> and <code>edit_section</code> auto-preserve every <code>{"{@N}"}</code> from the replaced region by injecting it into the first eligible slot in the new content (fence info / table-trailing line), in source order. Single-block conversions always keep the id; N:1 merges keep the first id, lose the rest.
      </p>

      <h3>Important fields</h3>
      <ul>
        <li><strong>session_id</strong> — Claude Code chat session UUID (works with <code>claude --resume &lt;id&gt;</code>). Available from a <code>UserPromptSubmit</code> hook's stdin JSON</li>
        <li><strong>user_prompt</strong> — the user's verbatim message that triggered the change. Accepted by <em>every</em> mutation tool (add_knowledge / add_page / edit_page / append_page / edit_lines / edit_section / replace_text / edit_knowledge). When provided, the server appends a row to the <strong>prompt log</strong> linked to the knowledge + (optionally) page. Capped at 500 chars on insert. Read back with <code>get_prompt_log</code>; the info popover shows the same timeline.</li>
        <li><strong>tokens_used</strong> — optional, total tokens the client consumed (input + output) — surfaced in the info popover for cost tracking</li>
        <li><strong>project</strong> — group key (e.g. repo name) used to group entries in the sidebar</li>
        <li><strong>tags</strong> (knowledge) vs <strong>keywords</strong> (page) — tags filter knowledge entries; keywords add weight to FTS search on a page</li>
      </ul>

      <h3>Block-choice guidance — pick a prepared block FIRST</h3>
      <p>
        WikiKai gives you 6 prepared semantic blocks + plain markdown. Reach for <code>html-embed</code> only when no prepared block fits AND a custom HTML layout meaningfully improves understanding (gradient status cards, color-coded decision matrix, badges + flex layout, <code>&lt;details&gt;</code> accordions, inline SVG, iframes). Prepared blocks are cheaper to read (no inline-style noise), get richer tooling (<code>find_table_rows</code>, <code>get_table_row</code>, chart re-themes), and render consistently across light/dark themes.
      </p>
      <table>
        <thead><tr><th>You want to show…</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td>Flow, sequence, ER, gantt, state, mindmap</td><td><code>```mermaid</code></td></tr>
          <tr><td>Numeric series / comparison / trend</td><td><code>```chart</code> · <code>```chart-grid</code></td></tr>
          <tr><td>KPI numbers, dashboard headline figures</td><td><code>```stats</code></td></tr>
          <tr><td>Ordered procedure / how-to / runbook</td><td><code>```steps</code></td></tr>
          <tr><td>Tabular data</td><td><strong>plain markdown table</strong> — gets <code>@N</code>, <code>[ ]</code> in cells, <code>find_table_rows</code> search</td></tr>
          <tr><td>4+ side-by-side screenshots as gallery</td><td><code>```images</code></td></tr>
          <tr><td>Single image inline / in prose / table cell</td><td>plain markdown <code>{`![alt](src "WxH")`}</code> — drag-resize + click-lightbox built in</td></tr>
          <tr><td>Custom layout with row/col colors, gradient cards, badges, custom <code>&lt;details&gt;</code>, inline SVG, iframe</td><td><code>```html-embed</code> (last resort)</td></tr>
        </tbody>
      </table>

      <h3>Token-efficient reads (defaults that just work)</h3>
      <p>
        Three savings, all opt-out (default behavior is the cheap path):
      </p>
      <ul>
        <li><strong><code>read_page({"{ page_id }"})</code> — summary by default</strong>. Every annotated rich block + table collapses to one <code>[@N kind 25 lines: caption]</code> line (or <code>[@N table 12r × 3c: caption]</code>). AI sees the page's outline + every block's caption + line count without paying for diagram source / chart JSON / table rows. <strong>`hash` is omitted</strong> — pass <code>mode: "full"</code> when you're going to edit.</li>
        <li><strong><code>get_block({"{ summary: true }"})</code></strong> — returns caption + kind + line range only (no source/inner). For tables also returns <code>columns</code> + <code>row_count</code>. Use to answer "what is @47?" without fetching the body.</li>
        <li><strong>Inline <code>style="..."</code> stripping</strong> — applied by default to every <code>html-embed</code> body returned from <code>get_block</code> or <code>read_page</code>. Saves 50–70% per block. Pass <code>include_styles: true</code> when working on presentation. <code>hash</code> is omitted when stripping occurred — re-read with <code>include_styles: true</code> to get a hash for <code>edit_lines</code>.</li>
      </ul>
      <p style={{ color: "var(--text-2)", fontSize: 12 }}>
        Pair these with <strong>captions</strong>: write <code>{`{@123 "Short description"}`}</code> on every non-trivial block so all three savings above stay useful (a captionless block in summary mode just shows <code>[@123 mermaid]</code> which doesn't help AI decide whether to fetch).
      </p>

      <h3>Recommended workflow</h3>
      <ol>
        <li>
          <strong>Scan an example cheaply:</strong> <code>get_example({"{ kind: 'full', outline_only: true }"})</code> →
          you get the heading list + total_lines without the body (~10× cheaper)
        </li>
        <li>
          <strong>Read only the section you need:</strong> looking at the outline, pick a heading at line N → call{" "}
          <code>get_example({"{ kind: 'full', line_start: N, line_end: N+20 }"})</code>
        </li>
        <li><strong>Create:</strong> <code>add_knowledge</code> with a <code>first_page</code> — include session_id + user_prompt</li>
        <li><strong>Add pages:</strong> use <code>add_page</code> per chapter — one page per major heading works well</li>
        <li><strong>Come back later:</strong> <code>get_outline</code> to scan → <code>read_page</code> the part of interest → <code>edit_section</code> to change the body. Or if the user refers to a block by id ("update @47"): <code>get_block({"{ id: 47 }"})</code> → <code>read_page</code> for a fresh hash → <code>edit_lines</code></li>
        <li><strong>Recall:</strong> use <code>search</code> to find the right spot and continue from there</li>
      </ol>
      <p>
        🎓 The <code>📘 คู่มือใช้งาน WikiKai — Tutorial</code> knowledge document (URL <code>/&amp;4</code>)
        is a live, rendered example covering every fence type — also browsable via <code>get_outline({"{ knowledge_id: 4 }"})</code>
        + <code>read_page({"{ page_id: N, line_start, line_end }"})</code>.
      </p>

      <h3>Example call (TypeScript SDK)</h3>
      <pre><code>{`import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from
  "@modelcontextprotocol/sdk/client/streamableHttp.js";

const c = new Client({ name: "demo", version: "0" });
await c.connect(new StreamableHTTPClientTransport(
  new URL("http://<your-lan-ip>:3939/mcp")
));

await c.callTool({
  name: "add_knowledge",
  arguments: {
    title: "My architecture notes",
    project: "myrepo",
    session_id: "550e8400-...",
    user_prompt: "Explain the architecture",
    tokens_used: 1240,
    first_page: {
      title: "Overview",
      content: "# Hi\\n\\n\\\`\\\`\\\`mermaid\\nflowchart LR\\n  A-->B\\n\\\`\\\`\\\`"
    }
  }
});`}</code></pre>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MCP GUIDE — Thai
// ═══════════════════════════════════════════════════════════════
function McpGuideTh() {
  return (
    <div className="help-content">
      <h2>MCP — สำหรับ MCP Client</h2>
      <p>
        WikiKai expose <strong>MCP Streamable HTTP endpoint</strong> ที่ <code>/mcp</code> — MCP client
        (เช่น Claude Code) เชื่อมต่อแล้วเรียก tool เพื่อสร้าง / อ่าน / แก้ไข knowledge ได้
      </p>

      <h3>ลงทะเบียน MCP server</h3>
      <p>เพิ่มใน <code>~/.claude/settings.json</code>:</p>
      <pre><code>{`{
  "mcpServers": {
    "wikikai": {
      "type": "http",
      "url": "http://<your-lan-ip>:3939/mcp"
    }
  }
}`}</code></pre>
      <p>Restart Claude Code → client จะเห็น tool ทั้งหมดของ WikiKai</p>

      <h3>Tools — Knowledge (เอกสารทั้งเล่ม)</h3>
      <table>
        <thead><tr><th>Tool</th><th>หน้าที่</th></tr></thead>
        <tbody>
          <tr><td><code>add_knowledge</code></td><td>สร้างเอกสารใหม่. รับ title + project + session_id + user_prompt + tokens_used + first_page (optional). คืน <code>{`{ id, url }`}</code></td></tr>
          <tr><td><code>edit_knowledge</code></td><td>แก้ metadata (title/project/tags/session_id/user_prompt/tokens_used) — ไม่แตะ content</td></tr>
          <tr><td><code>list_knowledge</code></td><td>list metadata เท่านั้น (กรอง project/tag/session_id/search) — ไม่ส่ง content เพื่อประหยัด token</td></tr>
          <tr><td><code>get_knowledge</code></td><td>คืน metadata + page list (line count ต่อ page) — ใช้รู้ว่ามี page อะไรบ้าง</td></tr>
          <tr><td><code>delete_knowledge</code></td><td>ลบเอกสารและทุก page ใน cascade</td></tr>
          <tr><td><code>get_outline</code></td><td>คืน tree ของ page title + heading hierarchy <strong>ไม่มี body</strong> — สแกนได้เร็ว, ค่อย <code>read_page</code> เฉพาะส่วนสนใจ</td></tr>
        </tbody>
      </table>

      <h3>Tools — Pages (chapters/tabs)</h3>
      <table>
        <thead><tr><th>Tool</th><th>หน้าที่</th></tr></thead>
        <tbody>
          <tr><td><code>add_page</code></td><td>เพิ่ม page ใหม่ใน knowledge — รับ title + content + summary + keywords + position</td></tr>
          <tr><td><code>edit_page</code></td><td>แก้ content/title/summary/keywords (replace mode)</td></tr>
          <tr><td><code>append_page</code></td><td>ต่อท้าย content ของ page <strong>โดยไม่ต้องอ่านมาก่อน</strong> — เร็ว, ไม่ race</td></tr>
          <tr><td><code>delete_page</code></td><td>ลบ page เดียว (position ของ page อื่นจะ compact ขึ้นเอง)</td></tr>
          <tr><td><code>list_pages</code></td><td>list page ทุก field ยกเว้น content</td></tr>
          <tr><td><code>reorder_pages</code></td><td>เปลี่ยนลำดับ tab — ส่ง array ของ page_id ใน order ใหม่ (permutation)</td></tr>
          <tr><td><code>move_page_to_knowledge</code></td><td>ย้าย page ไป knowledge <strong>อื่น</strong> — คง id, history + รูป; วางที่ <code>position</code> หรือท้ายสุด. (คน: ลาก handle ของ page ไปวางบน topic อื่นใน sidebar)</td></tr>
        </tbody>
      </table>

      <h3>Tools — แก้ไขแบบละเอียด</h3>
      <table>
        <thead><tr><th>Tool</th><th>หน้าที่</th></tr></thead>
        <tbody>
          <tr><td><code>read_page</code></td><td>อ่าน page หรือเฉพาะ line range — คืน content + total_lines + <strong>โครงสร้าง knowledge ของ page นั้น</strong> (title + รายการ page พี่น้องพร้อม <code>is_current</code>) — ไม่ต้องเรียก <code>get_knowledge</code> เพิ่ม. <strong>2 modes</strong>: <code>mode: "summary"</code> (DEFAULT) ยุบ rich block + ตาราง annotated เป็น <code>[@N kind 25 lines: caption]</code> + เพิ่ม <code>blocks</code> index — ประหยัด token 5–10 เท่า. <code>mode: "full"</code> คืน markdown ครบพร้อม <code>hash</code>; เปลี่ยนไปใช้ทันทีก่อนเรียก <code>edit_lines</code>. <strong>html-embed inline <code>style="..."</code> ถูกตัดเป็น default ใน full mode</strong> (ประหยัด 50–70%/block); ส่ง <code>include_styles: true</code> ตอนทำงานกับ design</td></tr>
          <tr><td><code>edit_lines</code></td><td>แทนที่ line [start..end] ด้วย new_text. ⚠️ Line shift ทุกครั้งที่แก้ — ใส่ <code>expected_hash</code> จาก read_page เพื่อ gate กัน stale edit</td></tr>
          <tr><td><code>edit_section</code></td><td><strong>แนะนำ</strong> — แทน body ใต้ heading exact match (เช่น <code>"## 3. Performance"</code>) จนถึง heading ระดับเท่าหรือสูงกว่าถัดไป stable กว่า line-based</td></tr>
          <tr><td><code>replace_text</code></td><td>find/replace literal string ใน 1 page หรือทุก page ของ knowledge</td></tr>
        </tbody>
      </table>

      <h3>Tools — Search + Helper</h3>
      <table>
        <thead><tr><th>Tool</th><th>หน้าที่</th></tr></thead>
        <tbody>
          <tr><td><code>search</code></td><td>SQLite FTS5 ค้นข้าม content/title/keywords. คืน <code>{`{ kid, pid, line, snippet, url }`}</code> ทุก hit</td></tr>
          <tr><td><code>get_block</code></td><td>ดึง rich block ด้วย <code>@N</code> id ใน 1 call. คืน <code>{`{ kind, caption, source, inner, line_start, line_end, page_id, page_title, knowledge_id, url }`}</code>. ใช้ได้ทั้ง fenced rich block <em>และ</em> markdown table. <code>summary: true</code> → ข้าม body; สำหรับตารางได้ <code>columns</code> + <code>row_count</code> + caption — probe ตารางใหญ่แบบประหยัด token. <code>include_styles: true</code> → เก็บ inline <code>style</code> ไว้ (เฉพาะ html-embed; default ตัด ประหยัด 50–70%)</td></tr>
          <tr><td><code>set_block_caption</code></td><td>ตั้ง / อัปเดต / ล้าง caption ของ block (เขียน <code>{`{@N "caption"}`}</code> ใน source). Args: <code>{`{ id, caption }`}</code> — ส่ง <code>null</code> หรือ empty string เพื่อล้าง. Caption คือคำบรรยายภาพ (เหมือน HTML <code>&lt;figcaption&gt;</code>) — สั้น ๆ บอกว่า block นี้คืออะไร เพื่อ <code>get_block({"{ summary: true }"})</code> ในอนาคตตอบ "@47 คืออะไร" ได้ราคาถูก ๆ</td></tr>
          <tr><td><code>get_table_row</code></td><td>ดึง 1 แถวข้อมูลของ markdown-table block เป็น <code>{`{ columnName: cellText }`}</code>. Args: <code>{`{ block_id, index }`}</code> — <code>index</code> เริ่มที่ 0; เลขลบนับจากท้าย (<code>-1</code> = แถวสุดท้าย). ถ้าไม่รู้ index ใช้ <code>find_table_rows</code> แทน</td></tr>
          <tr><td><code>find_table_rows</code></td><td>ค้นในตารางโดยไม่ต้องดูดทั้ง body. Args: <code>{`{ block_id, q?, where?, columns?, limit? }`}</code> — <code>q</code> = substring (case-insensitive), <code>where</code> = exact column=value (AND), <code>columns</code> = จำกัด <code>q</code> ให้ค้นแค่บางคอลัมน์, <code>limit</code> default 50 / max 500. คืน <code>{`{ matches: [{row_index, columns, source_line, url}], total_matched, truncated }`}</code></td></tr>
          <tr><td><code>get_example</code></td><td>ดูตัวอย่าง markdown. <strong>3 โหมดอ่าน</strong> เพื่อประหยัด token: <code>outline_only:true</code> (เห็นแค่ heading) · <code>line_start/line_end</code> (slice) · default (full). <code>kind</code> = full / minimal / mermaid / chart / stats / steps / er / html</td></tr>
          <tr><td><code>get_prompt_log</code></td><td>อ่าน log ของ <code>user_prompt</code> ใน knowledge. ทุก mutation tool รับ <code>user_prompt</code> เป็น opt-in — เมื่อส่งมา server ตัดที่ 500 ตัวอักษรแล้วผูกกับ page + version ที่เกิดจากคำสั่งนั้น. คืน entry แบบใหม่สุดก่อน (page_id?, page_version?, tool_name, prompt, created_at). ใช้ตอบ "ทำไม revision N ถึงเกิด"</td></tr>
          <tr><td><code>toggle_task</code></td><td>กลับสถานะ <code>- [ ]</code> / <code>- [x]</code> ที่หน้านั้น. Args: <code>{`{ page_id, index }`}</code> โดย <code>index</code> เป็นเลข 0-based นับจากบนลงล่าง (ข้าม task ใน fenced code). เส้นทางเดียวกับ web UI ตอนคลิก checkbox</td></tr>
        </tbody>
      </table>

      <h3>Block id (<code>@N</code>) + caption</h3>
      <p>
        ทุก rich block (mermaid / chart / chart-grid / stats / steps / html-embed) ที่ render จะได้เลข <code>@N</code> แบบ global. ใน source markdown ติดเป็น <code>```mermaid {`{@123}`}</code>; UI แสดง pill <code>@123</code> มุมซ้ายบนของ block ตอน hover (คลิกเปิดเมนู: copy หรือเข้า editor ที่ block นั้น). User บอก "อัพเดต @47" → <code>get_block({"{ id: 47 }"})</code> ได้เลย ไม่ต้องค้นเอง.
      </p>
      <p>
        <strong>Caption (คำบรรยายภาพ)</strong> — annotation มีคำบรรยายได้: <code>```mermaid {`{@123 "Architecture: API → DB"}`}</code>. แสดงเป็นข้อความ italic เล็กสีจางใต้ block (semantic เดียวกับ HTML <code>&lt;figcaption&gt;</code> หรือ caption ในเอกสารทั่วไป). AI ใช้ <code>get_block({"{ id, summary: true }"})</code> จะได้ caption โดยไม่ต้องดึง body — ตอบคำถาม "@123 คืออะไร" ราคาถูก ๆ. ตั้ง/อัปเดต/ล้างด้วย <code>set_block_caption({"{ id, caption }"})</code>.
      </p>
      <p>
        <strong>อ่านทั้งหน้าให้ประหยัด token</strong> — <code>read_page({"{ page_id, mode: \"summary\" }"})</code> คืน skeleton ที่ทุก block + ตารางที่มี <code>@N</code> ยุบเป็นบรรทัดเดียว <code>[@N kind: caption]</code>. AI เห็นโครงสร้างหน้า + caption ของทุก block ใช้ token น้อยกว่า full read 5–10 เท่า. แล้วเลือก fetch เฉพาะ <code>@N</code> ที่ต้องใช้ผ่าน <code>get_block</code>.
      </p>
      <p>
        <strong>ตาราง markdown</strong> ก็ได้ <code>@N</code> เหมือนกัน — เขียนเป็นบรรทัด <code>{`{@N}`}</code> ใต้ตาราง (เว้น 1 บรรทัดก่อน):
      </p>
      <pre style={{ fontSize: 12, lineHeight: 1.4 }}>{`| col a | col b |
|-------|-------|
| 1     | 2     |

{@123}`}</pre>
      <p style={{ color: "var(--text-2)", fontSize: 12 }}>
        renderer แปะเป็น <code>data-block-id</code> บน <code>&lt;table&gt;</code> ให้ — search-flash ใช้งานได้. <code>injectBlockIds</code> เติม annotation ให้อัตโนมัติตอน save. มี 3 ทางอ่าน เลือกที่ประหยัด token ที่สุด:
      </p>
      <ul>
        <li><code>get_block({"{ id, summary: true }"})</code> — probe เฉพาะ schema (<code>columns</code> + <code>row_count</code>) ไม่มี body</li>
        <li><code>get_table_row({"{ block_id, index }"})</code> — 1 แถวที่รู้ index (<code>-1</code> = แถวสุดท้าย)</li>
        <li><code>find_table_rows({"{ block_id, q?, where?, columns?, limit? }"})</code> — ค้นในตาราง (substring หรือ exact column match) ไม่ดูดทั้ง body</li>
        <li><code>get_block({"{ id }"})</code> — source/inner เต็ม. ระวังตารางใหญ่ ๆ (&gt; ~100 แถว)</li>
      </ul>

      <h4>เปลี่ยนชนิด block — เก็บ <code>@N</code> เดิมไว้</h4>
      <p>
        เวลา AI แปลง <code>@123</code> จากตาราง markdown เป็น <code>html-embed</code> (หรือ stats → mermaid ฯลฯ) <strong>id ต้องคงเดิม</strong> เพื่อ reference เก่าใช้งานได้. วิธีที่ดีที่สุด: ใส่ annotation ใน source ใหม่ — fence: <code>{"```html-embed {@123}"}</code>; ตาราง: บรรทัด <code>{"{@123}"}</code> ใต้ตาราง. <strong>ถ้าลืม ไม่เป็นไร</strong> — <code>edit_lines</code> + <code>edit_section</code> auto-preserve ทุก <code>{"{@N}"}</code> ที่อยู่ใน region ที่กำลังถูกแทน, ฉีดใส่ slot แรกที่เหมาะใน content ใหม่ (fence info / บรรทัดท้ายตาราง) ตามลำดับ source. แปลง 1 block ก็คง id ได้เสมอ; N:1 merge เก็บ id ตัวแรก, ที่เหลือเสีย.
      </p>

      <h3>Fields สำคัญ</h3>
      <ul>
        <li><strong>session_id</strong> — Claude Code chat session UUID (ใช้กับ <code>claude --resume &lt;id&gt;</code> ได้). ดึงจาก hook input ของ <code>UserPromptSubmit</code> ก็ได้</li>
        <li><strong>user_prompt</strong> — ข้อความผู้ใช้ verbatim ที่กระตุ้นให้เกิดการแก้. <em>ทุก mutation tool</em> รับ field นี้ (add_knowledge / add_page / edit_page / append_page / edit_lines / edit_section / replace_text / edit_knowledge). เมื่อใส่มา server เก็บลง <strong>prompt log</strong> ผูกกับ knowledge + (ถ้ามี) page นั้น ๆ. ตัดที่ 500 ตัวอักษรตอน insert. ดู log ผ่าน <code>get_prompt_log</code> หรือใน info popover (แสดงเป็น timeline)</li>
        <li><strong>tokens_used</strong> — optional, token ที่ client ใช้ทั้งหมด (input + output รวมกัน) สำหรับ track cost</li>
        <li><strong>project</strong> — group key เช่น repo name → ใช้ group ใน sidebar</li>
        <li><strong>tags</strong> (knowledge) vs <strong>keywords</strong> (page) — tags ใช้กรอง knowledge, keywords ใช้เพิ่มน้ำหนัก FTS search ของ page</li>
      </ul>

      <h3>เลือก block ให้ถูก — ใช้ prepared block ก่อน</h3>
      <p>
        WikiKai มี semantic block สำเร็จรูป 6 ตัว + markdown ปกติ. <strong>ใช้ <code>html-embed</code> เป็น last resort เท่านั้น</strong> — เมื่อ block สำเร็จรูปไม่พอ และ layout HTML custom ช่วยให้ผู้อ่านเข้าใจดีขึ้นจริง ๆ (gradient status card, decision matrix สีตามแถว/คอลัมน์, badges + flex layout, <code>&lt;details&gt;</code> accordion, inline SVG, iframe). prepared block อ่านถูกกว่า (ไม่มี inline-style noise), มี tooling ครบ (<code>find_table_rows</code>, <code>get_table_row</code>, chart re-themes), render สม่ำเสมอ light/dark theme.
      </p>
      <table>
        <thead><tr><th>อยากแสดง…</th><th>ใช้</th></tr></thead>
        <tbody>
          <tr><td>Flow, sequence, ER, gantt, state, mindmap</td><td><code>```mermaid</code></td></tr>
          <tr><td>ตัวเลข / กราฟเปรียบเทียบ / trend</td><td><code>```chart</code> · <code>```chart-grid</code></td></tr>
          <tr><td>KPI, headline ตัวเลขใหญ่ ๆ</td><td><code>```stats</code></td></tr>
          <tr><td>ขั้นตอน / how-to / runbook</td><td><code>```steps</code></td></tr>
          <tr><td>ตาราง</td><td><strong>markdown table ปกติ</strong> — ได้ <code>@N</code>, <code>[ ]</code> ใน cell, <code>find_table_rows</code></td></tr>
          <tr><td>Gallery 4+ ภาพเรียงกัน</td><td><code>```images</code></td></tr>
          <tr><td>ภาพเดี่ยว inline / ใน prose / ใน cell ตาราง</td><td>markdown <code>{`![alt](src "WxH")`}</code> — drag-resize + lightbox ในตัว</td></tr>
          <tr><td>Layout พิเศษ — สีตาม row/col, gradient card, badge, <code>&lt;details&gt;</code>, SVG, iframe</td><td><code>```html-embed</code> (last resort)</td></tr>
        </tbody>
      </table>

      <h3>การอ่านแบบประหยัด token (default ทำให้อยู่แล้ว)</h3>
      <p>
        3 จุดประหยัด ทุกตัวเป็น opt-out (default คือ path ที่ถูกที่สุด):
      </p>
      <ul>
        <li><strong><code>read_page({"{ page_id }"})</code> — summary เป็น default</strong>. rich block + ตารางที่มี annotation ทั้งหมดยุบเป็นบรรทัด <code>[@N kind 25 lines: caption]</code> เดียว (หรือ <code>[@N table 12r × 3c: caption]</code>). AI เห็นโครงสร้างหน้า + caption ของทุก block + line count โดยไม่ต้องจ่ายค่า diagram source / chart JSON / table rows. <strong>`hash` หาย</strong> — ส่ง <code>mode: "full"</code> เมื่อจะแก้ไข.</li>
        <li><strong><code>get_block({"{ summary: true }"})</code></strong> — คืน caption + kind + line range เท่านั้น (ไม่มี source/inner). สำหรับตารางได้ <code>columns</code> + <code>row_count</code> ด้วย. ใช้ตอบ "@47 คืออะไร" โดยไม่ดึง body.</li>
        <li><strong>ตัด inline <code>style="..."</code></strong> — default สำหรับ <code>html-embed</code> ทุก body ที่คืนจาก <code>get_block</code> หรือ <code>read_page</code>. ประหยัด 50–70% ต่อ block. ส่ง <code>include_styles: true</code> ตอนทำงานกับ design. <code>hash</code> หายเมื่อมีการ strip — re-read ด้วย <code>include_styles: true</code> ก่อน <code>edit_lines</code>.</li>
      </ul>
      <p style={{ color: "var(--text-2)", fontSize: 12 }}>
        จับคู่กับ <strong>caption</strong>: เขียน <code>{`{@123 "คำอธิบายสั้น ๆ"}`}</code> บนทุก block ที่ไม่ใช่เรื่องเล็ก — 3 จุดประหยัดข้างบนจะใช้ประโยชน์ได้เต็มที่ (block ที่ไม่มี caption ใน summary mode จะเห็นแค่ <code>[@123 mermaid]</code> ซึ่ง AI ตัดสินใจไม่ได้ว่าจะ fetch หรือไม่).
      </p>

      <h3>Workflow ที่แนะนำ</h3>
      <ol>
        <li>
          <strong>สแกน example แบบประหยัด token:</strong> <code>get_example({"{ kind: 'full', outline_only: true }"})</code> →
          ได้ heading list + total_lines เท่านั้น (ไม่มี body — ถูกกว่า full ~10 เท่า)
        </li>
        <li>
          <strong>อ่านเฉพาะส่วนที่ต้องการ:</strong> ดู outline แล้วเลือก heading ที่ line N →{" "}
          <code>get_example({"{ kind: 'full', line_start: N, line_end: N+20 }"})</code>
        </li>
        <li><strong>สร้าง:</strong> <code>add_knowledge</code> พร้อม <code>first_page</code> ตั้งต้น 1 หน้า — ใส่ session_id + user_prompt</li>
        <li><strong>เพิ่มหน้า:</strong> <code>add_page</code> ทีละหัวข้อ — 1 หน้า = 1 หัวข้อใหญ่</li>
        <li><strong>กลับมาแก้ทีหลัง:</strong> <code>get_outline</code> เพื่อสแกน → <code>read_page</code> เฉพาะส่วน → <code>edit_section</code> ถ้าจะเปลี่ยน body. หรือถ้า user อ้าง block ด้วย id ("อัพเดต @47") → <code>get_block({"{ id: 47 }"})</code> → <code>read_page</code> เอา hash ใหม่ → <code>edit_lines</code></li>
        <li><strong>ค้นย้อน:</strong> <code>search</code> หาจุดที่เกี่ยวข้อง → ทำงานต่อตรงจุดนั้น</li>
      </ol>
      <p>
        🎓 เอกสาร <code>📘 คู่มือใช้งาน WikiKai — Tutorial</code> (URL <code>/&amp;4</code>)
        เป็น live example แบบ render เต็มที่ใช้ fence ทุกแบบ — เรียกผ่าน{" "}
        <code>get_outline({"{ knowledge_id: 4 }"})</code> + <code>read_page({"{ page_id: N, line_start, line_end }"})</code>
        ก็ดูได้เป็นส่วน ๆ
      </p>

      <h3>ตัวอย่างเรียก (TypeScript SDK)</h3>
      <pre><code>{`import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from
  "@modelcontextprotocol/sdk/client/streamableHttp.js";

const c = new Client({ name: "demo", version: "0" });
await c.connect(new StreamableHTTPClientTransport(
  new URL("http://<your-lan-ip>:3939/mcp")
));

await c.callTool({
  name: "add_knowledge",
  arguments: {
    title: "My architecture notes",
    project: "myrepo",
    session_id: "550e8400-...",
    user_prompt: "อธิบาย architecture หน่อย",
    tokens_used: 1240,
    first_page: {
      title: "Overview",
      content: "# Hi\\n\\n\\\`\\\`\\\`mermaid\\nflowchart LR\\n  A-->B\\n\\\`\\\`\\\`"
    }
  }
});`}</code></pre>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}
