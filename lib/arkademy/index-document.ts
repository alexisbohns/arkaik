import type { ArkademyDocument, BmcQuestionKey, BmcTool, Company, Entity, Use } from "./schema";

/**
 * The lookups the pages need and the arrays do not give (the spec's § "The
 * index"). Built once per validated document, on the server; it never
 * crosses to the client — server pages project it to plain props.
 *
 * It assumes a document that passed validateArkademyDocument: lookups on a
 * broken one answer, but not meaningfully.
 */
export interface ArkademyIndex {
  document: ArkademyDocument;
  tool: BmcTool;
  company(id: string): Company | undefined;
  entity(id: string): Entity | undefined;
  /** Uses of one example's question, sorted by `order`. A fresh array per call. */
  uses(company: string, question: BmcQuestionKey): Use[];
  isOpen(company: string, question: BmcQuestionKey): boolean;
  /** Ids of the examples using an entity, in `tool.examples` order. */
  usersOf(entity: string): string[];
}

function groupKey(company: string, question: string): string {
  return `${company}\u0000${question}`;
}

export function indexArkademy(document: ArkademyDocument): ArkademyIndex {
  const tool = document.tools[0];
  const companies = new Map(document.companies.map((company) => [company.id, company]));
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));

  const groups = new Map<string, Use[]>();
  const users = new Map<string, Set<string>>();
  for (const use of document.uses) {
    if (use.tool !== tool.id) continue;
    const key = groupKey(use.company, use.question);
    const group = groups.get(key);
    if (group) group.push(use);
    else groups.set(key, [use]);
    const companiesUsing = users.get(use.entity);
    if (companiesUsing) companiesUsing.add(use.company);
    else users.set(use.entity, new Set([use.company]));
  }
  for (const group of groups.values()) group.sort((a, b) => a.order - b.order);

  const open = new Set(
    document.open.filter((entry) => entry.tool === tool.id).map((entry) => groupKey(entry.company, entry.question)),
  );

  return {
    document,
    tool,
    company: (id) => companies.get(id),
    entity: (id) => entities.get(id),
    uses: (company, question) => (groups.get(groupKey(company, question)) ?? []).slice(),
    isOpen: (company, question) => open.has(groupKey(company, question)),
    usersOf: (entity) => {
      const using = users.get(entity);
      return using ? tool.examples.filter((id) => using.has(id)) : [];
    },
  };
}
