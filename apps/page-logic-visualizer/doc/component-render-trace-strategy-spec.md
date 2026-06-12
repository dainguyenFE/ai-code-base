# Component Render Trace Strategy Specification

## 1. Purpose

This document defines how to trace the **render output** of a React/Next.js component in a static analysis tool.

The goal is to answer:

```txt
Component này render gì?
Node nào là React component?
Node nào là HTML semantic/layout?
Node nào chỉ là wrapper noise?
Condition/loop/event nằm ở đâu?
Props/data nào được đưa vào render tree?
```

This spec is part of the larger **Page Logic Visualizer** system.

---

## 2. Core problem

A React component render output usually contains many nodes:

```tsx
return (
  <section>
    <div>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
        <PricingCard />
      </div>
    </div>
  </section>
);
```

If the tool shows every JSX/HTML node, the graph becomes noisy:

```txt
Component
 └─ section
    └─ div
       └─ div
          ├─ h1
          ├─ p
          └─ PricingCard
```

This is not useful for overview.

The tool should create a **semantic render tree**, not just a raw JSX tree.

---

## 3. Main idea

Render Trace should support multiple detail levels:

```txt
1. Overview
   → Show React components, conditions, loops, events, major semantic regions

2. Structure
   → Show semantic HTML and layout regions

3. Raw JSX
   → Show full JSX tree, including div/span/h1/p/etc.
```

Default mode should be:

```txt
Overview
```

because most developers want to understand the page/component quickly.

---

## 4. Render node categories

Every JSX node should be classified.

```ts
type RenderNodeKind =
  | "react-component"
  | "semantic-html"
  | "html-wrapper"
  | "html-interactive"
  | "text-binding"
  | "condition"
  | "loop"
  | "fragment"
  | "slot"
  | "event"
  | "unknown";
```

---

## 5. Classification rules

### 5.1 React component

A JSX tag starting with an uppercase letter is a React component.

Examples:

```tsx
<PricingCard />
<Header />
<FAQSection />
```

Trace:

```txt
react-component: PricingCard
react-component: Header
react-component: FAQSection
```

Importance:

```txt
high
```

Show by default.

---

### 5.2 Semantic HTML

Semantic HTML tags should be kept in **Structure** mode and sometimes **Overview** mode.

Unlike `div`/`span` wrappers, semantic tags communicate **document structure**, **landmarks**, **content meaning**, or **native interaction**. The analyzer should classify them explicitly instead of treating all lowercase tags as generic HTML noise.

#### 5.2.1 Semantic tier model

Every semantic HTML node should carry a tier in `meta.semanticTier`. Tiers drive default visibility and label formatting.

```ts
type SemanticHtmlTier =
  | "landmark" // page/region landmarks (main, nav, header, …)
  | "region" // named sections (section, article, dialog, search, form shell)
  | "heading" // h1–h6
  | "content" // block content (p, blockquote, figure, details, hr, address, pre)
  | "list" // ul, ol, li, dl, dt, dd
  | "table" // table family
  | "form-control" // form, fieldset, label, input, select, textarea, button, …
  | "media" // img, picture, video, audio, canvas, svg, iframe, …
  | "text-inline" // a, strong, em, code, time, abbr, mark, …
  | "interactive"; // native controls with href/onClick/onChange (may overlap form-control)
```

Suggested default visibility:

| Tier             | Structure mode    | Overview mode                                                            |
| ---------------- | ----------------- | ------------------------------------------------------------------------ |
| `landmark`       | always show       | show when labeled, has `role`, contains condition/loop/component gate    |
| `region`         | always show       | show when `aria-label`, `aria-labelledby`, `id`, or named section        |
| `heading`        | always show       | show `h1`–`h2`; collapse `h3`–`h6` unless sole page title or has binding |
| `content`        | show              | hide unless contains binding, condition, or wraps component              |
| `list` / `table` | show              | hide unless dynamic (`map`), conditional, or wraps component             |
| `form-control`   | show              | show when has event handler, `name`, `htmlFor`, or validation attrs      |
| `media`          | show              | show when `src`/`alt` is dynamic or has `onClick`/`onLoad`               |
| `text-inline`    | show with binding | hide static inline text wrappers                                         |
| `interactive`    | show              | show (same as event-bearing nodes)                                       |

