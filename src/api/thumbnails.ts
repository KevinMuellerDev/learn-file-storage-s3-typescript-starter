import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import path from 'node:path';
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  };
  return map[mime] ?? "bin";
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const formData = req.formData();
  const file = (await formData).get('thumbnail');

  if (!(file instanceof File))
    throw new BadRequestError('Bad Request');

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (file.size > MAX_UPLOAD_SIZE)
    throw new BadRequestError('File too Big')

  const mediaType = mimeToExt(file.type);
  if (!((mediaType === "jpg") || (mediaType === "png")))
    throw new BadRequestError('Filetype haste to be jpeg or png')

  const filePath = path.join(cfg.assetsRoot, `${videoId}.${mediaType}`);
  await Bun.write(filePath, file)

  const metaData = getVideo(cfg.db, videoId);

  if (metaData?.userID !== userID)
    throw new UserForbiddenError('User forbidden');

  metaData.thumbnailURL = '/' + filePath;

  updateVideo(cfg.db, metaData);

  return respondWithJSON(200, metaData);
}
