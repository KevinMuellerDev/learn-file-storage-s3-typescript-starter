import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError, UserNotAuthenticatedError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes } from 'node:crypto';
import path from "node:path";
import { unlink } from "node:fs/promises";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const UPLOAD_LIMIT = 1 << 30;
  const { videoId } = req.params as { videoId?: string };

  if (!videoId)
    throw new BadRequestError('Invalid Video ID');

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  if (!userID)
    throw new UserNotAuthenticatedError('User is not found');

  const metaData = getVideo(cfg.db, videoId)

  if (userID !== metaData?.userID)
    throw new UserForbiddenError('User has not the Permission.')

  const formData = req.formData();
  const file = (await formData).get('video');

  if (!(file instanceof File))
    throw new BadRequestError('Bad Request');

  if (file.size > UPLOAD_LIMIT) {
    console.log(`FILESIZE:${file.size}  LIMIT:${UPLOAD_LIMIT}`)
    throw new BadRequestError('File size is too big');
  }

  if (file.type !== "video/mp4")
    throw new BadRequestError("File must be MP4");

  const fileName = randomBytes(32).toString('base64url');
  const filePath = path.join(cfg.assetsRoot, `temp/${fileName}.mp4`);

  await Bun.write(filePath, file);

  const tempFile = Bun.file(filePath);
  const s3File = cfg.s3Client.file(`${fileName}.mp4`);

  try {
    await s3File.write(tempFile, { type: "video/mp4" })
  } catch (error) {
    throw new Error('File couldnt be uploaded')
  } finally {
    await unlink(filePath);
  }

  metaData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileName}.mp4`;
  updateVideo(cfg.db, metaData);

  return respondWithJSON(200, metaData);
}
