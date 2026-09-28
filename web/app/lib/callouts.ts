// remark plugin for Obsidian callouts:
//   > [!warning] Optional title
//   > body…
// A "-" or "+" after the type makes it collapsible (closed / open), rendered as <details>.

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const MARKER = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*/;

export const CALLOUT_TYPES = ["abstract", "tip", "important", "warning", "info", "note", "example", "question"] as const;

function convert(bq: Node) {
  const para = bq.children?.[0];
  const first = para?.type === "paragraph" ? para.children?.[0] : undefined;
  if (!para || first?.type !== "text" || !first.value) return;
  const m = MARKER.exec(first.value);
  if (!m) return;
  const type = m[1].toLowerCase();
  const fold = m[2];

  // Title = inline content up to the first line break of the first paragraph.
  first.value = first.value.slice(m[0].length);
  const inline = para.children!;
  const title: Node[] = [];
  let rest: Node[] = [];
  for (let i = 0; i < inline.length; i++) {
    const n = inline[i];
    const nl = n.type === "text" ? n.value!.indexOf("\n") : n.type === "break" ? 0 : -1;
    if (nl === -1) {
      title.push(n);
      continue;
    }
    if (n.type === "text") {
      const before = n.value!.slice(0, nl);
      const after = n.value!.slice(nl + 1);
      if (before) title.push({ type: "text", value: before });
      rest = [...(after ? [{ type: "text", value: after }] : []), ...inline.slice(i + 1)];
    } else rest = inline.slice(i + 1);
    break;
  }
  const hasTitle = title.some((n) => n.type !== "text" || n.value!.trim());
  const titleNode: Node = {
    type: "paragraph",
    data: { hName: fold ? "summary" : "div", hProperties: { className: ["callout-title"] } },
    children: hasTitle ? title : [{ type: "text", value: type[0].toUpperCase() + type.slice(1) }],
  };
  const body = [...(rest.length ? [{ ...para, children: rest }] : []), ...(bq.children!.slice(1) ?? [])];

  bq.data = {
    hName: fold ? "details" : "div",
    hProperties: { className: ["callout", "not-prose"], "data-callout": type, ...(fold === "+" ? { open: true } : {}) },
  };
  bq.children = [
    titleNode,
    { type: "blockquote", data: { hName: "div", hProperties: { className: ["callout-body"] } }, children: body },
  ];
}

function walk(node: Node) {
  if (node.type === "blockquote") convert(node);
  node.children?.forEach(walk);
}

export function remarkCallouts() {
  return (tree: unknown) => walk(tree as Node);
}
