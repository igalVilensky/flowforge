export const discoveryCategories = [
  "surprise",
  "customer_support",
  "sales_crm",
  "marketing_content",
  "hr_recruiting",
  "finance_admin",
  "operations_projects",
  "ecommerce",
  "personal_productivity",
] as const;

export type DiscoveryCategory = (typeof discoveryCategories)[number];

export type AutomationSuggestion = {
  id: string;
  title: string;
  category: DiscoveryCategory;
  fitType: "automation_only" | "agent_only" | "agentic_workflow";
  painPoint: string;
  targetUser: string;
  whyItMatters: string;
  valueLevel: "low" | "medium" | "high";
  difficulty: "low" | "medium" | "high";
  confidence: number;
  workflowIntent: string;
  suggestedSteps: string[];
  source: {
    title: string;
    url: string;
  } | null;
};

export type SuggestAutomationRequest = {
  category: DiscoveryCategory;
};

export const discoveryCategoryOptions: ReadonlyArray<{
  value: DiscoveryCategory;
  label: string;
}> = [
  { value: "surprise", label: "Surprise me" },
  { value: "customer_support", label: "Customer Support" },
  { value: "sales_crm", label: "Sales & CRM" },
  { value: "marketing_content", label: "Marketing & Content" },
  { value: "hr_recruiting", label: "HR & Recruiting" },
  { value: "finance_admin", label: "Finance & Administration" },
  { value: "operations_projects", label: "Operations & Project Management" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "personal_productivity", label: "Personal Productivity" },
];

export function discoveryCategoryLabel(category: DiscoveryCategory): string {
  return discoveryCategoryOptions.find((option) => option.value === category)?.label
    ?? "Surprise me";
}
