import cloudinary from "cloudinary";
import { ServiceUnavailableError } from "../../shared/http/app-error.js";

const MIME_FORMATS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
});

const resourceTypeFor = mimeType => mimeType === "application/pdf" ? "raw" : "image";

export function createCloudinaryStorage({
  client = cloudinary.v2,
  fetchImpl = fetch,
  clock = () => Date.now(),
} = {}) {
  function configure() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableError("Evidence storage is not configured.", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    client.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return cloudName;
  }

  return {
    provider: "CLOUDINARY",
    get bucket() { return process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? ""; },
    async upload({ objectPath, buffer, mimeType }) {
      configure();
      const resourceType = resourceTypeFor(mimeType);
      const publicId = resourceType === "raw" ? objectPath : objectPath.replace(/\\.[^.]+$/, "");
      try {
        const result = await client.uploader.upload(
          `data:${mimeType};base64,${buffer.toString("base64")}`,
          {
            public_id: publicId,
            resource_type: resourceType,
            type: "authenticated",
            overwrite: false,
            unique_filename: false,
            use_filename: false,
          },
        );
        if (!result?.public_id) throw new Error("Cloudinary did not return a public asset identifier.");
        return result.public_id;
      } catch {
        throw new ServiceUnavailableError("Could not upload evidence to Cloudinary.", "MEDIA_STORAGE_UPLOAD_FAILED");
      }
    },
    async download({ objectPath, mimeType }) {
      configure();
      const format = MIME_FORMATS[mimeType];
      if (!format) throw new ServiceUnavailableError("Evidence file type is not supported by storage.", "MEDIA_STORAGE_FORMAT_UNSUPPORTED");
      const url = client.utils.private_download_url(objectPath, format, {
        resource_type: resourceTypeFor(mimeType),
        type: "authenticated",
        expires_at: Math.floor(clock() / 1000) + 300,
        attachment: true,
      });
      try {
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error("Cloudinary download failed.");
        return Buffer.from(await response.arrayBuffer());
      } catch {
        throw new ServiceUnavailableError("Could not download evidence from Cloudinary.", "MEDIA_STORAGE_DOWNLOAD_FAILED");
      }
    },
    async delete({ objectPath, mimeType }) {
      configure();
      try {
        const result = await client.uploader.destroy(objectPath, {
          resource_type: resourceTypeFor(mimeType),
          type: "authenticated",
          invalidate: true,
        });
        if (result?.result !== "ok" && result?.result !== "not found") throw new Error("Cloudinary deletion was not confirmed.");
      } catch {
        throw new ServiceUnavailableError("Could not remove evidence from Cloudinary.", "MEDIA_STORAGE_DELETE_FAILED");
      }
    },
  };
}
