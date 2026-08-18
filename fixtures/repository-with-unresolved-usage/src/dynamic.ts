import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_TOKEN);

export function uploadWithDynamicEndpoint(endpoint: string, value: unknown) {
  return slack[endpoint](value);
}
