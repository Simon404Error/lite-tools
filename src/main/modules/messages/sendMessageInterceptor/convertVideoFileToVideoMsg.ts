import { createLogger } from "@/main/utils/createLogger";
import { isVideoFile } from "@/main/utils/fileExtension";
import { sendMessage } from "@/main/utils/nativeCall";

const log = createLogger("convertVideoFileToVideoMsg");

function convertVideoFileToVideoMsg(msgPayload: any): boolean {
  const msgElement = msgPayload.msgElements[0];
  if (
    msgElement &&
    msgElement?.elementType === 3 &&
    msgElement?.fileElement &&
    isVideoFile(msgElement.fileElement.filePath) &&
    +msgElement.fileElement.fileSize / 1024 / 1024 <= 99
  ) {
    sendMessage(msgPayload.peer, [
      {
        type: "video",
        path: msgElement.fileElement.filePath,
        originMsgEl: msgElement.fileElement,
      },
    ]);
    return true;
  }
  return false;
}

export { convertVideoFileToVideoMsg };
