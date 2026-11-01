"use client";

import type { RecapData } from "@linkroom/shared";
import { ArrowSquareOutIcon, HighlighterIcon, PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import { mergeAttributes, Node, type JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as Y from "yjs";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { Spinner } from "./bits";
import { NotebookSync } from "./notebook-sync";
import { useRoom } from "./store";
import type { Annotation } from "./types";

// The shared notebook: a document next to the sources that everyone in the room writes in at once
// (Yjs, kept in step by NotebookSync, saved by apps/backend). Highlights dragged in become quotes
// that stay linked to their place in the source. The AI can write a first draft from the room's
// highlights.

export const QUOTE_MIME = "application/x-linkroom-quote";

export type QuoteAttrs = { doc: string; block: string; quote: string; author: string | null; color: string | null };
type Mark = Extract<Annotation, { kind: "highlight" | "underline" }>;

export const quoteOf = (mark: Mark): QuoteAttrs => ({
  doc: mark.doc,
  block: mark.block,
  quote: mark.quote,
  author: mark.author.name,
  color: mark.color,
});

function parseQuote(raw: string): QuoteAttrs | null {
  try {
    const q = JSON.parse(raw) as Partial<QuoteAttrs>;
    return typeof q.doc === "string" && typeof q.block === "string" && typeof q.quote === "string" && q.quote.trim()
      ? { doc: q.doc, block: q.block, quote: q.quote, author: q.author ?? null, color: q.color ?? null }
      : null;
  } catch {
    return null;
  }
}

const dataAttr = (name: keyof QuoteAttrs) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
  renderHTML: (attrs: Record<string, unknown>) => (attrs[name] ? { [`data-${name}`]: attrs[name] } : {}),
});

// A quote from a source, linked to where it is: clicking it opens that document at that line.
const SourceQuote = Node.create({
  name: "sourceQuote",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      doc: dataAttr("doc"),
      block: dataAttr("block"),
      quote: dataAttr("quote"),
      author: dataAttr("author"),
      color: dataAttr("color"),
    };
  },
  parseHTML() {
    return [{ tag: "blockquote[data-source-quote]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["blockquote", mergeAttributes(HTMLAttributes, { "data-source-quote": "" }), (node.attrs.quote as string) ?? ""];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SourceQuoteView);
  },
});

function SourceQuoteView({ node }: NodeViewProps) {
  const { jumpTo, state } = useRoom();
  const attrs = node.attrs as QuoteAttrs;
  const title = state.docs.find((d) => d.id === attrs.doc)?.title ?? "source";
  return (
    <NodeViewWrapper
      as="blockquote"
      data-drag-handle
      className="my-2 rounded-r-xl border-l-4 bg-foreground/4 py-2 pr-3 pl-3"
      style={{ borderColor: attrs.color ?? "var(--azure, #2f5bff)" }}
    >
      <p className="m-0 text-[0.875rem] leading-relaxed">“{attrs.quote}”</p>
      <button
        type="button"
        contentEditable={false}
        onClick={() => jumpTo(attrs.doc, attrs.block)}
        className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowSquareOutIcon className="size-3" />
        {title}
        {attrs.author && ` · ${attrs.author}`}
      </button>
    </NodeViewWrapper>
  );
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: text.trim() ? [{ type: "text", text: text.trim() }] : [] });
const heading = (level: 2 | 3, text: string): JSONContent => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
function bullets(items: string[]): JSONContent[] {
  const kept = items.map((i) => i.trim()).filter(Boolean);
  return kept.length ? [{ type: "bulletList", content: kept.map((i) => ({ type: "listItem", content: [paragraph(i)] })) }] : [];
}
const section = (title: string, items: string[]) => {
  const list = bullets(items);
  return list.length ? [heading(3, title), ...list] : [];
};

/**
 * A first draft from the room's AI recap of its highlights. A quote the group cared about becomes a
 * linked source quote when it matches one of the room's highlights, and plain text otherwise.
 */
export function draftContent(recap: RecapData, marks: Mark[]): JSONContent[] {
  const linked = (quote: string): JSONContent => {
    const q = norm(quote);
    const mark = q ? marks.find((m) => norm(m.quote).includes(q) || q.includes(norm(m.quote))) : undefined;
    return mark
      ? { type: "sourceQuote", attrs: { ...quoteOf(mark), quote: mark.quote } }
      : { type: "blockquote", content: [paragraph(quote)] };
  };
  const cared = recap.what_the_group_cared_about.filter((c) => c.quote.trim());
  return [
    heading(2, "Group notes"),
    ...(recap.one_line_summary.trim() ? [paragraph(recap.one_line_summary)] : []),
    ...section("Key points", recap.key_points),
    ...(cared.length
      ? [
          heading(3, "What we highlighted"),
          ...cared.flatMap((c) => [linked(c.quote), ...(c.why.trim() ? [paragraph(c.who.length ? `${c.who.join(", ")}: ${c.why}` : c.why)] : [])]),
        ]
      : []),
    ...section("Where we disagreed", recap.disagreements),
    ...section("Open questions", recap.open_questions),
    ...section("Next steps", recap.next_steps),
  ];
}

