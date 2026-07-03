# Lunapad — Application Snippets (Google Africa Applied AI Lab)

Copy-paste for the [application form](https://labs.google/aifuturesfund/africaailab). Replace bracketed placeholders.

**Tone rule:** Product is global. Africa appears only where the form asks about Lab fit or regional impact — never as the product identity.

---

## Company / Product (short — ~500 chars)

**Lunapad** is a browser-native SQL notebook where each cell is a data model. Cells chain by name into automatic dependency graphs; teams explore with inline results, then promote models to production dbt files. Built for analyst-light teams that outgrew spreadsheets but aren't ready for a four-tool stack. Self-hosts via Docker; connects to DuckDB (in-browser), Postgres, ClickHouse, and MySQL via Trino.

---

## Product (long — ~1500 chars)

Lunapad is a data model IDE disguised as a notebook. Analysts and analytics engineers write PRQL or SQL in cells, each with an output name. Referencing another cell's name automatically resolves it as a CTE dependency — no manual `WITH` clause management. Results render inline; charts and Markdoc reports publish without a separate BI tool.

When a model is ready for production, Lunapad promotes it to a real dbt model on disk, with manifest-backed lineage and `dbt run` / `dbt test` integration. Scheduled materializations run via Inngest.

An AI assistant (discovery → modeling → generation → review) scaffolds models conversationally, respects workspace naming standards, and fixes compile errors in context. REST API and MCP expose notebooks, queries, and the dbt graph for external agents.

We target startups, agencies, and small data teams globally — anyone with 0–2 dedicated data people who need governed models without stitching together Hex + dbt Cloud + BI. Self-host deploys in under 30 minutes via Docker Compose.

**Lab co-development focus:** first-class Gemini/Gemma integration with eval harness, design-partner validation, and Data Agent Kit + MCP reference workflows.

---

## Impact / Why this matters (~800 chars)

*Use for "impact" fields — frame as problem + product fit, not regional stereotyping.*

Most small teams don't fail at data because they lack ambition. They fail because exploration and production live in different tools — notebooks for ad hoc SQL, dbt for production, BI for dashboards — with manual handoffs between each.

Lunapad collapses that loop: explore in a notebook, chain models by name, promote to dbt when ready. The AI assistant operates on schema, lineage, and team modeling standards — not generic text-to-SQL — so one person can ship what used to require an analytics engineer plus a BI admin.

Self-hosting means teams control where data lives. That's relevant for regulated industries globally, not one geography.

During the Lab program we'll onboard 3–5 design partners and measure time-to-first-production-model and weekly active usage.

---

## How we use Google AI (~800 chars)

Google AI is central to Lunapad's agent loop — not an add-on chatbot.

**Lab deliverables:**

1. **Gemini as default copilot** for discovery (check existing models), modeling (propose grain and dependencies), generation (PRQL/SQL into cells), review (self-score + suggest dbt tests).

2. **Context engineering:** every Gemini call packages schema, cell lineage, dbt manifest snippets, and workspace modeling standards.

3. **Gemma** for self-hosted deployments where API latency or cost matters.

4. **Eval harness:** 20+ golden tasks measuring modeling accuracy, duplicate detection, and error repair — iterated with Google mentors.

5. **MCP + Data Agent Kit:** Lunapad's MCP server exposes notebooks and dbt graph to Google's agent tooling ecosystem.

BYOK (Ollama, OpenAI-compatible) exists today for self-host sovereignty. Gemini becomes the optimized, eval-backed default through Lab co-development.

---

## Why Google Africa Applied AI Lab (~500 chars)

We're applying for **co-development**, not regional rebranding. Lunapad is a global SQL notebook; the Lab helps us ship Gemini-native AI correctly — with DeepMind model access, Research feedback on our eval harness, and VC partner intros for design partners.

The program's themes (work, knowledge, software development) map directly: multiply analyst output, document reproducible models, ship production dbt code. We commit to material Google AI integration and in-person Demo Day at AICC Accra.

---

## Traction / Stage (~400 chars)

**Stage:** Pre-launch. Working product: notebook, dbt integration, AI assistant (BYOK), MCP/API, self-host Docker, demo mode. No revenue or paid customers yet.

**Lab validation plan:** 3–5 design partners, Sep–Dec 2026. Success = weekly active usage, ≥3 models promoted to dbt, Gemini integration live with eval metrics.

---

## Team (~600 chars)

**[Founder name]** — [Role]. [X years] in [data engineering / analytics / full-stack product]. Built Lunapad end-to-end: SvelteKit frontend, Trino/dbt backend, AI agent loop with discovery/review stages, MCP server, Docker deployment.

**[Co-founder if applicable]** — [Role and background].

**Gaps:** developer relations, first GTM hire. Lab support requested for Gemini integration depth and design-partner intros via VC partners.

---

## The Ask (~300 chars)

1. Gemini/Gemma early access + technical mentorship  
2. Google Cloud credits for pilot hosting  
3. Design-partner intros via VC partners  
4. Demo Day slot (Dec 2026, Accra)  
5. Potential AI Futures Fund investment for Gemini sprint + GTM  

---

## One-liner (~25 words)

Lunapad is the AI-native SQL notebook where each cell is a model — explore in the browser, promote to dbt when ready.

---

## Demo Day hook

In eight minutes: raw Postgres → AI-generated lineage-aware cohort model → promoted to dbt → published as a board-ready report — one notebook, no tool switching.

---

## Thematic area mapping

| Lab theme | Lunapad fit |
|-----------|-------------|
| Future of work | AI copilot + sprint board for multi-model tasks |
| Knowledge | Models, lineage, reports as reproducible assets |
| Software development | Notebook → dbt; MCP/API for agentic workflows |
| Creativity | Markdoc reports with charts and widgets |
| Entertainment | Lower priority |

**Select:** Future of work, Knowledge, Software development.

---

## Risk disclosure

- Pre-launch: no revenue yet  
- Gemini integration is Lab deliverable, not fully shipped  
- AI-generated SQL requires review + dbt tests  
- GTM unproven; mitigated by design-partner program  
