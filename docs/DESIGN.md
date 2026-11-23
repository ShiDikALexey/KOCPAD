# Design direction

A short record of the visual decisions behind KOCPAD, and of the polish pass done
with the [unslop](https://github.com/heydamir/unslop) method by Damir Sokolovsky
(CC BY 4.0). The goal is not a new look, but a deliberate one.

## Direction

- **Product.** A markdown notepad for Windows for people who write daily and want
  plain files, not a database.
- **Character.** Calm, exact, a little warm.
- **World.** Paper, ink and a desk lamp: warm neutrals, a single amber marker
  accent, serif reading type next to a mono editor.
- **Moments.** The rendered note reads like a typeset page; the assistant's
  lavender annotations are the second, semantic moment.
- **Signature.** An amber marker stroke: the active tab underline and the active
  line in the editor. One detail, used consistently.

## Audit (light slop, polish mode)

Kept: the palette, the serif preview, the mono editor, the line icons and the
layout. Fixed:

- The accent focus ring was drawn around the whole settings/dialog shell because
  the modal receives programmatic focus. The ring now belongs to controls only.
- Settings used a 13/6/2px rhythm; it is now on the 4px grid (16px sections,
  8px rows, 20px body padding).
- Section labels were 11px with wide tracking; now 12px, sentence case, muted.
- The empty state sat high in the pane with a dead band below; it is vertically
  centred now.
- The sidebar repeated the hero's primary "Открыть папку" button; the duplicate
  is gone, the header and hero keep the action.
- The "KOCPAD" eyebrow lost its 0.2em tracked-label look.

## What stays

- One accent (amber) for selection, primary action and the marker detail.
- Warm neutral ramp in both themes; colour lives in content, not chrome.
- No gradients, glows or colour shadows.
- Line icons at one size, no emoji labels.
- The assistant keeps lavender because it carries meaning, not decoration.

## When changing UI

Read this file first. New surfaces should fit the direction above; a new colour
or decorative effect needs a reason from the product, not from a trend.
