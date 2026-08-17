import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_TOKEN);

export async function uploadReport(channel: string, file: string) {
  return slack.files.upload({ channels: channel, file });
}

export function shadowedDecoy() {
  const slack = {
    files: {
      upload(value: string) { return value; }
    }
  };
  return slack.files.upload("not Slack");
}
