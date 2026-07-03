# Lunapad — Adversarial Investor Pressure Test

**Purpose:** Stress-test pitch claims before the Google Africa Applied AI Lab application and Demo Day. Read before rehearsing.

**Framing:** Judge Lunapad as a **global dev tool with a sharp wedge**, not a regional play dressed up as a product company.

---

## How to use this doc

For each section: **Objection** → **Weak answer** (kills the meeting) → **Strong answer** → **Evidence needed**.

---

## 1. "This is just Hex / dbt / Metabase with an AI wrapper."

**Objection**

dbt has Wizard. Hex has Notebook Agent. Every BI tool has a copilot. Feature, not company.

**Weak answer**

"Better AI" or "nicer UX."

**Strong answer**

Lunapad owns the **model-building loop** others split across tools:

- **Exploration:** notebook + inline results + browser DuckDB
- **Composition:** named cells with automatic CTE resolution
- **Productionization:** promote to on-disk dbt with manifest lineage
- **Governance:** modeling standards + discovery stage (no duplicate `orders_*` tables)
- **Deployment:** self-host Docker, MCP/API for agents

AI is the **talent multiplier on a structured graph**. Gemini reasons over cells, lineage, and standards — not a blank prompt box.

**Evidence needed**

- Time-to-first-production-model demo vs. manual notebook → dbt handoff
- Documented Gemini context payload (schema + lineage + standards)

---

## 2. "You're applying to an Africa Lab but pitching a global SQL IDE."

**Objection**

Geographic mismatch. Sounds like you're using the Lab for funding, not fit.

**Weak answer**

"Africa is a huge market" or "African data teams need this."

**Strong answer**

We're not an "Africa product." We're a **global product** applying to a **co-development program**:

- **Lab deliverable:** Gemini-native agent with eval harness — needs DeepMind access and Research mentorship
- **Why not just raise seed:** Lab provides model access, eval feedback, and VC design-partner intros at the exact stage we need them
- **Geography is distribution, not identity:** Lab VC network helps recruit design partners; product works the same in Lagos or Berlin

If they push on impact: self-hosted, analyst-light teams are common everywhere; Lab partners happen to include high-growth companies on the continent. That's channel, not positioning.

**Evidence needed**

- "Why this Lab" answer rehearsed (deck Slide 13) — 60 seconds, no stat-padding
- Gemini integration milestone doc committed in application

---

## 3. "You're pre-launch. Why you over funded teams?"

**Objection**

Lab prefers traction. You have a prototype.

**Weak answer**

"Almost done" or "users coming soon."

**Strong answer**

Pre-launch on **revenue**, not **depth**:

- Shipped: notebook, dbt integration, AI agent loop, MCP, Docker, eval harness
- 90-day plan tied to Lab outputs: Gemini integration + 3 design partners + Demo Day proof
- Founder built the full stack — not a deck company

**Evidence needed**

- Live demo without slides
- Week-by-week milestones (deck Slide 11)

---

## 4. "What's the moat?"

**Objection**

Notebooks are commoditized. LLMs commoditize SQL. What compounds?

**Weak answer**

"First mover" or "better UX."

**Strong answer**

| Layer | What compounds |
|-------|----------------|
| **Model graph** | Cells, deps, promoted dbt models — switching cost rises |
| **Workspace standards** | Team rules make AI output more accurate over time |
| **Memory** | Embeddings of prior successful models |
| **Integration** | MCP + dbt manifest + Trino catalogs |
| **Templates** | Vertical notebook packs (cohort, inventory, funnel) |

SQL generation is table stakes. **Governed, lineage-aware model development** is the wedge.

**Evidence needed**

- Memory retrieval surfacing a prior model in a new thread
- Standards changing AI output live
- One vertical template ready for partners

---

## 5. "How do you make money?"

**Objection**

OSS self-host = no revenue. Gemini API = margin compression.

**Weak answer**

"Monetize later" or "enterprise sales."

**Strong answer**

| Tier | Revenue |
|------|---------|
| OSS self-host | Distribution |
| Team cloud ($49–199/seat) | Managed hosting, RBAC, support |
| AI quota | Bundled Gemini + overage margin |
| Vertical packs | Agency-licensed notebook + dbt starters |