#### 5.2.2 Landmark & region elements

**Landmark tier** — page-level or app-shell regions. Prefer these for Overview “semantic regions”.

```txt
main
header
footer
nav
aside
```

**Region tier** — logical document sections and overlays.

```txt
section
article
dialog
search
form          // region shell; controls inside are form-control tier
```

Example:

```tsx
<main>
  <header>
    <nav aria-label="Primary">
      <a href="/pricing">Pricing</a>
    </nav>
  </header>
  <section aria-label="Pricing">
    <PricingCard />
  </section>
  <dialog open={isOpen} aria-labelledby="checkout-title">
    <CheckoutModal />
  </dialog>
</main>
```

Trace (Structure):

```txt
main
 ├─ header
 │   └─ nav: Primary
 │       └─ a.href → /pricing
 ├─ section: Pricing
 │   └─ PricingCard
 └─ dialog[aria-labelledby="checkout-title"]
     └─ CheckoutModal
```

Importance: `medium` (landmark/region), higher when labeled or gating children.

#### 5.2.3 Headings & block content

**Heading tier**

```txt
h1
h2
h3
h4
h5
h6
```

Store `meta.headingLevel` (1–6). Prefer expression or string child as label:

```tsx
<h1>{pageTitle}</h1>
<h2 id="plans-heading">Plans</h2>
```

Trace:

```txt
h1 → text-binding: pageTitle
h2#plans-heading: Plans
```

**Content tier**

```txt
p
blockquote
hr
address
pre
figure
figcaption
details
summary
datalist
```

Example:

```tsx
<figure>
  <img src={hero.src} alt={hero.alt} />
  <figcaption>{hero.caption}</figcaption>
</figure>
<details open={expanded}>
  <summary>FAQ</summary>
  <FAQList items={faqs} />
</details>
```

Trace (Structure):

```txt
figure
 ├─ img.alt ← hero.alt
 └─ figcaption → text-binding: hero.caption
details
 ├─ summary: FAQ
 └─ FAQList
```

#### 5.2.4 Lists & tables

**List tier**

```txt
ul
ol
li
dl
dt
dd
menu          // legacy; still seen in older codebases
```

When list items come from `.map()`, attach loop metadata to the list or `li` parent (see §5.7).

**Table tier**

```txt
table
caption
colgroup
col
thead
tbody
tfoot
tr
th
td
```

Example:

```tsx
<table aria-label="Plan comparison">
  <caption>Available plans</caption>
  <thead>
    <tr>
      <th scope="col">Name</th>
      <th scope="col">Price</th>
    </tr>
  </thead>
  <tbody>
    {plans.map((plan) => (
      <tr key={plan.id}>
        <td>{plan.name}</td>
        <td>{plan.price}</td>
      </tr>
    ))}
  </tbody>
</table>
```

Trace (Structure):

```txt
table: Plan comparison
 ├─ caption: Available plans
 ├─ thead → tr → th, th
 └─ tbody → loop: plans
     └─ tr → td (plan.name), td (plan.price)
```

#### 5.2.5 Form controls & native interactive elements

**Form-control tier** (native elements; React components like `<Input />` stay `react-component`).

```txt
form
fieldset
legend
label
button
input
textarea
select
option
optgroup
output
meter
progress
```

**Interactive tier** — classify as `html-interactive` when the node has handlers or navigation attrs, even if tag is semantic:

```txt
a            // href, onClick
button       // onClick, type="submit"
input        // onChange, onInput, onBlur
textarea
select
details      // onToggle
dialog       // onClose
video/audio  // onPlay, onPause, …
```

Example:

```tsx
<form onSubmit={handleSubmit} aria-label="Checkout">
  <fieldset disabled={isLoading}>
    <legend>Payment</legend>
    <label htmlFor="email">Email</label>
    <input id="email" name="email" onChange={onEmailChange} />
    <button type="submit">Pay</button>
  </fieldset>
</form>
```

