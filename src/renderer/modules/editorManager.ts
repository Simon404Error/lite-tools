import { configStore } from "@/renderer/modules/configStore";
import { waitForElement } from "@/renderer/utils/domWaitFor";
import { createLogger } from "@/renderer/utils/createLogger";

const log = createLogger("editorManager");

type ProseMirrorInfo = {
  type: "prosemirror";
  editor: any;
};

type CkeditorInfo = {
  type: "ckeditor";
  model: any;
  doc: any;
};

type EditorInfo = ProseMirrorInfo | CkeditorInfo;

class EditorManager {
  setup() {
    this.initEditorCleanup();
  }

  private async initEditorCleanup() {
    try {
      const editorInfo = await Promise.any<EditorInfo>([this.getProseMirrorInstance(), this.getCkeditorInstance()]);

      if (editorInfo.type === "prosemirror") {
        this.setupProseMirror(editorInfo.editor);
      } else if (editorInfo.type === "ckeditor") {
        this.setupCkeditor(editorInfo.model, editorInfo.doc);
      }
    } catch (error) {
      log("[EditorManager] 未能找到任何支持的编辑器实例:", error);
    }
  }

  private async getProseMirrorInstance(): Promise<ProseMirrorInfo> {
    const editorElement: any = await waitForElement(".qq-msg-editor");
    const proseMirrorInstance = editorElement?.__VUE__[0]?.ctx?.getEditor()?.editor;
    if (!proseMirrorInstance) throw new Error("ProseMirror instance not found");
    return { type: "prosemirror", editor: proseMirrorInstance };
  }

  private async getCkeditorInstance(): Promise<CkeditorInfo> {
    const ckeditorEl: any = await waitForElement(".ck.ck-content.ck-editor__editable");
    const ckeditorInstance = ckeditorEl?.ckeditorInstance;
    if (!ckeditorInstance) throw new Error("Ckeditor instance not found");
    return {
      type: "ckeditor",
      model: ckeditorInstance.model,
      doc: ckeditorInstance.model.document,
    };
  }

  private setupProseMirror(editor: any) {
    const view = editor.view;
    let isCleaning = false;
    const originalDispatch = view.dispatch.bind(view);

    view.dispatch = (tr: any) => {
      originalDispatch(tr);

      if (!tr.docChanged || isCleaning || !configStore.value.message.removeReplyAt) return;

      try {
        isCleaning = true;

        let replyBefore: any = null;
        tr.before.forEach((node: any) => {
          if (node.type.name === "msgReply") replyBefore = node;
        });

        let replyAfter: any = null;
        tr.doc.forEach((node: any) => {
          if (node.type.name === "msgReply") replyAfter = node;
        });

        const isSystemReplyAction = replyAfter && (!replyBefore || !replyBefore.eq(replyAfter));
        if (!isSystemReplyAction) return;

        const oldAtPositions = new Set<number>();
        tr.before.descendants((node: any, pos: number) => {
          if (node.type.name === "msgAt") {
            oldAtPositions.add(tr.mapping.map(pos));
          }
        });

        const targets: Array<{ atFrom: number; atTo: number }> = [];
        let hasDeleted = false;

        tr.doc.descendants((block: any, blockPos: number) => {
          if (hasDeleted || block.type.name !== "paragraph") return false;

          block.forEach((child: any, offset: number, index: number) => {
            if (hasDeleted || child.type.name !== "msgAt") return;

            const childPos = blockPos + 1 + offset;

            if (oldAtPositions.has(childPos)) return;

            let deleteSize = child.nodeSize;
            const next = index + 1 < block.childCount ? block.child(index + 1) : null;
            if (next && next.isText && /^\s/.test(next.text)) {
              deleteSize += 1;
            }

            targets.push({
              atFrom: childPos,
              atTo: childPos + deleteSize,
            });

            hasDeleted = true;
          });
        });

        if (targets.length === 0) return;

        const cleanupTr = view.state.tr;
        for (const t of targets) {
          cleanupTr.delete(t.atFrom, t.atTo);
        }

        if (cleanupTr.docChanged) {
          originalDispatch(cleanupTr);
        }
      } catch (e) {
        log("ProseMirror清理出错", e);
      } finally {
        isCleaning = false;
      }
    };
  }

  private setupCkeditor(model: any, doc: any) {
    let isCleaning = false;

    doc.on("change:data", () => {
      if (!configStore.value.message.removeReplyAt || isCleaning) return;

      try {
        const changes: any[] = Array.from(doc.differ.getChanges());
        const replyInserted = changes.some((c: any) => c.type === "insert" && c.name === "msg-reply");
  
        if (!replyInserted) return;

        const atChange: any = changes.find((c: any) => c.type === "insert" && c.name === "msg-at");
     
        if (!atChange) return;

        isCleaning = true;

        model.enqueueChange("transparent", (writer: any) => {
          try {
            const atNode = atChange.position.nodeAfter;
            if (!atNode || !atNode.is?.("element", "msg-at")) return;

            const nextNode = atNode.nextSibling;

            if (nextNode && nextNode.is?.("$text")) {
              const oldText = nextNode.data;
              const newText = oldText.replace(/^\s+/, "");

              if (newText !== oldText) {
                const insertPos = writer.createPositionBefore(nextNode);
                const attrs = Object.fromEntries(nextNode.getAttributes());
                writer.remove(nextNode);
                if (newText.length > 0) {
                  writer.insertText(newText, attrs, insertPos);
                }
              }
            }

            writer.remove(atNode);

            const currentRoot: any = doc.getRoot();
            if (currentRoot) {
              const text = writer.createText("\u200B");
              writer.insert(text, currentRoot.getChild(currentRoot.childCount - 1));
              setTimeout(() => {
                model.enqueueChange("transparent", (asyncWriter: any) => {
                  asyncWriter.remove(text);
                });
              });
            }
          } finally {
            isCleaning = false;
          }
        });
      } catch (err) {
        log("CKEditor清理出错", err);
        isCleaning = false;
      }
    });
  }
}

const editorManager = new EditorManager();
export { editorManager };
