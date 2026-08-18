import { client } from "./client.js";

export function createAssistant(model: string) {
  return client.beta.assistants.create({ model });
}
