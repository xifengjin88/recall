import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { remarkCallouts } from "./callouts";
import { extractNoteSection, headingId, noteToc, notesHref, resolveWikilinks } from "./notes";

const MD = `# Title

## 2.1 The kernel

Intro.

\`\`\`bash
# not a heading
uname -r
\`\`\`

### Kernel mode

Detail.

---

## 2.2 The shell

Shell text.

### Capabilities

Caps.
`;

describe("notes", () => {
  it("gives numbered headings section ids and slugs the rest", () => {
    expect(headingId("2.10 Interprocess communication")).toBe("s2.10");
    expect(headingId("Process view vs kernel view")).toBe("process-view-vs-kernel-view");
    expect(notesHref(2, { section: "2.7" })).toBe("/chapters/2/notes#s2.7");
    expect(notesHref(2, { section: "2.7", anchor: "Capabilities" })).toBe("/chapters/2/notes#capabilities");
  });

  it("extracts a section through its subsections, ignoring # inside code", () => {
    const s = extractNoteSection(MD, { section: "2.1" })!;
    expect(s.startsWith("## 2.1 The kernel")).toBe(true);
    expect(s).toContain("# not a heading");
    expect(s).toContain("### Kernel mode");
    expect(s).not.toContain("2.2");
    expect(s.endsWith("Detail.")).toBe(true);
    expect(extractNoteSection(MD, { anchor: "Capabilities" })).toBe("### Capabilities\n\nCaps.");
    expect(extractNoteSection(MD, { section: "9.9" })).toBeNull();
    expect(noteToc(MD).map((t) => t.id)).toEqual(["s2.1", "s2.2"]);
  });

  it("resolves wikilinks to in-app links, or plain text when the notes don't exist", () => {
    const has = (title: string) => (title === "TLPI 06 - Processes" ? 6 : undefined);
    expect(resolveWikilinks("see [[#Capabilities|caps]]", has)).toBe("see [caps](#capabilities)");
    expect(resolveWikilinks("[[#2.10 Interprocess communication|§2.10]]", has)).toBe("[§2.10](#s2.10)");
    expect(resolveWikilinks("[[TLPI 06 - Processes]]", has)).toBe("[TLPI 06 - Processes](/chapters/6/notes)");
    expect(resolveWikilinks("[[TLPI 18 - Directories and Links]]", has)).toBe("TLPI 18 - Directories and Links");
  });

  it("resolves any course's note titles, including links to a heading", () => {
    const find = (title: string) => (title === "Load Balancers and App Servers" ? 3 : undefined);
    expect(resolveWikilinks("[[Load Balancers and App Servers]]", find)).toBe("[Load Balancers and App Servers](/chapters/3/notes)");
    expect(resolveWikilinks("[[Load Balancers and App Servers#3.7 Making it redundant|redundancy]]", find)).toBe(
      "[redundancy](/chapters/3/notes#s3.7)",
    );
    expect(resolveWikilinks("[[Some Future Note]]", find)).toBe("Some Future Note");
  });

  it("leaves wikilink-looking text in code alone (Mermaid node shapes, inline code)", () => {
    const md = "```mermaid\nflowchart LR\n  LB[[Load Balancer]] --> A\n```\nSee `[[x]]` and [[Gone]].";
    expect(resolveWikilinks(md, () => undefined)).toBe("```mermaid\nflowchart LR\n  LB[[Load Balancer]] --> A\n```\nSee `[[x]]` and Gone.");
  });
});

describe("callouts", () => {
  const render = (md: string) => renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkCallouts] }, md));

  it("renders a titled callout with its body", () => {
    const html = render("> [!warning] Common mix-up\n> Deleting needs **write** on the dir.");
    expect(html).toContain('data-callout="warning"');
    expect(html).toMatch(/<div class="callout-title">Common mix-up<\/div>/);
    expect(html).toContain("<strong>write</strong>");
  });

  it("makes '-' callouts collapsible and defaults the title to the type", () => {
    const html = render("> [!example]- Try it\n>\n> ```bash\n> ls\n> ```");
    expect(html).toMatch(/^<details class="callout not-prose" data-callout="example">/);
    expect(html).toContain('<summary class="callout-title">Try it</summary>');
    expect(render("> [!important]\n> Read carefully.")).toContain('<div class="callout-title">Important</div>');
  });

  it("leaves ordinary blockquotes alone", () => {
    expect(render("> just a quote")).toBe("<blockquote>\n<p>just a quote</p>\n</blockquote>");
  });
});
