import { cva, type VariantProps } from "class-variance-authority";

/**
 * The boxed glyph, everywhere in this app: a square holding one small icon.
 *
 * There are a lot of these — a decision's status on the rail, the Changelog's
 * shipped mark and its forge mark, a finding's priority, a playlist step's
 * position, a junction case, the "add one here" tiles, the hash that copies an
 * id, the species glyph on a cross-reference row. They were two families that
 * had each already been cloned: a 24px `ICON_TILE` declared in
 * `components/journal/DeliverableHoverCard.tsx` and imported by six unrelated
 * modules, copied verbatim into `FindingsBoard` as `MARK_CLASS`; and a 20px
 * bordered plate written out longhand in both `EntityBadges` and `EntityRow`.
 *
 * **A class builder, not a component.** These twelve call sites are a `<span>`,
 * a `<button>`, an `<a>`, a `DropdownMenuTrigger asChild` and a
 * `CollapsibleTrigger` — a component would have to be polymorphic over all of
 * them to earn its place, and each site would then pass its element back in.
 * `buttonVariants` is the same shape for the same reason, and it is the pattern
 * this repo already reaches for.
 *
 * **Two sizes, named.** `sm` is 20px at `rounded`, `md` is 24px at
 * `rounded-md` — the radius steps with the box so the corner stays the same
 * proportion of it. Both hold a 12px glyph. The split is real rather than
 * accidental: `md` is what a mark on a rail wants, where the tile is the thing
 * you scan down a column; `sm` is what a chip inside a row wants, where the
 * text is the thing and the glyph rides along. A row of `sm` plates does not
 * set a 24px floor under every line of a dense panel list.
 */
export const iconChipVariants = cva(
  "inline-flex shrink-0 items-center justify-center transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        sm: "size-5 rounded",
        md: "size-6 rounded-md",
      },
      variant: {
        /**
         * No border; the caller supplies the tint. The default is the neutral
         * one, so `iconChipVariants()` alone is already a usable mark.
         *
         * Colour rides on the tile and any label beside it stays system
         * foreground — the rule the forge mark states and every mark here
         * follows, because a purple word next to a purple box says it twice
         * and reads worse doing it.
         */
        plain: "bg-muted text-muted-foreground",
        /** The bordered plate: a chip that sits *in* a row rather than leading one. */
        outline: "border border-border bg-muted/50 text-muted-foreground",
        /** Not filled in yet — the "add one here" tiles. Caller supplies the hue. */
        dashed: "border border-dashed",
        /** Tint supplied entirely by the caller (a status colour, a species accent). */
        bare: "",
      },
      /** Hover and focus affordances, for the ones that are actually controls. */
      interactive: {
        true: "cursor-pointer outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        false: "",
      },
      /**
       * Set on a tile that **leads a line of `text-sm`** — a timeline entry's
       * title, a list row's name.
       *
       * A 24px box at the top of its column centres 2px below a 20px line, so
       * the mark reads as sitting slightly low against the words it belongs to.
       * This was a hand-written `-mt-0.5` at the Changelog's ship mark and then
       * copied to the Decision log's status mark; a third call site would have
       * copied it again. It belongs to the geometry, so it lives here.
       *
       * An `sm` chip is already 20px and needs none of this, so `lead` is an
       * `md` concern and the `sm` call sites leave it alone.
       */
      lead: {
        true: "-mt-0.5",
        false: "",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "plain",
      interactive: false,
      lead: false,
    },
  },
);

export type IconChipVariants = VariantProps<typeof iconChipVariants>;

/**
 * The row a chip and its label form together: the tile, then the words
 * *beside* it rather than inside it.
 *
 * The Changelog's forge and touched-node marks are these, and so are the
 * Decision log's two counts — a glyph, a short label, and a preview behind
 * both. Lives next to {@link iconChipVariants} because it is the same
 * vocabulary: this is what a chip looks like once it has something to say.
 *
 * The `group` is what lets the tile light up from a hover anywhere on the row,
 * label included. It is unnamed, and safely so: these marks never nest.
 */
export const ICON_CHIP_ROW =
  "group inline-flex items-center gap-2 rounded-md text-xs transition-colors";