Trace:

```txt
form.onSubmit → handleSubmit [Checkout]
 └─ fieldset
     ├─ legend: Payment
     ├─ label → htmlFor: email
     ├─ input.onChange → onEmailChange
     └─ button[type=submit]
```

#### 5.2.6 Media & embedded content

**Media tier**

```txt
img
picture
source
video
audio
track
canvas
svg
iframe
embed
object
```

Show in Overview when `src`, `alt`, `poster`, or children are dynamic bindings.

```tsx
<picture>
  <source srcSet={hero.avif} type="image/avif" />
  <img src={hero.src} alt={hero.alt} />
</picture>
```

Trace:

```txt
picture
 ├─ source.srcSet ← hero.avif
 └─ img
     ├─ src ← hero.src
     └─ alt ← hero.alt
```

#### 5.2.7 Text-level (inline) semantics

**Text-inline tier** — meaningful inline markup. Default hidden in Overview unless they wrap a **text-binding** or event.

```txt
a
abbr
b
cite
code
data
em
i
kbd
mark
q
s
samp
small
strong
sub
sup
time
u
var
wbr
ruby
rt
rp
```

Example:

```tsx
<p>
  Updated <time dateTime={updatedAt}>{formattedDate}</time> — read the{" "}
  <a href={docsUrl}>docs</a>.
</p>
```

Trace (Structure):

```txt
p
 ├─ time[dateTime] → text-binding: formattedDate
 └─ a.href ← docsUrl
```

#### 5.2.8 Promoting wrappers to semantic HTML

`div` and `span` are **html-wrapper** by default, but must be **upgraded** to `semantic-html` when they carry landmark semantics:

```txt
role="banner" | "navigation" | "main" | "contentinfo" | "complementary" | "search" | "form" | "region" | "dialog"
aria-label
aria-labelledby
aria-describedby (secondary label only)
id when referenced by aria-labelledby on a child landmark
```

Example:

```tsx
<div role="navigation" aria-label="Account">
  <AccountMenu />
</div>
```

Trace (Structure):

```txt
nav[role=navigation]: Account    // display as semantic region, not wrapper
 └─ AccountMenu
```

Do **not** promote solely because of `className` (e.g. `className="header"` is not a semantic header).

#### 5.2.9 Semantic label derivation

Display label priority for semantic nodes:

```txt
1. aria-label
2. aria-labelledby → resolve #id text (static string or binding)
3. associated <label htmlFor="…">
4. alt (img)
5. placeholder (input/textarea)
6. title
7. visible string literal child (if short)
8. tag name fallback: "section", "nav", "h2", …
```

Format examples:

```txt
section: Plans
nav: Primary
h2#plans-heading: Plans
table: Plan comparison
img[alt=Hero banner]
```

#### 5.2.10 Canonical tag registry

Implementation should use a single registry (case-insensitive JSX tag names):

```ts
export const SEMANTIC_HTML_REGISTRY = {
  landmark: ["main", "header", "footer", "nav", "aside"],
  region: ["section", "article", "dialog", "search", "form"],
  heading: ["h1", "h2", "h3", "h4", "h5", "h6"],
  content: [
    "p",
    "blockquote",
    "hr",
    "address",
    "pre",
    "figure",
    "figcaption",
    "details",
    "summary",
    "datalist",
  ],
  list: ["ul", "ol", "li", "dl", "dt", "dd", "menu"],
  table: [
    "table",
    "caption",
    "colgroup",
    "col",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
  ],
  "form-control": [
    "form",
    "fieldset",
    "legend",
    "label",
    "button",
    "input",
    "textarea",
    "select",
    "option",
    "optgroup",
    "output",
    "meter",
    "progress",
  ],
  media: [
    "img",
    "picture",
    "source",
    "video",
    "audio",
    "track",
    "canvas",
    "svg",
    "iframe",
    "embed",
    "object",
  ],
  "text-inline": [
    "a",
    "abbr",
    "b",
    "cite",
    "code",
    "data",
    "em",
    "i",
    "kbd",
    "mark",
    "q",
    "s",
    "samp",
    "small",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
    "wbr",
    "ruby",
    "rt",
    "rp",
  ],
} as const;

export type SemanticHtmlTier = keyof typeof SEMANTIC_HTML_REGISTRY;

export const HTML_WRAPPER_TAGS = ["div", "span"] as const;

/** Tags not in registry and not wrappers → kind: unknown (Raw JSX only). */
export function resolveSemanticTier(
  tagName: string
): SemanticHtmlTier | undefined {
  const tag = tagName.toLowerCase();
  for (const [tier, tags] of Object.entries(SEMANTIC_HTML_REGISTRY)) {
    if ((tags as readonly string[]).includes(tag)) {
      return tier as SemanticHtmlTier;
    }
  }
  return undefined;
}
```

