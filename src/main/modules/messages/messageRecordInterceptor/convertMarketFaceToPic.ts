import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { webContents } from "electron";
import { dispatchIpcEvent } from "@/main/utils/dispatchIpcEvent";
import { configManager } from "@/main/modules/configManager";

const faceFilePaths = new Map<string, string>();
const awaitIsFileExist = new Map<
  string,
  {
    cb: () => void;
    dynamicFacePath: string;
  }
>();

function convertMarketFaceToPic(msgList: any[], webContentId: number) {
  for (const msgItem of msgList) {
    for (const msgElement of msgItem.elements) {
      if (msgElement?.marketFaceElement) {
        downloadMarketFace(msgElement.marketFaceElement, webContentId);
        msgElement.picElement = replaceMarketFace(msgElement.marketFaceElement);
        msgElement.marketFaceElement = null;
        msgElement.elementType = 2;
        msgItem.msgType = 2;
        msgItem.subMsgType = 4096;
      }
    }
  }
}

function replaceMarketFace(marketFaceElement: any): object {
  const fileName = marketFaceElement.staticFacePath.split("\\").pop();
  const picWidth = marketFaceElement.imageHeight ?? 200;
  const picHeight = marketFaceElement.imageHeight ?? 200;
  const staticFacePath = marketFaceElement.staticFacePath;
  faceFilePaths.set(staticFacePath, marketFaceElement.dynamicFacePath);
  const thumbPath = new Map([
    ["0", staticFacePath],
    ["198", staticFacePath],
    ["720", staticFacePath],
  ]);
  return {
    picSubType: 1,
    fileName,
    fileSize: "142857",
    picWidth,
    picHeight,
    original: true,
    md5HexStr: "",
    sourcePath: staticFacePath,
    thumbPath,
    transferStatus: 2,
    progress: 0,
    picType: 2000,
    invalidState: 0,
    fileUuid: "",
    fileSubId: "",
    thumbFileSize: 0,
    fileBizId: null,
    downloadIndex: null,
    summary: "",
    emojiFrom: null,
    emojiWebUrl: null,
    emojiAd: {
      url: "",
      desc: "",
    },
    emojiMall: {
      packageId: 0,
      emojiId: 0,
    },
    emojiZplan: {
      actionId: 0,
      actionName: "",
      actionType: 0,
      playerNumber: 0,
      peerUid: "0",
      bytesReserveInfo: "",
    },
    originImageMd5: "",
    originImageUrl: "",
    import_rich_media_context: null,
    isFlashPic: null,
    storeID: 1,
  };
}

function downloadMarketFace(marketFaceElement: any, webContentId: number) {
  if (!existsSync(marketFaceElement.staticFacePath)) {
    dispatchIpcEvent(
      webContentId,
      {
        type: "request",
        eventName: "ntApi",
      },
      {
        cmdName: "nodeIKernelMsgService/fetchMarketEmoticonAioImage",
        cmdType: "invoke",
        payload: [
          {
            marketEmoticonAioImageReq: {
              eId: marketFaceElement.emojiId,
              epId: marketFaceElement.emojiPackageId,
              name: marketFaceElement.faceName,
              width: marketFaceElement.imageHeight,
              height: marketFaceElement.imageHeight,
              jobType: 0,
              encryptKey: marketFaceElement.key,
              filePath: marketFaceElement.staticFacePath,
              downloadType: 4,
            },
          },
          undefined,
        ],
      },
      true,
    );
  }
}

IpcInterceptor.interceptIpcSendEvents(
  "nodeIKernelMsgListener/onEmojiDownloadComplete",
  (channel: string, event: any, args: any) => {
    if (configManager.value.message.marketFaceToPicElement) {
      const filePath = args?.payload?.notifyInfo?.path;
      if (!filePath) return;
      const item = awaitIsFileExist.get(filePath);
      if (item) {
        const { cb, dynamicFacePath } = item;
        const noExtPath = filePath;
        if (existsSync(filePath) && existsSync(dynamicFacePath)) {
          decodeQqMarketface(dynamicFacePath, filePath);
        }
        cb();
        awaitIsFileExist.delete(filePath);
      } else {
        faceFilePaths.delete(filePath);
      }
    }
  },
);

IpcInterceptor.interceptIpcReceiveEvents("isFileExist", (_: any, __: any, channel: string, args: any) => {
  if (configManager.value.message.marketFaceToPicElement) {
    const webContentId = parseInt(channel.split("RM_IPCFROM_RENDERER")[1]) || 2;
    const callbackId = args?.[0]?.callbackId;
    const filePath = args?.[1]?.payload?.[0];
    if (filePath && faceFilePaths.has(filePath)) {
      awaitIsFileExist.set(filePath, {
        cb: () => sendFileIsExist(webContentId, callbackId),
        dynamicFacePath: faceFilePaths.get(filePath)!,
      });
      faceFilePaths.delete(filePath);
      return { action: "block" };
    }
  }
});

function sendFileIsExist(webContentId: number, callbackId: string) {
  const webContent = webContents.fromId(webContentId);
  if (webContent && callbackId) {
    webContent.send(
      `RM_IPCFROM_MAIN${webContentId}`,
      {
        callbackId,
        promiseStatue: "full",
        type: "response",
        eventName: "FileApi",
        peerId: webContentId,
      },
      true,
    );
  }
}

function decodeQqMarketface(inputPath: string, outputPath: string): void {
  const data = readFileSync(inputPath);

  // 避免多次 XOR。
  if (isGif(data)) {
    return;
  }

  for (let blockStart = 0; blockStart < data.length; blockStart += 50) {
    const end = Math.min(blockStart + 20, data.length);
    for (let index = blockStart; index < end; index++) {
      data[index] ^= 0xff;
    }
  }

  // 解码后格式错误，阻止覆盖文件
  if (!isGif(data)) {
    return;
  }

  writeFileSync(outputPath, data);
}

function isGif(data: Buffer): boolean {
  const header = data.subarray(0, 6).toString("ascii");
  return header === "GIF87a" || header === "GIF89a";
}

export { convertMarketFaceToPic };
