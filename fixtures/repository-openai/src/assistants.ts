import OpenAI from "openai";

const client = new OpenAI();

export async function createAssistant(model: string) {
  return client.beta.assistants.create({ model });
}

const OpenAIFromRequire = require("openai");
const requiredClient = new OpenAIFromRequire();

export async function createRequiredAssistant(model: string) {
  return requiredClient.beta.assistants.create({ model });
}
