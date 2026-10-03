# Storyboard notebook design system

The GM portal uses a warm notebook language: paper background, ivory panels, dark ink, quiet rules, and vermilion creative actions. Campaign art carries the world's colour. Interface chrome stays restrained so different campaigns still feel like one product.

This is the standalone website's system. RedLeaf management and extension settings retain Leaf's components, tokens, themes and Phosphor conventions through `@redbamboo/ui`. Standalone CSS never enters the federation entry.

## Foundations

| Purpose | Token / rule |
| --- | --- |
| Page / panel | `--paper` #F3EFE7 / `--ivory` #FFFCF6 |
| Primary / secondary text | `--ink` #20252A / `--muted` #62686D |
| Creative action | `--accent` #A93629 |
| Rules / field borders | `--rule` #D8D0C4 / `--field-border` #AEA699 |
| Error / success | Semantic foreground and tinted surface pairs; icon and text always accompany colour |
| Display type | Georgia serif; campaign titles and narrative headings |
| Interface type | Segoe UI with system fallback; labels, buttons, body copy and metadata |
| Type scale | 12 caption, 14 small, 16 body, 18 lead; responsive display headings |
| Spacing | 4px base; named spacing tokens shared across all screens |
| Shape | 4px controls, 8px panels; circles reserved for people |
| Interaction size | Minimum 44px controls and navigation targets |
| Focus | 3px vermilion outline with 4px offset |

Fonts are local/system fonts. No font CDN or extra authentication origin is required.

## Icons

Use `SiteIcon` from `web/src/site/icons.tsx`. It imports specific modules from the official `@phosphor-icons/react` package and supplies current text colour, regular weight, decorative SVG semantics, and standard sizes. Ordinary actions and tabs use 20px; compact badges 16px; prominent marks 32px. Do not replace icons with Unicode arrows, emoji, or a second icon family.

The icon vocabulary is stable: Notebook for the brand, Image for empty artwork, TextAlignLeft / UsersThree for tabs, Sparkle for generation, Plus for campaign creation, FloppyDisk for saving, Archive / ArrowCounterClockwise for archiving/restoring, MagnifyingGlass / UserPlus / UserMinus for roster actions, WarningCircle / CheckCircle for feedback. GoogleLogo accompanies the visible sign-in label.

Icons supplement visible labels; decorative icons are hidden from assistive technology. Controls keep their accessible names. Use an explicit accessible name if a future control has no visible label. Do not select icon classes in browser tests.

## Components and states

- Ink primary buttons commit ordinary actions. Vermilion buttons start creative generation. Secondary buttons are bordered. Membership removal uses the semantic danger treatment.
- Controls share padding, height, corner radius and focus/disabled rules. Hover and pressed states are defined centrally, not per screen.
- Cards share artwork ratio, content padding, divider and roster pattern. Tabs use a persistent underline plus text weight for selection.
- Error and success feedback use shared icon/text layout and semantic colours. Status messages remain live regions; errors remain alerts.
- Menus share surface, border, shadow and caret behaviour. Every action keeps its text label.
- Responsive layouts move from three/two/one campaign columns and collapse the editor and roster into a readable mobile flow.
- Motion is limited to brief state transitions and the loading indicator, disabled under reduced-motion preference.

## Adding a screen

Use existing tokens before adding a value. Reuse action, panel, field, feedback and navigation patterns. Introduce a token only for a new semantic purpose. Keep campaign data, drafts, media and authentication behaviour separate from presentation. Exactly two campaign tabs remain in this foundation: Description and Players.

## Validation

Typecheck and both Vite entry builds verify the source boundary. Existing browser fixtures exercise sign-in, permissions, campaign editing, generation recovery, rosters, keyboard access, desktop/tablet/mobile layouts, and the real Worker CSP. Fixture evidence proves source UI mechanics; production activation and real OAuth acceptance are separate.
