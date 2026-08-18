import { slack } from "./client.js";

export function upload(value: unknown) {
  return slack.files.upload(value);
}
