// Markdoc widget boilerplates shared by the toolbar, slash palette, and catalog.
export const WIDGET_SNIPPETS = {
	callout: '{% callout type="info" %}\nYour message here.\n{% /callout %}',
	metric: '{% metric value=42 label="Metric" /%}',
	chart:
		'{% chart type="bar" data=[{category:"A",value:42},{category:"B",value:27}] x="category" y="value" /%}',
	datatable: '{% datatable data=[{category:"A",value:42},{category:"B",value:27}] /%}',
	columns:
		'{% columns %}\n{% column %}\nLeft content.\n{% /column %}\n{% column %}\nRight content.\n{% /column %}\n{% /columns %}',
	tabs: '{% tabs %}\n{% tab label="Tab 1" %}\nContent.\n{% /tab %}\n{% /tabs %}',
	card: '{% card title="Title" %}\nContent.\n{% /card %}',
	details: '{% details summary="Click to expand" %}\nHidden content.\n{% /details %}',
	filter: '{% filter kind="dropdown" param="param" label="Label" options=[] /%}',
	mermaid: '{% mermaid %}\ngraph TD\n    A --> B\n{% /mermaid %}',
	badge: '{% badge value="Ready" color="info" /%}',
	progress: '{% progress value=50 max=100 label="Progress" /%}',
	grid: '{% grid cols=3 %}\nContent.\n{% /grid %}',
	conditional: '{% if gt(1, 0) %}\nContent.\n{% else /%}\nFallback.\n{% /if %}',
	pivotTable:
		'{% datatable data=[{group_col:"A",pivot_col:"Q1",value_col:42},{group_col:"A",pivot_col:"Q2",value_col:27}] index=["group_col"] pivotBy="pivot_col" valueCol="value_col" agg="sum" valueFormatKind="number" /%}',
	summaryTable:
		'{% datatable data=[{group_col:"A",value_col:42},{group_col:"B",value_col:27}] index=["group_col"] valueCol="value_col" agg="sum" valueFormatKind="number" /%}',
	mermaidLoop:
		'{% mermaid %}\nkanban\n  {% group data=[{status:"Ready",id:"example",title:"Review"}] by="status" %}\n  $keyId[$key]\n    {% each data=$items %}\n    task_$id[$title]\n    {% /each %}\n  {% /group %}\n{% /mermaid %}',
	column: '{% column %}\nContent.\n{% /column %}',
	tab: '{% tab label="Tab 1" %}\nContent.\n{% /tab %}',
	group:
		'{% group data=[{group_column:"A",title:"Example",value:42,status:"Ready"}] by="group_column" %}\n{% card title="$key" %}\n{% each data=$items %}\n{% card title="$title" %}\n{% metric value=$value label="Value" /%}\n{% badge value="$status" /%}\n{% /card %}\n{% /each %}\n{% /card %}\n{% /group %}',
	each:
		'{% each data=[{title:"Example",value:42,status:"Ready"}] %}\n{% card title="$title" %}\n{% metric value=$value label="Value" /%}\n{% badge value="$status" /%}\n{% /card %}\n{% /each %}',
	else: '{% else /%}'
} as const;
