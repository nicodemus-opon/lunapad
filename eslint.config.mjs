import { plugin as shadcn } from '@shadcn/lint';
import { defineConfig } from 'eslint/config';
import tsParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';

/**
 * Lunapad design-system policy (@shadcn/lint).
 *
 * The policy below encodes how this product actually builds UI — a dense
 * notebook IDE where callers own control density (type size, padding) while
 * primitives own identity (shape language, motion, effects). Every `allow`
 * entry documents a deliberate product convention, not a suppression:
 * raw palette colors are still caught by `no-raw-colors`, off-scale values
 * by `no-arbitrary-values`, typos by `no-unknown-classes`, and unreadable
 * class expressions by `require-static-classes`.
 *
 * Boundaries:
 * - `src/lib/components/ui/**` are the primitives. They style themselves;
 *   all shadcn rules are off inside (upstream recommendation).
 * - `src/lib/components/gui/**` shares class recipes via `chip-styles.ts`
 *   string constants. `require-static-classes` cannot read cross-file
 *   imports by design, so it is off there; the token/unknown-class rules
 *   still check the recipe file itself.
 */

// Closed density type scale: the only type treatments callers may set on
// design-system components. Display sizes (text-lg+) belong to the primitive.
const DENSITY_TYPE = [
	'text-3xs',
	'text-2xs',
	'text-xs',
	'text-sm',
	'text-base',
	'font-mono',
	'font-medium',
	'font-semibold',
	'leading-*',
	'tracking-*',
	'truncate',
	'tabular-nums',
	'uppercase',
	'lowercase',
	'capitalize'
];

// Focus-ring convention: callers standardize keyboard focus to a 2px ring.
// (Primitives ship ring-3; the product-wide call-site standard is ring-2.
// The ring color + outline-none duplicate primitive base and were deleted
// on Button/Input; on bare triggers they are additive and stay allowed.)
const FOCUS_RING = [
	'focus-visible:ring-2',
	'focus-visible:ring-ring/50',
	'focus-visible:ring-ring',
	'outline-none',
	'focus-visible:outline-none'
];

// Motion convention: property-scoped transitions paced by --motion-* tokens
// (see --motion-fast/medium/slow in src/routes/layout.css).
const MOTION = ['transition-*', 'duration-*', 'ease-*', 'motion-reduce:*'];

const RESTYLE_BASE = ['layout', ...DENSITY_TYPE, ...FOCUS_RING, ...MOTION];

// First-party hook/marker classes: JS query hooks (closest('.lineage-node')),
// :global() state hooks (is-active), plain-selector chrome (sidebar-*,
// notebook-*, md-*) that Tailwind emits outside its utility graph, and the
// shared gui/chip-styles.ts recipe markers (stage-chip). Registered by
// prefix so a NEW unknown class still warns (typo-catcher). Prefixes were
// checked for Tailwind collisions — notably there is no `chart-*` glob
// (it would shadow theme colors); chart hook classes are covered by exact
// `chart-*-*` + the entries below without matching `*-chart-1` tokens.
const PROJECT_VOCAB = [
	'nc-*',
	'is-*',
	'md-*',
	'cf-*',
	'iw-*',
	'qb-*',
	'inspector-*',
	'picker-*',
	'sidebar-*',
	'notebook-*',
	'node-config-*',
	'chart-*',
	'lineage-*',
	'notion-*',
	'markdoc-*',
	'markdown-*',
	'control-*',
	'collapse*',
	'clear-*',
	'share-*',
	'add-*',
	'ai-*',
	'result-table',
	'result-table-*',
	'*-chip',
	'*-chip-*',
	'*-btn',
	'*-menu',
	'*-menu-item',
	'*-popover',
	'*-toolbar',
	'*-anchor',
	'*-chrome',
	'*-editor',
	// Declared via @utility in src/routes/layout.css, so no-unknown-classes
	// knows it — but the grammar cannot categorize custom CSS, hence the entry.
	'no-print'
];

