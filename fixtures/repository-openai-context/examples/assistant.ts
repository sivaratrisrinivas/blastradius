import OpenAI from "openai";

const client = new OpenAI();

export function createAssistantExample(model: string) {
  return client.beta.assistants.create({ model });
}
