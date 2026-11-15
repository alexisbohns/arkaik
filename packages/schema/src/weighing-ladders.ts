/**
 * The reach ladders of `value-contribution@2` — what each level of each element
 * of value means, measured by REACH in a person's life (docs/rfcs/weighing.md § 8):
 * +1 within the product, +2 across the domain the product belongs to, +3
 * life-wide; the negatives mirror them. 0 is the scale's own anchor ("weighed,
 * unrelated") and is not repeated here.
 *
 * **Reviewed by the owner (2026-11-15).** Drafted in the Jev weighing POC, then
 * accepted, edited or re-proposed one element at a time. The rules that came out
 * of the review:
 *  - No examples in a rung: a scorer would match a promise against the example
 *    instead of weighing its reach.
 *  - Nothing the promise cannot show: no comparison with other products, no
 *    "the best they have used".
 *  - A negative ladder starts at "gets in the way of / keeps the person from" the
 *    value and ends at causing its opposite, rather than "removes" or "harms".
 *  - "In this domain" is dropped where the rung reads as well without it.
 *  - A +1 or -1 rung must be something a scorer cannot read into any promise:
 *    "a first step" fired on the sign-in promises, and "harder to reach" missed
 *    the consent wall that "a barrier" finds (Jev runs, 2026-11-15).
 * Plain sentences with no parentheses, because a probabilistic scorer reads them
 * as is.
 *
 * Library content: zod-free and fs-free, and frozen.
 */

import type { ValueId } from "./ids";