Classification algorithm:

```txt
1. Uppercase first letter → react-component
2. tag in SEMANTIC_HTML_REGISTRY → semantic-html (+ meta.semanticTier)
3. tag in HTML_WRAPPER_TAGS → html-wrapper, unless upgraded by role/aria (§5.2.8)
4. has onClick/onSubmit/onChange/href → html-interactive (may also be semantic-html)
5. otherwise lowercase unknown tag → unknown (show in Raw JSX only)
```

Minimal example (same as before):

```tsx
<section aria-label="Pricing">
  <PricingCard />
</section>
```

Trace:

```txt
section: Pricing
 └─ PricingCard
```

Importance:

```txt
medium (tier-dependent; landmark/region labeled → medium–high)
```

Show in **Structure** mode by default.

Show in **Overview** mode only if tier ≥ region, or the node has a meaningful label, `role`, event, condition/loop child, or wraps a logic gate.

---

### 5.3 HTML wrapper

Wrapper tags usually add layout/styling but not logic.

Examples:

```tsx
<div className="container">
<span className="text-muted">
```

Trace classification:

```txt
html-wrapper
```

Importance:

```txt
low
```

Hidden by default in Overview mode.

Visible in Raw JSX mode.

---

### 5.4 Interactive HTML

HTML nodes should be shown if they contain events or user interaction.

These tags are usually **also** semantic (`form-control`, `text-inline`, or `region`); classify **both**:

```txt
kind: html-interactive   // event / navigation edge
meta.semanticTier: …      // structural meaning (§5.2.5)
```

Examples:

```tsx
<button onClick={handleSubmit}>Submit</button>
<form onSubmit={handleSubmit}>...</form>
<input onChange={handleChange} />
<a href="/pricing">Pricing</a>
<select onChange={onPlanChange} />
<dialog onClose={onClose} />
```

Trace:

```txt
button.onClick → handleSubmit
form.onSubmit → handleSubmit
input.onChange → handleChange
a.href → /pricing
select.onChange → onPlanChange
dialog.onClose → onClose
```

Importance:

```txt
medium/high
```

Show by default if it has event handlers or navigational `href`.

---

### 5.5 Text binding

Text bindings are JSX expressions rendered as text.

Example:

```tsx
<h1>{title}</h1>
```

Trace:

```txt
text-binding: title
```

Importance:

```txt
low/medium
```

Show when the binding depends on important data or when user enables data/text bindings.

---

### 5.6 Condition

Conditional rendering should always be shown.

Examples:

```tsx
{
  hasPlans && <PricingPlans />;
}
```

Trace:

```txt
condition: hasPlans
 └─ true → PricingPlans
```

Ternary:

```tsx
{
  isLoading ? <Skeleton /> : <Content />;
}
```

Trace:

```txt
condition: isLoading
 ├─ true  → Skeleton
 └─ false → Content
```

Importance:

```txt
high
```

Always show.

---

### 5.7 Loop

List rendering should always be shown.

Example:

```tsx
{
  plans.map((plan) => <PricingCard key={plan.id} plan={plan} />);
}
```

Trace:

```txt
loop: plans.map(plan)
 └─ PricingCard
      └─ prop.plan = plan
```

Importance:

