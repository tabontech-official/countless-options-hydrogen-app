import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { MAX_UPLOAD_BYTES, uploadMimeType } from "../options";
import { gql } from "../options.server";

// Storefront uploads for "File upload" questions, reached through the app proxy
// (/apps/countless-options/upload, see [app_proxy] in shopify.app.toml). Shopify signs every
// proxied request, and authenticate.public.appProxy checks that signature.
//
// Two steps, so the file itself never passes through this server:
//   stage:  returns a Shopify upload target; the browser posts the file straight to it.
//   create: turns the upload into a file in the shop's Files and returns its URL, which the
//           block saves on the order like any other answer.
// ponytail: no rate limit; add one per shop/IP if stores see upload spam.

const reply = (body, status = 200) => Response.json(body, { status });
const fail = (error, status = 400) => reply({ error }, status);

// Proof that a resourceUrl came from our own "stage" step for this shop, so "create" can't be
// pointed at someone else's upload or an outside URL.
const sign = (shop, resourceUrl) =>
  // eslint-disable-next-line no-undef
  createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(`${shop}\n${resourceUrl}`).digest("hex");
function signed(shop, resourceUrl, token) {
  const expected = Buffer.from(sign(shop, resourceUrl));
  const given = Buffer.from(typeof token === "string" ? token : "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin) return fail("failed", 401);
  const { shop } = session;
  const body = await request.json().catch(() => ({}));

  if (body.intent === "stage") {
    // Only stores that actually ask for a file accept uploads.
    const sets = await prisma.optionSet.findMany({ where: { shop, status: "ACTIVE" }, select: { fields: true } });
    if (!sets.some((s) => s.fields.some((f) => f.type === "file"))) return fail("failed", 403);

    const mimeType = uploadMimeType(body.filename);
    const size = Number(body.fileSize);
    if (!mimeType) return fail("type");
    if (!(size > 0 && size <= MAX_UPLOAD_BYTES)) return fail("size");

    const data = await gql(
      admin,
      `#graphql
      mutation StageUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
      {
        input: [
          { resource: "FILE", filename: body.filename.slice(-100), mimeType, fileSize: String(size), httpMethod: "POST" },
        ],
      },
    );
    const [target] = data.stagedUploadsCreate.stagedTargets;
    if (!target?.url || !target.resourceUrl) {
      console.error("stagedUploadsCreate", data.stagedUploadsCreate.userErrors);
      return fail("failed", 502);
    }
    return reply({ ...target, token: sign(shop, target.resourceUrl) });
  }

  if (body.intent === "create") {
    if (!signed(shop, body.resourceUrl, body.token)) return fail("failed", 403);
    const data = await gql(
      admin,
      `#graphql
      mutation CreateUpload($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id fileStatus }
          userErrors { field message }
        }
      }`,
      { files: [{ originalSource: body.resourceUrl, contentType: "FILE" }] },
    );
    const id = data.fileCreate.files?.[0]?.id;
    if (!id) {
      console.error("fileCreate", data.fileCreate.userErrors);
      return fail("failed", 502);
    }

    // Files are processed in the background; ready ones have their CDN URL.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { node: file } = await gql(
        admin,
        `#graphql
        query UploadedFile($id: ID!) {
          node(id: $id) {
            ... on GenericFile { fileStatus url originalFileSize }
          }
        }`,
        { id },
      );
      if (file?.fileStatus === "READY" && file.url) {
        // The upload target may not enforce the size we asked for; this does.
        if (file.originalFileSize > MAX_UPLOAD_BYTES) {
          await deleteFile(admin, id);
          return fail("size");
        }
        return reply({ url: file.url });
      }
      if (file?.fileStatus === "FAILED") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await deleteFile(admin, id);
    return fail("failed", 502);
  }

  return fail("failed");
};

async function deleteFile(admin, id) {
  await gql(
    admin,
    `#graphql
    mutation DeleteUpload($ids: [ID!]!) {
      fileDelete(fileIds: $ids) { deletedFileIds userErrors { field message } }
    }`,
    { ids: [id] },
  ).catch((error) => console.error("fileDelete", error));
}
