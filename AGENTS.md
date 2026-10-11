## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: prettier, tailwindcss, sveltekit-adapter, mcp

---

## Design-system lint (mandatory)

This project enforces its Tailwind design system with `@shadcn/lint` (ESLint).
The policy lives in `eslint.config.mjs` — read its comments before touching
any UI code; they document what callers may change per component family.

- After ANY UI/markup/class change, run `pnpm lint:design` and fix **all**
  `shadcn/*` warnings. Zero warnings is the bar — do not finish UI work dirty.
  The command must exit 0 with no output; it currently does.
- NEVER add `eslint-disable` for a `shadcn/*` rule to silence a finding.
  If the finding exposes a wrong policy, update `eslint.config.mjs` (with a
  rationale comment). If it exposes wrong code, fix the code.

How to write classes so lint stays green:

- **Dynamic values** → Svelte style directive + paren shorthand, never `style=`:
  `style:--panel-top="{y}px"` + class `top-(--panel-top)`. Directives accept
  only `var(--token)` refs or non-colors — never raw hex (user-supplied colors
  are the sole exception and are documented in the config, not in markup).
- **Never the bracket form**: `w-[var(--x)]` / `[calc(...)]` trips
  `no-arbitrary-values`. The `(--x)` shorthand (`w-(--x)`, `duration-(--motion-fast)`,
  `z-(--z-dropdown)`) is the project idiom and passes.
- **No `style=` attributes and no `style:` directives for regular properties**
  on any element. Static values become plain classes (`fixed`, `table-fixed`).
  `style:--x` directives are FORBIDDEN on components (Svelte compile error) —
  use a plain `style="--x: ..."` attribute there (custom-property-only is exempt).
- **Component classes must be statically readable**: string literals,
  `cond ? 'a' : 'b'`, `cond && 'a'` inside `cn(...)`. No template-literal
  building, no cross-file class constants at call sites (shared recipes live
  in `chip-styles.ts`; token/unknown-class rules still check that file).
  Wrapper components forward via `cn("defaults...", className)` so caller
  overrides win through tailwind-merge.
- **New global classes** → declare with `@utility` in `src/routes/layout.css`
  (see `no-print`, `dropzone-glow`, `text-kicker`), never as plain selectors.
  Plain selectors are invisible to the class graph.
- **New JS-hook/marker classes** (event delegation, `:global()` state hooks)
  must use a registered prefix (`nc-*`, `md-*`, `is-*`, `qb-*`, `iw-*`,
  `cf-*`, `inspector-*`, `picker-*`, `*-anchor`, … — full list in
  `eslint.config.mjs` as `PROJECT_VOCAB`). Anything else warns as unknown.
- **No raw palette colors** (`bg-amber-500` → `bg-warning`), no off-scale
  values (`text-[11px]` → `text-2xs`). Note `--spacing` is `0.22rem`, so the
  linter's scale-equivalent suggestions assume 4px — verify by hand.
- Destructive menu items use `data-variant="destructive"`, not `text-destructive`.

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists.
- Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation before raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current.
