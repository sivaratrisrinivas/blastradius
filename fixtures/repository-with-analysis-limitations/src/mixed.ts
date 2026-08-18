import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_TOKEN);

export async function uploadReport(channel: string, file: string) {
  return slack.files.upload({ channels: channel, file });
}

export function uploadWithDynamicEndpoint(endpoint: string, value: unknown) {
  return slack[endpoint](value);
}

export function uploadWithDynamicMethod(method: string, value: unknown) {
  return slack.files[method](value);
}

export function uploadWithComputedPath(value: unknown) {
  return slack["files"]["upload"](value);
}