```txt
high
```

Always show.

---

### 5.8 Fragment

Fragments are usually not important.

Examples:

```tsx
<>
  <Header />
  <Footer />
</>
```

Trace:

```txt
fragment
 ├─ Header
 └─ Footer
```

Importance:

```txt
low
```

Hidden by default.

---

### 5.9 Slot

Slots should be shown when tracing layouts or composition.

Examples:

```tsx
{
  children;
}
```

Trace:

```txt
slot: children
```

Importance:

```txt
high
```

Always show for layout trace.

---

## 6. Importance scoring

Each render node should have an importance score.

```ts
type RenderNodeImportance = "high" | "medium" | "low";
```

Suggested rules:

```txt
React component      → high
Condition            → high
Loop                 → high
Slot                 → high
Event                → high
Interactive HTML     → medium/high
Semantic HTML        → medium (tier-dependent; see §5.2.1)
  landmark/region    → medium–high when labeled
  heading h1–h2    → medium
  heading h3–h6    → low–medium
  form-control       → medium when interactive
  list/table         → medium in Structure; low in Overview unless dynamic
  text-inline        → low unless binding/event
Text binding         → low/medium
HTML wrapper         → low
Fragment             → low
```

Node schema:

```ts
type RenderNode = {
  id: string;
  kind: RenderNodeKind;
  label: string;
  file: string;
  line?: number;
  importance: RenderNodeImportance;
  hiddenByDefault?: boolean;
  props?: Record<string, string>;
  meta?: Record<string, unknown>;
};
```

---

## 7. Render modes

### 7.1 Overview mode

Default mode.

Show:

```txt
- React components
- conditions
- loops
- events
- children slots
- important semantic regions
```

Hide:

```txt
- div/span wrappers
- fragments
- simple text tags
- low-importance HTML
```

Example:

```txt
PricingPage
 ├─ PricingHero
 ├─ condition: hasPlans
 │   ├─ true  → PricingPlans
 │   └─ false → EmptyState
 └─ button.onClick
     └─ pricing.onSubmit
```

---

### 7.2 Structure mode

Show semantic layout structure.

Show:

```txt
- landmark: main, header, footer, nav, aside
- region: section, article, dialog, search, form
- heading: h1–h6
- content: p, figure, details, blockquote, …
- list/table families when present
- form-control shell (fieldset, legend, label) + native controls
- media with dynamic src/alt
- React components
- condition/loop/event
- div/span promoted via role/aria (§5.2.8)
```

Example:

```txt
PricingPage
 └─ main
     ├─ section: Hero
     │   └─ PricingHero
     ├─ section: Plans
     │   └─ condition: hasPlans
     │       ├─ PricingPlans
     │       └─ EmptyState
     └─ section: CTA
         └─ button.onClick
```

---

### 7.3 Raw JSX mode

Show every JSX node.

Show:

```txt
- all HTML tags
- all React components
- fragments
- text bindings
- conditions
- loops
```

Example:

```txt
PricingPage
 └─ main
     ├─ section[aria-label="Hero"]
     │   └─ PricingHero
     ├─ section[aria-label="Plans"]
     │   └─ ternary: hasPlans
     │       ├─ PricingPlans
     │       └─ EmptyState
     └─ section[aria-label="CTA"]
         └─ button
             └─ text: "Start now"
```

---

## 8. Example input

```tsx
export function PricingPage() {
  const pricing = usePricingPage();
  const visiblePlans = pricing.plans.filter((p) => p.visible);
  const hasPlans = visiblePlans.length > 0;

  return (
    <main>
      <section aria-label="Hero">
        <PricingHero title={pricing.heroTitle} />
      </section>

      <section aria-label="Plans">
        {hasPlans ? (
          <PricingPlans plans={visiblePlans} />
        ) : (
          <EmptyState message="No plans available" />
        )}
      </section>

      <section aria-label="CTA">
        <button onClick={pricing.onSubmit}>Start now</button>
      </section>
    </main>
  );
}
```

---

## 9. Example output: Overview mode

