import process from "node:process";
import type { DiscoveryCategory } from "../../shared/types/discovery";

export const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";

export type WorkflowPainPointSignal = {
  title: string;
  url: string;
  content: string;
};

export type TavilyFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class TavilyConfigurationError extends Error {}
export class TavilyRequestError extends Error {}
export class NoUsefulTavilyResultsError extends Error {}

const queryPools: Record<DiscoveryCategory, readonly string[]> = {
  surprise: [
    "real team frustrating repetitive manual workflow copying data email spreadsheet missed handoffs",
    "operations staff describe recurring administration approvals reporting fragmented tools pain point",
    "small business manual process repeated data entry scheduling document processing bottleneck",
  ],
  customer_support: [
    "support team manual ticket triage email routing escalation missing customer context pain point",
    "customer service repeated replies CRM lookup handoff reporting manual workflow problem",
    "support operations missed escalations classify inbox requests route urgent cases manual process",
  ],
  sales_crm: [
    "sales team manual CRM data entry lead qualification follow up tracking pain point",
    "account executives meeting preparation pipeline updates proposal handoff repetitive workflow",
    "sales operations lead routing missed follow ups copying information between tools problem",
  ],
  marketing_content: [
    "marketing team content intake approval feedback consolidation publishing coordination pain point",
    "campaign reporting manual spreadsheets research collection repetitive marketing workflow",
    "content repurposing approvals stakeholder feedback fragmented tools operational problem",
  ],
  hr_recruiting: [
    "recruiting team candidate intake CV screening interview scheduling manual workflow pain point",
    "HR onboarding document collection employee requests internal approvals repetitive process",
    "recruiters copying candidate information coordinating interviews missed handoffs problem",
  ],
  finance_admin: [
    "finance team invoice receipt expense processing approval manual data entry pain point",
    "accounts payable payment reminders document extraction reconciliation spreadsheet workflow problem",
    "administration recurring reports invoice approvals copying financial documents between systems",
  ],
  operations_projects: [
    "project operations manual status collection handoffs task creation recurring reporting pain point",
    "operations team incident intake approval chains cross system coordination fragmented workflow",
    "project managers chasing updates copying status into reports missed handoffs problem",
  ],
  ecommerce: [
    "ecommerce operations order issues returns inventory notifications fulfilment exceptions manual workflow",
    "online store product data updates customer questions review handling repetitive process pain point",
    "ecommerce team manually coordinating returns order exceptions inventory customer support",
  ],
  personal_productivity: [
    "professionals inbox organization task capture meeting notes reminders repetitive workflow pain point",
    "personal document organization research collection scheduling fragmented apps manual process",
    "knowledge workers missed follow ups email to task copying meeting action items problem",
  ],
};

export function selectDiscoveryQuery(
  category: DiscoveryCategory,
  random: () => number = Math.random,
): string {
  const pool = queryPools[category];
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[Math.max(0, index)]!;
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function searchWorkflowPainPoints(
  category: DiscoveryCategory,
  options: {
    apiKey?: string;
    fetchImpl?: TavilyFetch;
    random?: () => number;
    timeoutMs?: number;
  } = {},
): Promise<WorkflowPainPointSignal[]> {
  const apiKey = options.apiKey ?? process.env.TAVILY_API_KEY;
  if (!apiKey?.trim()) {
    throw new TavilyConfigurationError("TAVILY_API_KEY is not configured.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  let response: Response;
  try {
    response = await fetchImpl(TAVILY_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: selectDiscoveryQuery(category, options.random),
        topic: "general",
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new TavilyRequestError("Tavily search could not be reached.");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new TavilyRequestError("Tavily search failed.");
  }

  const data = await response.json() as {
    results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
  };
  const signals = (data.results ?? [])
    .filter((result) =>
      typeof result.title === "string"
      && result.title.trim().length > 0
      && validHttpUrl(result.url)
      && typeof result.content === "string"
      && result.content.trim().length > 0,
    )
    .slice(0, 5)
    .map((result) => ({
      title: (result.title as string).trim(),
      url: result.url as string,
      content: (result.content as string).trim().slice(0, 1800),
    }));

  if (signals.length === 0) {
    throw new NoUsefulTavilyResultsError("Tavily returned no useful workflow pain points.");
  }

  return signals;
}

export const discoveryQueryPools = queryPools;