export function Notebook() {
  const room = useRoom();
  const { channel, perms, readOnly, isDemo, state, me, primary } = room;
  const roomId = primary.id;
  const editable = perms.annotate && !readOnly;
  const [doc] = useState(() => new Y.Doc());
  const [ready, setReady] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const warned = useRef(false);
  const { send, onNotebook } = channel; // both stable for the room's lifetime

  useEffect(() => {
    const sync = new NotebookSync(doc, {
      broadcast: (update, to) => send.notebook(update, to),
      request: (sv) => send.notebookRequest(sv),
      save: async (update) => {
        if (isDemo) return; // the demo room's notebook lives only in the open tabs
        const token = (await getFreshSession().catch(() => null))?.access_token;
        await api.saveNotebook(roomId, update, token);
      },
      onSaveError: (err) => {
        const permanent = err instanceof ApiError && err.status < 500 && err.status !== 429;
        if (!warned.current) {
          warned.current = true;
          toast.error(permanent ? err.message : "The notebook couldn't be saved. Retrying…");
        }
        return !permanent;
      },
    });
    const off = onNotebook((message) => sync.receive(message));
    let cancelled = false;
    (isDemo ? Promise.resolve({ state: null }) : api.getNotebook(roomId))
      .then((res) => {
        if (cancelled) return;
        sync.load(res.state);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? `Couldn't load the notebook: ${err.message}` : "Couldn't load the notebook");
        sync.load(null);
        setReady(true);
      });
    return () => {
      cancelled = true;
      off();
      sync.destroy();
    };
  }, [doc, roomId, isDemo, onNotebook, send]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        StarterKit.configure({ undoRedo: false }), // undo comes from Collaboration, per person
        Collaboration.configure({ document: doc }),
        SourceQuote,
      ],
      editorProps: {
        attributes: {
          class:
            "min-h-[18rem] px-4 py-3 text-[0.9375rem] leading-relaxed outline-none [&_blockquote:not([data-source-quote])]:border-l-4 [&_blockquote:not([data-source-quote])]:pl-3 [&_blockquote:not([data-source-quote])]:text-muted-foreground [&_h2]:mt-2 [&_h2]:font-display [&_h2]:text-[1.4rem] [&_h3]:mt-4 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5",
        },
        // A highlight dragged in from the tray becomes a linked quote where it was dropped.
        handleDrop: (view, event) => {
          const quote = parseQuote(event.dataTransfer?.getData(QUOTE_MIME) ?? "");
          if (!quote) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.doc.content.size;
          const node = view.state.schema.nodes.sourceQuote!.create(quote);
          view.dispatch(view.state.tr.insert(pos, node));
          return true;
        },
      },
    },
    [doc, editable],
  );

  const marks = state.annotations.filter((a): a is Mark => a.kind === "highlight" || a.kind === "underline");

  const insertQuote = (mark: Mark) => editor?.chain().focus("end").insertContent({ type: "sourceQuote", attrs: quoteOf(mark) }).run();

  const draft = async () => {
    if (!editor) return;
    setDrafting(true);
    try {
      const recap = await api.recap(roomId, me.name);
      editor.chain().focus("end").insertContent(draftContent(recap, marks)).run();
      toast.success("Draft added. Edit it together.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't write a draft");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-(--hairline) px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[0.875rem] font-semibold">Shared notebook</div>
          <div className="text-[0.6875rem] text-muted-foreground">
            {editable ? "Everyone here writes in it at once. Drag a highlight in to quote it." : "Read only for your role."}
          </div>
        </div>
        {editable && !isDemo && perms.useAi && (
          <button
            type="button"
            onClick={draft}
            disabled={drafting || !editor}
            title="Write a first draft from the group's highlights"
            className="flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-[0.75rem] font-medium text-pearl disabled:opacity-60 dark:bg-azure"
          >
            {drafting ? <Spinner /> : <SparkleIcon weight="fill" className="size-3.5" />}
            Draft with AI
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {ready && editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <Spinner />
          </div>
        )}
      </div>

      {editable && marks.length > 0 && (
        <details className="max-h-[40%] shrink-0 overflow-y-auto border-t border-(--hairline) px-3 py-2" open>
          <summary className="flex cursor-pointer items-center gap-1.5 py-1 text-[0.75rem] font-semibold text-muted-foreground">
            <HighlighterIcon className="size-3.5" /> Highlights ({marks.length}) · drag one in, or press +
          </summary>
          <ul className="mt-1 space-y-1.5">
            {marks.map((m) => (
              <li
                key={m.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(QUOTE_MIME, JSON.stringify(quoteOf(m)));
                  e.dataTransfer.setData("text/plain", m.quote);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className="flex cursor-grab items-start gap-2 rounded-xl border border-(--hairline) bg-card px-2.5 py-1.5 text-[0.75rem] active:cursor-grabbing"
                style={{ borderLeft: `3px solid ${m.color}` }}
              >
                <span className="line-clamp-2 min-w-0 flex-1">“{m.quote}”</span>
                <button
                  type="button"
                  onClick={() => insertQuote(m)}
                  aria-label="Add to notebook"
                  className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-foreground/8"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