```txt
PricingPage
 ├─ PricingHero
 │   └─ props.title ← pricing.heroTitle
 ├─ condition: hasPlans
 │   ├─ true  → PricingPlans
 │   │          └─ props.plans ← visiblePlans
 │   └─ false → EmptyState
 └─ button.onClick
     └─ pricing.onSubmit
```

---

## 10. Example output: Structure mode

```txt
PricingPage
 └─ main
     ├─ section: Hero
     │   └─ PricingHero
     ├─ section: Plans
     │   └─ condition: hasPlans
     │       ├─ PricingPlans
     │       └─ EmptyState
     └─ section: CTA
         └─ button.onClick
```

---

## 11. Example output: Raw JSX mode

```txt
PricingPage
 └─ main
     ├─ section[aria-label="Hero"]
     │   └─ PricingHero
     ├─ section[aria-label="Plans"]
     │   └─ ternary: hasPlans
     │       ├─ PricingPlans
     │       └─ EmptyState
     └─ section[aria-label="CTA"]
         └─ button
             └─ text: "Start now"
```

---

## 12. HTML node visibility rules

A HTML node should be visible by default if:

```txt
- It is semantic HTML (any tier in SEMANTIC_HTML_REGISTRY, §5.2.10)
- semanticTier is landmark, region, heading, form-control, or interactive
- It has event handlers (onClick, onSubmit, onChange, href, …)
- It has aria-label, aria-labelledby, or landmark role
- It has meaningful data-* attributes (data-testid alone is not enough)
- It has ref
- It has dangerouslySetInnerHTML
- It has dynamic className/style or dynamic src/alt/placeholder
- It is a native form element (input, button, select, textarea, …)
- It contains a condition or loop
- It contains children slot
- It wraps a React component and is the nearest semantic ancestor (region/landmark)
- div/span upgraded per §5.2.8 (role + label)
```

A HTML node should be hidden by default if:

```txt
- It is div/span used only for layout (no role/aria upgrade)
- It has only static className
- It has no event and no semantic tier
- It has no semantic role
- It only wraps another node (single-child pass-through wrapper)
- semanticTier is text-inline with static children only
- semanticTier is list/table with static markup and no loop
```

---

## 13. Render groups

The analyzer should group low-importance HTML wrappers into compact nodes.

Example:

```tsx
<div className="container">
  <div className="grid">
    <PricingCard />
  </div>
</div>
```

Instead of:

```txt
div.container
 └─ div.grid
     └─ PricingCard
```

Overview should show:

```txt
layout wrappers collapsed
 └─ PricingCard
```

Inspector can still show the hidden wrappers.

---

## 14. Props integration

Render Trace should include props passed to React components.

Example:

```tsx
<PricingPlans plans={visiblePlans} />
```

Trace:

```txt
PricingPlans
 └─ props.plans ← visiblePlans
```

If the prop expression is complex:

```tsx
<PricingCard active={plan.id === selectedPlanId} />
```

Trace:

```txt
PricingCard.props.active
 ├─ expression: plan.id === selectedPlanId
 └─ depends on:
    - plan.id
    - selectedPlanId
```

This should link to Props Trace and Data Flow Trace.

---

## 15. Event integration

Render Trace should detect event props on components and HTML nodes.

Examples:

```tsx
<button onClick={handleSubmit} />
<Button onClick={() => onSelect(plan.id)} />
<form onSubmit={handleSubmit} />
```

Trace:

```txt
button.onClick → handleSubmit
Button.onClick → inline handler → onSelect(plan.id)
form.onSubmit → handleSubmit
```

This should link to Event / Action Trace.

---

## 16. Condition integration

Render Trace should preserve branch structure.

### Logical AND

```tsx
{
  showBanner && <Banner />;
}
```

Trace:

```txt
condition: showBanner
 └─ true → Banner
```

### Ternary

```tsx
{
  isLoading ? <Skeleton /> : <Content />;
}
```

Trace:

```txt
condition: isLoading
 ├─ true  → Skeleton
 └─ false → Content
```

### Early return

```tsx
if (!data) return <EmptyState />;
```

