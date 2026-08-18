import OpenAI from "openai";

const client = new OpenAI();

export function createWithComputedPath(model: string) {
  return client["beta"].assistants.create({ model });
}

export function createAfterCompoundAssignment(value: unknown, model: string) {
  let alias = client;
  alias += value;
  return alias.beta.assistants.create({ model });
}

export function createWithShadowedRequire(require: (name: string) => typeof OpenAI, model: string) {
  const ShadowedOpenAI = require("openai");
  const shadowedClient = new ShadowedOpenAI();
  return shadowedClient.beta.assistants.create({ model });
}
