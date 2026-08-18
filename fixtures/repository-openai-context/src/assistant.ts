import OpenAI from "openai";

const client = new OpenAI();

export function createAssistant(model: string) {
  return client.beta.assistants.create({ model });
}