Trace:

```txt
early return: !data
 └─ EmptyState
```

---

## 17. Loop integration

Render Trace should preserve list rendering.

Example:

```tsx
{
  plans.map((plan) => <PricingCard key={plan.id} plan={plan} />);
}
```

Trace:

```txt
loop: plans.map(plan)
 ├─ item variable: plan
 ├─ key: plan.id
 └─ PricingCard.props.plan ← plan
```

This should connect to Variable Trace and Props Trace.

---

## 18. Slot integration

For layouts and composition components:

```tsx
<Shell>{children}</Shell>
```

Trace:

```txt
Shell
 └─ slot: children
```

For layout:

```tsx
<main>{children}</main>
```

Trace:

```txt
main
 └─ children slot
```

This should connect to Layout Trace and Route Trace.

---

## 19. Render trace schema

```ts
export type ComponentRenderTrace = {
  kind: "component-render-trace";

  component: {
    name: string;
    file: string;
    line?: number;
  };

  modes: {
    overview: RenderGraph;
    structure: RenderGraph;
    rawJsx: RenderGraph;
  };

  diagnostics: RenderTraceDiagnostic[];
};

export type RenderGraph = {
  nodes: RenderTraceNode[];
  edges: RenderTraceEdge[];
};

export type RenderTraceNode = {
  id: string;
  kind:
    | "react-component"
    | "semantic-html"
    | "html-wrapper"
    | "html-interactive"
    | "text-binding"
    | "condition"
    | "loop"
    | "fragment"
    | "slot"
    | "event"
    | "unknown";

  label: string;
  file: string;
  line?: number;

  importance: "high" | "medium" | "low";
  hiddenByDefault?: boolean;

  tagName?: string;
  props?: Record<string, string>;

  meta?: {
    ariaLabel?: string;
    ariaLabelledBy?: string;
    role?: string;
    className?: string;
    eventName?: string;
    condition?: string;
    loopSource?: string;
    loopItem?: string;
    textExpression?: string;
    /** §5.2.1 — drives Structure vs Overview visibility */
    semanticTier?: SemanticHtmlTier;
    /** 1–6 for h1–h6 */
    headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    /** Resolved from role= when tag is div/span */
    landmarkRole?:
      | "banner"
      | "navigation"
      | "main"
      | "contentinfo"
      | "complementary"
      | "search"
      | "form"
      | "region"
      | "dialog";
    htmlFor?: string;
    href?: string;
    alt?: string;
    promotedFromWrapper?: boolean;
  };
};

export type RenderTraceEdge = {
  id: string;
  from: string;
  to: string;

  type:
    | "renders"
    | "contains"
    | "condition-true"
    | "condition-false"
    | "loop-render"
    | "passes-prop"
    | "handles-event"
    | "slot"
    | "text-binding";

  label?: string;
};

export type RenderTraceDiagnostic = {
  level: "info" | "warning" | "error";
  message: string;
  file?: string;
  line?: number;
};
```

---

## 20. Diagnostics

The analyzer should emit diagnostics for patterns that may be incomplete.

Examples:

```txt
Warning: Spread props detected. Prop trace may be incomplete.
Warning: Dynamic component detected. Render trace may be incomplete.
Warning: Conditional render contains non-JSX expression.
Warning: Unsupported JSX expression in render tree.
Info: 12 low-importance HTML wrappers hidden in Overview mode.
```

Dynamic component example:

```tsx
const Component = components[type];
return <Component />;
```

Trace:

```txt
dynamic component: Component
```

Diagnostic:

```txt
Warning: Dynamic component cannot be resolved statically.
```

---

## 21. UI requirements

The viewer should have a render mode selector:

```txt
View: [Overview | Structure | Raw JSX]
```

### Overview UI

```txt
Component
 ├─ major child components
 ├─ conditions
 ├─ loops
 └─ events
```

### Structure UI

```txt
Component
 └─ semantic layout regions
     └─ child components
```

### Raw JSX UI

```txt
Component
 └─ full JSX tree
```

---

## 22. Node details panel

When the user clicks a render node, the right panel should show node details.

