import { configStore } from "@/renderer/modules/configStore";
import { waitForElement } from "@/renderer/utils/domWaitFor";
import { createLogger } from "@/renderer/utils/createLogger";
const log = createLogger("proseMirrorManager");

class ProseMirrorManager {
  setup() {
    this.replyCleanup();
  }

  private async replyCleanup() {
    const { editor } = await this.getProseMirrorInstance();
    const view = editor.view;
    const originalDispatchTransaction = view.dispatchTransaction?.bind(view);
    let isCleaning = false;
    let replyElement: any;

    view.setProps({
      dispatchTransaction: (transaction: any) => {
        if (originalDispatchTransaction) {
          originalDispatchTransaction(transaction);
        } else {
          view.updateState(view.state.apply(transaction));
        }

        if (!transaction.docChanged) return;

        try {
          const root = view.state.doc;
          if (!configStore.value.message.removeReplyAt || isCleaning) return;
          if (!root) return;

          let curReplyElement: any;
          root.forEach((block: any) => {
            if (!curReplyElement && block.type.name === "msgReply") {
              curReplyElement = block;
            }
          });

          if (replyElement === curReplyElement) return;
          replyElement = curReplyElement;
          isCleaning = true;

          const targets: Array<{ atFrom: number; atTo: number; }> = [];

          root.descendants((block: any, blockPos: number) => {
            if (block.type.name !== "paragraph") return;

            block.forEach((child: any, offset: number, index: number) => {
              const next = index + 1 < block.childCount ? block.child(index + 1) : null;
              if (child.type.name !== "msgAt" || !next) return;
              targets.push({
                atFrom: blockPos + 1 + offset,
                atTo: blockPos + 1 + offset + child.nodeSize + 1, // + 1 for the blank space after the @ mention
              });
            });
          });

          if (targets.length === 0) return;

          const transactionToApply = view.state.tr;
          for (const target of targets.reverse()) {
            transactionToApply.delete(target.atFrom, target.atTo);
          }
          if (transactionToApply.docChanged) {
            view.dispatch(transactionToApply)
          };
        } catch (err) {
          console.error("[replyCleanup]: Failed to remove @ mentions in reply:", err);
          log("[replyCleanup]: Failed to remove @ mentions in reply:", err);
        } finally {
          isCleaning = false;
        }
      },
    });
  }

  private async getProseMirrorInstance() {
    const editorElement: any = await waitForElement(".qq-msg-editor");
    const proseMirrorInstance = editorElement?.__VUE__[0]?.ctx?.getEditor()?.editor;
    if (!proseMirrorInstance) throw new Error("ProseMirror instance not found");
    return { editor: proseMirrorInstance };
  }
}

const proseMirrorManager = new ProseMirrorManager();
export { proseMirrorManager };
