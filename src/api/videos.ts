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

  const aspectRatio = await getVideoAspectRatio(filePath);
  console.log(aspectRatio);
  const tempFile = Bun.file(filePath);
  const s3File = cfg.s3Client.file(`${aspectRatio}/${fileName}.mp4`);

  try {
    await s3File.write(tempFile, { type: "video/mp4" })
  } catch (error) {
    throw new Error('File couldnt be uploaded')
  } finally {
    await unlink(filePath);
  }

  metaData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${aspectRatio}/${fileName}.mp4`;
  updateVideo(cfg.db, metaData);

  return respondWithJSON(200, metaData);
}


export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath], {
    stdout: "pipe",
    stderr: "pipe"
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exited = await proc.exited;

  if (exited !== 0)
    throw new Error('');

  const parsedOutput = await JSON.parse(stdout);
  const width = parsedOutput.streams[0].width;
  const height = parsedOutput.streams[0].height;

  const ratio = width / height;
  console.log(width, height, ratio);

  if (ratio < 1.78 && ratio > 1.76) {
    return "landscape"
  } else if (ratio < 0.57 && ratio > 0.55) {
    return "portrait"
  } else {
    return "other"
  }
}