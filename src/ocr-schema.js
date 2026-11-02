export const OCR_FIELDS = ["nome", "apartamento", "bloco", "telefone", "rastreio", "transportadora", "remetente"];
export const OCR_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(OCR_FIELDS.map(field => [field, { type: "string" }])),
  required: OCR_FIELDS,
  additionalProperties: false,
};

const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
export function matchResidentName(text, residents, fields) {
  if (!fields.bloco || !fields.apartamento) return "";
  const lines = String(text).split(/\r?\n/).map(line => normalize(line).replace(/^(?:DESTINATARIO|DESTINATARIA|NOME) /, ""));
  const matches = residents.filter(m => m.ativo && normalize(m.bloco) === normalize(fields.bloco) && normalize(m.apartamento) === normalize(fields.apartamento) && normalize(m.nome) && lines.includes(normalize(m.nome)));
  return matches.length === 1 ? matches[0].nome : "";
}