const LADDERS: Record<ValueId, Record<string, string>> = {
  "saves-time": {
    "-3": "Takes hours out of the person's life.",
    "-2": "Costs the person time on tasks they do regularly in this domain.",
    "-1": "Costs the person a little time on one task inside the product.",
    "1": "Saves a little time on one task inside the product.",
    "2": "Saves time on tasks the person does regularly in this domain.",
    "3": "Gives the person back hours of their life.",
  },
  simplifies: {
    "-3": "Makes a part of the person's life confusing or hard to manage.",
    "-2": "Makes a whole task in this domain clearly more complicated.",
    "-1": "Adds a step or a choice inside the product.",
    "1": "Removes a step or a choice inside the product.",
    "2": "Makes a whole task in this domain clearly simpler.",
    "3": "Makes a complicated part of the person's life simple.",
  },
  "makes-money": {
    "-3": "Costs the person a meaningful part of their income.",
    "-2": "Cuts a regular way the person earns in this domain.",
    "-1": "Makes earning slightly harder or costs the person a little income.",
    "1": "Helps the person earn a little, or makes earning slightly easier.",
    "2": "Gives the person a regular way to earn in this domain.",
    "3": "Provides a meaningful part of the person's income.",
  },
  "reduces-risk": {
    "-3": "Exposes the person to a major loss in their life.",
    "-2": "Exposes the person to a serious loss or error in this domain.",
    "-1": "Exposes the person to a small mistake or loss inside the product.",
    "1": "Guards against a small mistake or loss inside the product.",
    "2": "Protects against a serious loss or error in this domain.",
    "3": "Protects against a major loss in the person's life.",
  },
  organizes: {
    "-3": "Brings disorder to a large part of the person's life.",
    "-2": "Makes things in this domain hard to keep in order or to find.",
    "-1": "Leaves a few things in disorder inside the product.",
    "1": "Keeps a few things in order inside the product.",
    "2": "Keeps everything in this domain in order and easy to find.",
    "3": "Brings order to a large part of the person's life.",
  },
  integrates: {
    "-3": "Pulls separate parts of the person's life further apart.",
    "-2": "Splits apart the several tools the person uses in this domain.",
    "-1": "Cuts the product off from one other tool the person uses.",
    "1": "Connects the product to one other tool the person uses.",
    "2": "Ties together the several tools the person uses in this domain.",
    "3": "Makes separate parts of the person's life work together as one.",
  },
  connects: {
    "-3": "Separates the person from the people who matter most in their life.",
    "-2": "Makes it harder to build or keep relationships in this domain.",
    "-1": "Gets in the way of reaching someone through the product.",
    "1": "Lets the person reach someone through the product.",
    "2": "Helps the person build and keep relationships in this domain.",
    "3": "Brings the person together with the people who matter most in their life.",
  },
  "reduces-effort": {
    "-3": "Puts a heavy burden of work on the person's life.",
    "-2": "Makes a whole task clearly more demanding.",
    "-1": "Adds a little effort to one task inside the product.",
    "1": "Saves a little effort on one task inside the product.",
    "2": "Makes a whole task clearly less demanding.",
    "3": "Lifts a heavy burden of work off the person's life.",
  },
  "avoids-hassles": {
    "-3": "Brings a whole kind of annoyance into the person's life.",
    "-2": "Adds an annoyance that keeps coming back in this domain.",
    "-1": "Adds a small annoyance inside the product.",
    "1": "Avoids a small annoyance inside the product.",
    "2": "Avoids an annoyance that keeps coming back in this domain.",
    "3": "Takes a whole kind of annoyance out of the person's life.",
  },
  "reduces-cost": {
    "-3": "Costs the person a significant amount of money over their life.",
    "-2": "Costs the person money regularly in this domain.",
    "-1": "Costs the person a little money on one purchase.",
    "1": "Saves the person a little money on one purchase.",
    "2": "Saves the person money regularly in this domain.",
    "3": "Saves the person a significant amount of money over their life.",
  },
  quality: {
    "-3": "Craft so poor the person would call it the worst they have used.",
    "-2": "The product feels unreliable and poorly made throughout.",
    "-1": "Something inside the product feels unreliable or half-made.",
    "1": "Something inside the product feels robust.",
    "2": "The product feels dependable and well crafted throughout.",
    "3": "Craft so good the person would call it the best they have used.",
  },
  variety: {
    "-3": "Locks the person into a narrow range of choices in their life.",
    "-2": "Limits the person to a narrow range of choices.",
    "-1": "Does not offer enough options inside the product.",
    "1": "Offers the person a few options inside the product.",
    "2": "Offers the person a wide choice.",
    "3": "Offers the person a breadth of choice they can shape to their own life.",
  },
  "sensory-appeal": {
    "-3": "A sensory experience the person avoids.",
    "-2": "The product looks, sounds or feels bad and the person dislikes using it.",
    "-1": "A look, a sound or a feel the person would point to as unpleasant.",
    "1": "A look, a sound or a feel the person would point to as pleasant.",
    "2": "The product looks, sounds or feels good and the person enjoys using it.",
    "3": "A sensory experience the person seeks out for its own sake.",
  },
  informs: {
    "-3": "Misleads the person deeply about the service area or domain.",
    "-2": "Confuses the person about the service area or domain.",
    "-1": "Hides from the person something about the service that they want to know.",
    "1": "Informs the person about the service.",
    "2": "Informs the person about the service area or domain.",
    "3": "Informs the person deeply and efficiently about the service area or domain.",
  },
  "reduces-anxiety": {
    "-3": "Leaves the person anxious about something important in their life.",
    "-2": "Stirs up a worry the person has in this domain.",
    "-1": "Adds a small worry inside the product.",
    "1": "Removes a small worry inside the product.",
    "2": "Calms a worry the person has in this domain.",
    "3": "Brings the person lasting peace of mind about something important.",
  },
  "rewards-me": {
    "-3": "Does not give rewards the person values as much as the product itself.",
    "-2": "Does not give the perks the person regularly expects.",
    "-1": "Does not give a small perk where the person would expect one.",
    "1": "Gives the person a small perk for engaging.",
    "2": "Gives the person regular perks they value.",
    "3": "Gives the person rewards they value as much as the product itself.",
  },
  nostalgia: {
    "-3": "Ruins a cherished memory for good.",
    "-2": "Clearly tarnishes a good memory of the past.",
    "-1": "Dulls a pleasant memory of the past.",
    "1": "Faintly recalls a pleasant memory of the past.",
    "2": "Clearly brings back a good memory of the past.",
    "3": "Brings back a cherished past in a vivid and deeply felt way.",
  },
  "design-aesthetics": {
    "-3": "Ugliness the person would be embarrassed to show to others.",
    "-2": "A design the person finds ugly.",
    "-1": "A displeasing design detail.",
    "1": "A pleasing design detail.",
    "2": "A design the person finds beautiful.",
    "3": "Beauty the person would show to others and that shapes how they feel about it.",
  },
  "badge-value": {
    "-3": "Signals something the person does not want the people who matter to them to see.",
    "-2": "Clearly signals a low identity or status in a community.",
    "-1": "Gives a mild negative signal about the person to others.",
    "1": "Gives a mild signal about the person to others.",
    "2": "Clearly signals the person's identity or status in a community.",
    "3": "Signals who the person is to the people who matter to them.",
  },
  wellness: {
    "-3": "Lastingly harms the person's physical or mental well-being.",
    "-2": "Noticeably worsens how the person feels over time.",
    "-1": "Slightly worsens how the person feels, in the moment.",
    "1": "Slightly improves how the person feels, in the moment.",
    "2": "Noticeably improves how the person feels over time.",
    "3": "Lastingly improves the person's physical or mental well-being.",
  },
  "therapeutic-value": {
    "-3": "Causes the person lasting emotional hurt.",
    "-2": "Makes a difficult feeling harder for the person to work through.",
    "-1": "Gets in the way of a moment of emotional relief.",
    "1": "Gives a small moment of emotional relief.",
    "2": "Helps the person work through a difficult feeling.",
    "3": "Supports real healing of something that hurts the person.",
  },
  "fun-entertainment": {
    "-3": "So joyless that the person avoids it and warns others.",
    "-2": "Boring or tedious to use.",
    "-1": "A dull moment.",
    "1": "A light moment of enjoyment.",
    "2": "Genuinely enjoyable to use.",
    "3": "Delight the person would seek out and tell others about.",
  },
  attractiveness: {
    "-3": "Leaves the person feeling unattractive in their everyday life.",
    "-2": "Clearly makes the person feel less attractive.",
    "-1": "Makes the person feel slightly worse about how they look.",
    "1": "Makes the person feel slightly better about how they look.",
    "2": "Clearly makes the person feel more attractive.",
    "3": "Leaves the person feeling attractive in their everyday life.",
  },
  "provides-access": {
    "-3": "Makes something that matters in the person's life much harder to reach.",
    "-2": "Makes services, people, knowledge or capabilities harder to reach.",
    "-1": "Puts a barrier in front of a feature inside the product.",
    "1": "Lowers a barrier to a feature inside the product.",
    "2": "Makes services, people, knowledge or capabilities easier to reach.",
    "3": "Makes something that matters in the person's life much easier to reach.",
  },
  "provides-hope": {
    "-3": "Leaves the person believing their life cannot get better.",
    "-2": "Gives the person a reason to doubt that things can improve.",
    "-1": "Gets in the way of the person's hope.",
    "1": "Gives the person a glimmer of hope.",
    "2": "Gives a real reason to believe that things can improve.",
    "3": "Gives a lasting belief that the person's life can get better.",
  },
  "self-actualization": {
    "-3": "A drift away from who the person wants to be.",
    "-2": "A step away from who the person wants to be.",
    "-1": "Keeps the person from becoming who they want to be.",
    "1": "A small step toward who the person wants to be.",
    "2": "Clear progress toward who the person wants to be.",
    "3": "Helps the person become who they want to be.",
  },
  motivation: {
    "-3": "Drains the person's energy toward goals that matter in their life.",
    "-2": "A drag on the person's drive.",
    "-1": "Discourages the person from starting.",
    "1": "Gives the person a spark of motivation.",
    "2": "Keeps the person energized toward a goal.",
    "3": "Sustains the person's drive toward goals that matter in their life.",
  },
  heirloom: {
    "-3": "Prevents something meaningful from being passed on to others.",
    "-2": "Prevents something meaningful from being preserved for years.",
    "-1": "Gets in the way of keeping something worth keeping.",
    "1": "Keeps something worth keeping for a while.",
    "2": "Preserves something meaningful for years.",
    "3": "Holds something meaningful enough to be passed on to others across time.",
  },
  "affiliation-belonging": {
    "-3": "Cuts the person off from a group that matters deeply to who they are.",
    "-2": "Keeps the person from becoming part of a group or community.",
    "-1": "Gets in the way of feeling part of something meaningful.",
    "1": "A feeling of being part of something meaningful.",
    "2": "Makes the person part of a group or community.",
    "3": "Makes the person part of a group that matters deeply to who they are.",
  },
  "self-transcendence": {
    "-3": "Keeps the person from contributing to major or meaningful causes.",
    "-2": "Keeps the person from making a lasting difference for other people or causes.",
    "-1": "Keeps the person from giving something real to others.",
    "1": "Lets the person give something real to others at a human scale.",
    "2": "Lets the person make a lasting difference for other people or causes.",
    "3": "Lets the person contribute to major or meaningful causes.",
  },
};

/** Frozen, entry by entry: built-in content is shared by every reader in the process. */
export const VALUE_REACH_LADDERS: Readonly<Record<ValueId, Readonly<Record<string, string>>>> = Object.freeze(
  Object.fromEntries(Object.entries(LADDERS).map(([id, ladder]) => [id, Object.freeze(ladder)])) as Record<ValueId, Readonly<Record<string, string>>>,
);