### React component node

```txt
Node: PricingPlans
Kind: React Component
File: PricingPage.tsx:15

Props:
- plans = visiblePlans

Actions:
- Trace component
- Trace props
- Open source
```

### Semantic HTML node

```txt
Node: section
Label: Plans
Kind: semantic-html
Tier: region
File: PricingPage.tsx:14

Attributes:
- aria-label = "Plans"

Contains:
- condition: hasPlans
- PricingPlans
- EmptyState

Actions:
- Show raw JSX
- Focus subtree
- Open source
```

### Heading semantic node

```txt
Node: h2
Label: Plans
Kind: semantic-html
Tier: heading
Heading level: 2
File: PricingPage.tsx:18
Id: plans-heading

Actions:
- Trace text binding
- Open source
```

### Promoted wrapper semantic node

```txt
Node: div[role=navigation]
Label: Account
Kind: semantic-html
Tier: landmark
Promoted from: html-wrapper
Landmark role: navigation
File: AppShell.tsx:42

Actions:
- Show original div in Raw JSX
- Open source
```

### Interactive HTML node

```txt
Node: button.onClick
Kind: html-interactive
File: PricingPage.tsx:22

Event:
onClick = pricing.onSubmit

Actions:
- Trace event
- Trace hook
- Open source
```

---

## 23. MVP scope

The first MVP should support:

```txt
- Detect React components
- Detect semantic HTML via SEMANTIC_HTML_REGISTRY (§5.2.10)
- Assign semanticTier + headingLevel + labels (§5.2.9)
- Promote div/span with landmark role/aria to semantic-html (§5.2.8)
- Hide div/span wrappers in Overview mode
- Detect conditions: && and ternary
- Detect loops: map()
- Detect event handlers
- Detect props passed to React components
- Detect children slot
- Produce Overview graph
- Produce Structure graph
- Produce Raw JSX graph
```

MVP can skip:

```txt
- perfect dynamic component resolution
- all possible JSX expression cases
- deep styling/className analysis
- runtime DOM verification
```

---

## 24. Implementation phases

### Phase 1: Raw JSX parser

```txt
- Parse return JSX
- Build raw JSX tree
- Detect tag names and locations
```

### Phase 2: Classification

```txt
- Classify React components
- Classify semantic HTML (registry + tier + label derivation)
- Classify wrappers and role/aria promotion
- Classify form-control vs html-interactive overlap
- Classify events
- Classify condition/loop/slot
```

### Phase 3: Graph generation

```txt
- Generate Raw JSX graph
- Generate Structure graph by filtering/grouping nodes
- Generate Overview graph by hiding low-importance nodes
```

### Phase 4: Cross-trace integration

```txt
- Connect props to Props Trace
- Connect variables to Variable/Data Flow Trace
- Connect events to Event Trace
- Connect slots to Layout/Route Trace
```

### Phase 5: UI integration

```txt
- Add render mode selector
- Add node detail panel
- Add expand/collapse hidden wrappers
```

---

## 25. Acceptance criteria

The implementation is acceptable when:

```txt
1. It can parse JSX returned by a component.
2. It can identify React child components.
3. It can identify semantic HTML by tier (landmark, region, heading, list, table, form-control, media, text-inline).
4. It hides low-value div/span wrappers in Overview mode.
5. It shows condition render nodes.
6. It shows loop render nodes.
7. It shows event nodes.
8. It links props passed to child components.
9. It can switch between Overview, Structure, and Raw JSX modes.
10. It emits diagnostics instead of crashing on unsupported JSX.
```

---

## 26. Final recommendation

Render Trace should not be a raw DOM/JSX dump.

It should be a layered semantic graph:

```txt
Overview
  → What matters most

Structure
  → How the component is visually/semantically arranged

Raw JSX
  → Exact JSX tree for deep inspection
```

Default should be:

```txt
Overview mode
```

because it gives the clearest answer to:

```txt
What does this component render?
```

In short:

```txt
Render Trace = semantic render tree + logic nodes + component boundaries + optional raw JSX.
```
