// A comment mentioning slack.files.upload must not become evidence.
type UploadLike = { files: { upload(value: unknown): unknown } };

const unrelatedIdentifier: UploadLike = {
  files: { upload: value => value }
};

export function callUnrelatedIdentifier(value: unknown) {
  return unrelatedIdentifier.files.upload(value);
}

import { Client } from "other-sdk";

const unrelatedPackageClient = new Client();

export function callUnrelatedPackage(value: unknown) {
  return unrelatedPackageClient.files.upload(value);
}

const substringCollision = "slack.files.upload";
const endpointCollision = "files.upload";

export { substringCollision, endpointCollision };
