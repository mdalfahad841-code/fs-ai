/**
 * FS AI — 16-agent registry.
 * The full agent roster. Each agent has a name, role, responsibilities,
 * status and permission boundaries. Agents NEVER publish, post, spend money
 * or connect an account on their own — publishing and posting always need
 * owner approval, and money is never spent without the owner's explicit
 * permission ($0 investment rule).
 */
export const AGENT_REGISTRY = [
  { id: 'business-manager', name: 'Business Manager', role: 'Central Business Manager', responsibilities: ['Coordinate all 14 operational agents', 'Daily task queue and activity log', 'Owner-approval gate before any publishing', 'Pause / resume / disable agents on owner command'], status: 'active', permissions: 'Coordinate only. Cannot publish, post, spend money or connect accounts without owner approval.' },
  { id: 'automotive-research', name: 'Automotive Research', role: 'Research Agent — Automotive', responsibilities: ['Research automotive topics', 'Verify facts from reputable sources', 'Supply sourced briefs to Content Creation'], status: 'active', permissions: 'Read and research only. Cannot publish or post.' },
  { id: 'technology-research', name: 'Technology Research', role: 'Research Agent — AI & Technology', responsibilities: ['Research AI and technology topics', 'Verify facts from reputable sources', 'Supply sourced briefs to Content Creation'], status: 'active', permissions: 'Read and research only. Cannot publish or post.' },
  { id: 'gadget-research', name: 'Gadget Research', role: 'Research Agent — Gadgets & Electronics', responsibilities: ['Research gadgets and electronics', 'Verify specs from manufacturer or reputable sources', 'Supply sourced briefs to Content Creation'], status: 'active', permissions: 'Read and research only. Cannot publish or post.' },
  { id: 'finance-research', name: 'Finance Research', role: 'Research Agent — Finance & Money', responsibilities: ['Research budgeting, saving and loan topics', 'Verify figures from reputable sources', 'Flag any claim that needs a source'], status: 'active', permissions: 'Read and research only. Cannot publish, post or give personal financial advice.' },
  { id: 'travel-research', name: 'Travel Research', role: 'Research Agent — Travel & Lifestyle', responsibilities: ['Research travel and lifestyle topics', 'Verify prices and practical details', 'Supply sourced briefs to Content Creation'], status: 'active', permissions: 'Read and research only. Cannot publish, post or book travel.' },
  { id: 'digital-tools', name: 'Digital Tools', role: 'Tools Agent — Digital Tools & Utilities', responsibilities: ['Maintain the 20 free tools', 'Check tool calculations are correct', 'Propose new free tools'], status: 'active', permissions: 'Propose and test only. Cannot deploy or change live tools without owner approval.' },
  { id: 'health-research', name: 'Health Research', role: 'Research Agent — Health & Wellness', responsibilities: ['Research general health and fitness topics', 'Use reputable health sources only', 'Add a general-information disclaimer to health content'], status: 'active', permissions: 'Read and research only. Cannot publish or give medical advice.' },
  { id: 'education-research', name: 'Education Research', role: 'Research Agent — Education & Learning', responsibilities: ['Research learning topics and skill plans', 'Verify learning resources', 'Supply sourced briefs to Content Creation'], status: 'active', permissions: 'Read and research only. Cannot publish or post.' },
  { id: 'seo', name: 'SEO', role: 'SEO Agent', responsibilities: ['Meta titles and descriptions', 'Sitemap and structured data', 'Keyword and readability checks'], status: 'active', permissions: 'Analyse and prepare only. Cannot publish changes without owner approval.' },
  { id: 'content-creation', name: 'Content Creation', role: 'Content Creation Agent', responsibilities: ['Draft articles from sourced research briefs', 'Plain-language writing', 'Hand drafts to Fact Checking'], status: 'active', permissions: 'Draft only. Cannot publish — drafts go to Fact Checking, then owner approval.' },
  { id: 'fact-checking', name: 'Fact Checking', role: 'Fact-Checking Agent', responsibilities: ['Verify every factual claim against sources', 'Reject or flag unsourced claims', 'Check for invented numbers or statistics'], status: 'active', permissions: 'Verify and flag only. Cannot publish or edit live content directly.' },
  { id: 'publishing', name: 'Publishing', role: 'Publishing Agent', responsibilities: ['Prepare approved content for publication', 'Publish ONLY after owner approval', 'Record what was published and when'], status: 'active', permissions: 'Publish only content the owner has approved. Cannot publish unapproved content.' },
  { id: 'analytics', name: 'Analytics', role: 'Analytics Agent', responsibilities: ['Report traffic honestly', 'Report revenue honestly ($0.00 until a real account connects)', 'Never invent visitors, clicks or earnings'], status: 'active', permissions: 'Report only. Cannot connect analytics accounts or fabricate data.' },
  { id: 'monetization', name: 'Monetization', role: 'Monetization Agent', responsibilities: ['Track AdSense / affiliate status honestly', 'Report revenue as $0.00 until connected', 'Never claim a payout method that does not exist'], status: 'active', permissions: 'Track and report only. Cannot spend money or join programmes without owner approval.' },
  { id: 'security', name: 'Security', role: 'Security & Monitoring Agent', responsibilities: ['Audit logging', 'Error detection', 'Flag suspicious activity to the owner'], status: 'active', permissions: 'Monitor and log only. Cannot change credentials or access controls.' },
];

export function getAgent(id) {
  return AGENT_REGISTRY.find((a) => a.id === id) || null;
}

export function agentsByStatus(status) {
  return AGENT_REGISTRY.filter((a) => a.status === status);
}

export function agentCount() {
  return AGENT_REGISTRY.length; // 16
}
