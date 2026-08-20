import OpenAI from "openai";

const client = new OpenAI();

export async function createAssistant(model: string) {
  return client.beta.assistants.create({ model });
}