Credible Year 1: **$5–15k MRR, 10–20 teams** post-Lab. Lab funds validation, not hockey sticks.

**Evidence needed**

- Pricing draft
- One agency LOI (even informal)

---

## 6. "Google requires material use of Google AI. You're BYOK."

**Objection**

No Gemini today. Grant application cosplay.

**Weak answer**

"We'll add Gemini."

**Strong answer**

BYOK is for self-host sovereignty. Lab deliverable is explicit:

1. First-class Gemini/Gemma provider
2. 20-task eval harness
3. Gemma for on-prem inference
4. Data Agent Kit + MCP reference workflow

We apply because the co-development period **is** the Gemini sprint.

**Evidence needed**

- Architecture diagram (deck appendix)
- W1–2 milestone in application
- Gemini provider spike (even unmerged)

---

## 7. "What if dbt Labs or Hex ships your roadmap?"

**Objection**

Platform risk.

**Weak answer**

"We're faster."

**Strong answer**

- **dbt** serves enterprises already on dbt Cloud; we serve teams **before** that commitment
- **Hex** is SaaS-first, US-priced; we're self-host-first with browser DuckDB
- **Incumbents** optimize for existing data teams; we optimize for **exploration → promotion** in one package

Win condition: integrated handoff + self-host + agent on the graph. Acquisition path exists if we prove it.

**Evidence needed**

- Competitive matrix cold-rehearsed
- Partner quote on why not Hex/dbt Cloud

---

## 8. "Show me retention."

**Objection**

No users, no NRR.

**Weak answer**

"Twitter interest."

**Strong answer**

Lab-period proxy metrics:

| Metric | Demo Day target |
|--------|-----------------|
| Design partners | ≥3 |
| WAU (modelers) | ≥5 |
| Models promoted to dbt | ≥3 |
| AI-assisted models | ≥10 |
| Week-2 return | ≥60% |

**Evidence needed**

- Partner onboarding checklist
- Event tracking defined (manual OK initially)

---

## Claim Rewrites

| Cut this | Say this instead |
|----------|------------------|
| "AI-native data notebook for African data teams" | "AI-native SQL notebook where each cell is a model" |
| "Revolutionizing analytics in Africa" | "The workbench between SQL exploration and production dbt" |
| "AI-powered BI platform" | "SQL notebook / data model IDE" |
| "Enterprise-grade seamless solution" | "Self-hosted in 30 minutes; promote to dbt when ready" |
| "Huge African TAM" | "Every seed-stage company with 0–2 data people; we start with 5–8 design partners" |
| "Our AI beats ChatGPT" | "Gemini operates on lineage, schema, and team standards" |
| "Africa-first unicorn" | "Global dev tool; Lab accelerates Gemini integration and first design partners" |

---

## Demo Day — Hostile Q&A

| Question | 30-second answer |
|----------|------------------|
| What is it? | SQL notebook where cells are models; promote to dbt when ready |
| Why you? | Built the full stack; lived the explore→production gap |
| Why now? | Agents need governed context; dbt is production standard; exploration tooling is fragmented |
| Why Google? | Gemini + our model graph + eval harness; Data Agent Kit + MCP fit |
| Why Africa Lab? | Co-development for Gemini integration, not market labeling |
| Biggest risk? | GTM speed; mitigated by design partners + Lab intros |
| What do you need? | Gemini access, cloud credits, partner intros, seed for GTM |
| Exit? | Strategic (dbt, Hex, GCP) or PLG at $5–20M ARR — not pitching exit |

---

## Red Flags — Kill Before Submitting

- [ ] "African data teams" anywhere in hero copy
- [ ] "Enterprise-grade," "seamless," "revolutionary"
- [ ] TAM slide with billions, no bottom-up math
- [ ] Claiming Gemini is live when it's roadmap
- [ ] Africa stats with no product substance behind them
- [ ] Demo requiring 5 min setup + flaky wifi
- [ ] No answer for wrong SQL (show Review + Fix with AI + dbt tests)

---

## Pre-Submission Checklist

- [ ] Demo rehearsed 5× (8 min max)
- [ ] Gemini milestones in application
- [ ] 1–2 design partner conversations documented
- [ ] Application copy matches deck — no Africa hero positioning
- [ ] "Why this Lab" answer is 60 sec, honest, not apologetic
