import test from "node:test";
import assert from "node:assert/strict";
import { createCloudinaryStorage } from "../src/modules/media/cloudinary-storage.js";

async function withCredentials(callback) {
  const previous = {
    cloud: process.env.CLOUDINARY_CLOUD_NAME,
    key: process.env.CLOUDINARY_API_KEY,
    secret: process.env.CLOUDINARY_API_SECRET,
  };
  process.env.CLOUDINARY_CLOUD_NAME = "logistic-hub-test";
  process.env.CLOUDINARY_API_KEY = "test-api-key";
  process.env.CLOUDINARY_API_SECRET = "test-api-secret";
  try {
    await callback();
  } finally {
    for (const [name, value] of [
      ["CLOUDINARY_CLOUD_NAME", previous.cloud],
      ["CLOUDINARY_API_KEY", previous.key],
      ["CLOUDINARY_API_SECRET", previous.secret],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("uploads evidence as authenticated image and raw PDF assets", async () => withCredentials(async () => {
  const calls = [];
  const client = {
    config: options => calls.push({ action: "config", options }),
    uploader: {
      upload: async (data, options) => {
        calls.push({ action: "upload", data, options });
        return { public_id: options.public_id };
      },
      destroy: async (publicId, options) => {
        calls.push({ action: "destroy", publicId, options });
        return { result: "ok" };
      },
    },
    utils: {
      private_download_url: (publicId, format, options) => {
        calls.push({ action: "download-url", publicId, format, options });
        return "https://download.example/private";
      },
    },
  };
  const storage = createCloudinaryStorage({ client });
  const imageId = await storage.upload({
    objectPath: "support-tickets/ticket-1/image-1.png",
    buffer: Buffer.from("image bytes"),
    mimeType: "image/png",
  });
  const pdfId = await storage.upload({
    objectPath: "support-tickets/ticket-1/document-1.pdf",
    buffer: Buffer.from("%PDF-1.7"),
    mimeType: "application/pdf",
  });

  assert.equal(imageId, "support-tickets/ticket-1/image-1");
  assert.equal(pdfId, "support-tickets/ticket-1/document-1.pdf");
  const uploads = calls.filter(call => call.action === "upload");
  assert.equal(uploads[0].options.resource_type, "image");
  assert.equal(uploads[0].options.type, "authenticated");
  assert.equal(uploads[1].options.resource_type, "raw");
  assert.equal(uploads[1].options.type, "authenticated");
  assert.match(uploads[0].data, /^data:image\/png;base64,/);
}));

test("downloads authenticated evidence using a short-lived attachment URL", async () => withCredentials(async () => {
  const calls = [];
  const client = {
    config() {},
    uploader: {},
    utils: {
      private_download_url: (publicId, format, options) => {
        calls.push({ publicId, format, options });
        return "https://download.example/private";
      },
    },
  };
  const storage = createCloudinaryStorage({
    client,
    fetchImpl: async url => {
      assert.equal(url, "https://download.example/private");
      return { ok: true, arrayBuffer: async () => Buffer.from("private evidence") };
    },
    clock: () => 1_800_000_000_000,
  });

  const buffer = await storage.download({
    objectPath: "support-tickets/ticket-1/document-1.pdf",
    mimeType: "application/pdf",
  });
  assert.equal(buffer.toString(), "private evidence");
  assert.equal(calls[0].format, "pdf");
  assert.equal(calls[0].options.resource_type, "raw");
  assert.equal(calls[0].options.type, "authenticated");
  assert.equal(calls[0].options.attachment, true);
  assert.equal(calls[0].options.expires_at, 1_800_000_300);
}));

test("deletes authenticated assets using their resource type", async () => withCredentials(async () => {
  const calls = [];
  const client = {
    config() {},
    uploader: {
      destroy: async (publicId, options) => {
        calls.push({ publicId, options });
        return { result: "ok" };
      },
    },
    utils: {},
  };
  const storage = createCloudinaryStorage({ client });
  await storage.delete({ objectPath: "support-tickets/ticket-1/proof.pdf", mimeType: "application/pdf" });
  assert.equal(calls[0].options.resource_type, "raw");
  assert.equal(calls[0].options.type, "authenticated");
}));

test("fails closed when Cloudinary credentials are missing", async () => {
  const previous = [
    process.env.CLOUDINARY_CLOUD_NAME,
    process.env.CLOUDINARY_API_KEY,
    process.env.CLOUDINARY_API_SECRET,
  ];
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  try {
    const storage = createCloudinaryStorage({ client: { config() {} } });
    await assert.rejects(
      storage.upload({ objectPath: "evidence.png", buffer: Buffer.from("x"), mimeType: "image/png" }),
      error => error.code === "MEDIA_STORAGE_NOT_CONFIGURED",
    );
  } finally {
    if (previous[0] !== undefined) process.env.CLOUDINARY_CLOUD_NAME = previous[0];
    if (previous[1] !== undefined) process.env.CLOUDINARY_API_KEY = previous[1];
    if (previous[2] !== undefined) process.env.CLOUDINARY_API_SECRET = previous[2];
  }
});
