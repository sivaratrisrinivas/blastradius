import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_TOKEN);

export async function uploadReport(channel: string, file: string) {
  return slack.files.upload({ channels: channel, file });
}
