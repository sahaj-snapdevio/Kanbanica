import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import { MentionList, type MentionListRef } from "./mention-list";
import type { MentionMember } from "@/app/actions/mention";

// Accepts a getter so the suggestion always reads the latest members list,
// even though the Tiptap extension is instantiated only once.
export function buildMentionSuggestion(getMembers: () => MentionMember[]) {
  return {
    char: "@",

    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      return getMembers().filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      );
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    command: ({ editor, range, props }: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const id: string = props.id;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const label: string = props.label;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const mentionNodeType = editor.schema.nodes.mention;
      if (!mentionNodeType) return;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const mentionNode = mentionNodeType.create({ id, label });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const spaceNode = editor.schema.text(" ");

      // Dispatch a raw ProseMirror transaction — most direct path
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const tr = editor.view.state.tr;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      tr.replaceWith(range.from, range.to, [mentionNode, spaceNode]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      editor.view.dispatch(tr);
    },

    render: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let renderer: ReactRenderer<MentionListRef, any>;
      let popup: TippyInstance[];

      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onStart(props: any) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          renderer = new ReactRenderer(MentionList, {
            props,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            editor: props.editor,
          });

          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (!props.clientRect) return;

          popup = tippy("body" as unknown as Element, {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            getReferenceClientRect: () => props.clientRect() ?? new DOMRect(),
            appendTo: () => document.body,
            content: renderer.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
            arrow: false,
            theme: "mention-popup",
          }) as unknown as TippyInstance[];
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onUpdate(props: any) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          renderer.updateProps(props);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (props.clientRect) {
            popup[0]?.setProps({
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              getReferenceClientRect: () => props.clientRect() ?? new DOMRect(),
            });
          }
        },

        onKeyDown({ event }: { event: KeyboardEvent }) {
          if (event.key === "Escape") {
            popup[0]?.hide();
            return true;
          }
          return renderer.ref?.onKeyDown(event) ?? false;
        },

        onExit() {
          popup[0]?.destroy();
          renderer.destroy();
        },
      };
    },
  };
}
