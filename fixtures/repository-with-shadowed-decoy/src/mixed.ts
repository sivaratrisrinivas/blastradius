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

export function reassignedDecoy() {
  let mutableSlack = new WebClient(process.env.SLACK_TOKEN);
  mutableSlack = { files: { upload(value: string) { return value; } } } as unknown as WebClient;
  return mutableSlack.files.upload("reassigned");
}

export function loopDecoy(decoys: Array<{ files: { upload(value: string): string } }>) {
  for (const slack of decoys) {
    slack.files.upload("loop");
  }
}

export function catchDecoy() {
  try {
    throw { files: { upload: (value: string) => value } };
  } catch (slack) {
    slack.files.upload("catch");
  }
}

var moduleSlack = new WebClient(process.env.SLACK_TOKEN);
{
  var moduleSlack = { files: { upload(value: string) { return value; } } };
}

export function varShadowedDecoy() {
  return moduleSlack.files.upload("var");
}