const shadcnRules = {
	'shadcn/no-restyle': [
		'warn',
		{
			// PROJECT_VOCAB rides along everywhere: hook classes are
			// orthogonal to the appearance policy.
			allow: [...RESTYLE_BASE, ...PROJECT_VOCAB],
			contracts: [
				{
					// Field triggers render as bordered fields, not bare
					// buttons — the product's trigger pattern. Fully themed.
					pattern: '^(DropdownMenuTrigger|PopoverTrigger|TooltipTrigger)$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color', 'shape', 'effects']
				},
				{
					// Buttons: callers own density (spacing), quiet tint
					// treatments (ghost/menu hover states), and the closed
					// menu/toolbar radius set. Larger radii stay denied.
					pattern: '^Button$',
					allow: [
						...RESTYLE_BASE,
						...PROJECT_VOCAB,
						'spacing',
						'color',
						'rounded-none',
						'rounded-sm',
						'rounded',
						'rounded-md',
						'rounded-lg',
						'rounded-full',
						'border',
						'border-0',
						'border-2',
						'border-dashed'
					]
				},
				{
					// Ghost/chromeless field pattern (inline title edits,
					// transparent search inputs, muted option triggers).
					// focus-visible:ring-0 is the deliberate ring kill on
					// permanently chromeless inputs (QueryBlockNodeView).
					pattern: '^(Input|Textarea|NativeSelect|SelectTrigger|ChipInput)$',
					allow: [
						...RESTYLE_BASE,
						...PROJECT_VOCAB,
						'spacing',
						'color',
						'shadow-none',
						'focus-visible:ring-0',
						'rounded-none',
						'rounded-sm',
						'rounded',
						'rounded-md',
						'rounded-lg',
						'border',
						'border-0'
					]
				},
				{
					// Floating panels: flush (p-0/gap-0) layouts and the
					// elevated menu-surface treatment (AddStageMenu).
					pattern:
						'^(DialogContent|PopoverContent|DropdownMenuContent|SelectContent|TooltipContent|ContextMenuContent)$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color', 'effects']
				},
				{
					// Data tables own their chrome (cell padding, borderless
					// rows, sticky-column backgrounds).
					pattern:
						'^(Table|TableHeader|TableBody|TableFooter|TableRow|TableHead|TableCell|TableCaption)$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color', 'shape']
				},
				{
					// InlineChipLabel density + error/muted tints.
					pattern: '^InlineChipLabel$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color']
				},
				{
					// Embedded command palettes (ChartConfigPanel,
					// SlashMenu): borderless inside a p-0 popover to avoid
					// double chrome, with palette-owned empty/item rhythm.
					pattern: '^(Command|CommandEmpty|CommandInput|CommandItem|CommandList)$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color', 'shape', 'effects']
				},
				{
					// Menu item rhythm (indented rows, icon gaps).
					// Destructive items use data-variant="destructive".
					pattern: '^(DropdownMenuItem|ContextMenuItem)$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing']
				},
				{
					// Menu section labels: tighter + dimmer than the primitive.
					pattern: '^(DropdownMenuLabel|ContextMenuLabel)$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color']
				},
				{
					// Dialog section padding tunes to flush (p-0) content.
					pattern: '^(DialogHeader|DialogFooter)$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing']
				},
				{
					// Compact segmented controls (MarkdownModeBar).
					pattern: '^TabsTrigger$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing']
				},
				{
					// Skeleton radius must match the content being loaded
					// (avatars vs cards) — inherently caller-owned.
					pattern: '^Skeleton$',
					allow: [
						...RESTYLE_BASE,
						...PROJECT_VOCAB,
						'rounded-sm',
						'rounded-md',
						'rounded-lg',
						'rounded-full'
					]
				},
				{
					// Bare disclosure triggers (chevron + label rows).
					pattern: '^CollapsibleTrigger$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color']
				},
				{
					// Toolbar-style toggle groups carry their own divider
					// chrome (FilterPickerMenu, MediaInsertPopover).
					pattern: '^ToggleGroup$',
					allow: [...RESTYLE_BASE, ...PROJECT_VOCAB, 'spacing', 'color', 'shape']
				}
			]
		}
	],
	'shadcn/no-raw-colors': 'warn',
	'shadcn/no-arbitrary-values': [
		'warn',
		{
			allow: [
				// Property-scoped transitions are the motion convention
				// (paired with duration-(--motion-*) tokens).
				// transition-[all] stays banned (see deny).
				'transition-*',
				// Floating-surface geometry is viewport-relative by nature —
				// a fixed scale cap would break small screens.
				'max-h-[*vh]',
				'max-h-[min(78vh,34rem)]',
				'max-h-[min(720px,calc(100vh-2rem))]',
				'max-h-[calc(100vh-12rem)]',
				'max-h-[min(70vh,28rem)]',
				'h-[min(680px,calc(100vh-2rem))]',
				'w-[min(20rem,calc(100vw-2rem))]',
				'w-[min(22rem,calc(100vw-2rem))]',
				'w-[min(24rem,calc(100vw-2rem))]',
				'top-[20vh]',
				// Layout track templates are the layout, not theme values.
				'grid-cols-*',
				'grid-rows-*',
				// Project geometry tokens (declared in src/routes/layout.css).
				'mx-[var(--sidebar-row-inset)]',
				'px-[calc(var(--sidebar-panel-x)-var(--sidebar-row-inset))]',
				'h-[var(--sidebar-row-height)]',
				'py-[var(--notebook-cell-gap)]',
				'px-[var(--notebook-page-padding)]',
				'max-w-[var(--notebook-page-width)]',
				'grid-cols-[var(--notebook-gutter-width)_minmax(0,1fr)]',
				// Documented one-offs.
				'w-[calc(100%+1.5rem)]', // query-block document bleed (pairs -ml-[1.5rem])
				'-ml-[1.5rem]',
				'[appearance:textfield]', // native number-input spinner kill (TakeStage)
				'max-w-[12rem]', // breadcrumb truncation cap
				'min-w-[34rem]', // settings data-table content minima
				'min-w-[42rem]'
			],
			deny: ['transition-[all]']
		}
	],
	'shadcn/no-inline-styles': 'warn',
	'shadcn/no-unknown-classes': ['warn', { allow: PROJECT_VOCAB }],
	'shadcn/require-static-classes': 'warn'
};

export default defineConfig([
	{
		ignores: [
			'.svelte-kit/**',
			'build/**',
			'node_modules/**',
			'static/**',
			'e2e/**',
			'scripts/**',
			'**/*.test.ts'
		]
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser,
				extraFileExtensions: ['.svelte']
			}
		},
		plugins: { shadcn },
		rules: shadcnRules
	},
	{
		files: ['**/*.{js,ts}'],
		languageOptions: { parser: tsParser },
		plugins: { shadcn },
		rules: shadcnRules
	},
	{
		// Primitives style themselves.
		files: ['src/lib/components/ui/**'],
		rules: Object.fromEntries(Object.keys(shadcnRules).map((rule) => [rule, 'off']))
	},
	{
		// gui/ shares class recipes via chip-styles.ts string constants, which
		// require-static-classes cannot read across files by design. Token and
		// unknown-class rules still check the recipe file itself.
		files: ['src/lib/components/gui/**'],
		rules: { 'shadcn/require-static-classes': 'off' }
	}
]);
