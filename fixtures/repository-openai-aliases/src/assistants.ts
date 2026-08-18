import OpenAIClient from "openai";

const client = new OpenAIClient();
const beta = client.beta;
const assistants = beta.assistants;

export function createThroughAssignments(model: string) {
  return assistants.create({ model });
}

const { beta: destructuredBeta } = client;
const { assistants: destructuredAssistants } = destructuredBeta;

export function createThroughDestructuring(model: string) {
  return destructuredAssistants.create({ model });
}

let assignedAssistants;
assignedAssistants = client.beta.assistants;

export function createThroughAssignment(model: string) {
  return assignedAssistants.create({ model });
}

const clientAlias = client;

export function createThroughClientAlias(model: string) {
  return clientAlias.beta.assistants.create({ model });
}
