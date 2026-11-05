import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import { env } from "../../config/env.js";
import { Readable } from "stream";
import fs from "fs";
import path from "path";

const isCloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME &&
  env.CLOUDINARY_API_KEY &&
  env.CLOUDINARY_API_SECRET &&
  !env.CLOUDINARY_CLOUD_NAME.includes("your_")
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export interface UploadResult {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
}

export async function uploadImageBuffer(
  buffer: Buffer,
  fileName: string,
  folder = "deadlinehub/attachments"
): Promise<UploadResult> {
  if (isCloudinaryConfigured) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "auto",
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            return reject(error || new Error("Cloudinary upload failed with empty result"));
          }
          resolve({
            publicId: result.public_id,
            secureUrl: result.secure_url,
            format: result.format,
            bytes: result.bytes,
          });
        }
      );

      Readable.from(buffer).pipe(uploadStream);
    });
  }

  // Graceful local fallback if Cloudinary is not yet configured in .env
  const uploadsDir = path.resolve(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const cleanExt = path.extname(fileName) || ".png";
  const uniqueId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const savedFilename = `${uniqueId}${cleanExt}`;
  const filePath = path.join(uploadsDir, savedFilename);

  await fs.promises.writeFile(filePath, buffer);

  const localUrl = `/uploads/${savedFilename}`;
  return {
    publicId: uniqueId,
    secureUrl: localUrl,
    format: cleanExt.replace(".", ""),
    bytes: buffer.length,
  };
}
