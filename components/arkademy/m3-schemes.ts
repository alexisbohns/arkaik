/**
 * The preview schemes of the cover's Material 3 Expressive reading: one seed
 * (an Arkaik stone's tone) through one M3 scheme variant each. Generated once
 * in a scratch script (an HCT solver, no dependency) and hard-coded: the roles
 * themselves live in m3-expressive.css, scoped by `[data-scheme]`. The first
 * is the default, with no attribute. `swatch` is the light scheme's primary,
 * secondary container and tertiary, for the picker.
 */
export const M3_SCHEMES = [
  {
    "id": "ember-vibrant",
    "label": "Ember · Vibrant",
    "seed": "#E5552F",
    "swatch": [
      "#B32A00",
      "#FFDBC7",
      "#805520"
    ]
  },
  {
    "id": "ember-expressive",
    "label": "Ember · Expressive",
    "seed": "#E5552F",
    "swatch": [
      "#485B99",
      "#D9E9B7",
      "#3A6844"
    ]
  },
  {
    "id": "ember-tonal-spot",
    "label": "Ember · Tonal spot",
    "seed": "#E5552F",
    "swatch": [
      "#8F4B39",
      "#FFDAD1",
      "#6C5D2E"
    ]
  },
  {
    "id": "basalt-neutral",
    "label": "Basalt · Neutral",
    "seed": "#A3A3AB",
    "swatch": [
      "#5B5E6C",
      "#E2E2EC",
      "#585E72"
    ]
  }
] as const;

export type M3SchemeId = (typeof M3_SCHEMES)[number]["id"];

export const M3_DEFAULT_SCHEME: M3SchemeId = "ember-vibrant";

export function isM3Scheme(value: unknown): value is M3SchemeId {
  return M3_SCHEMES.some((scheme) => scheme.id === value);
}

/**
 * Whether a page shows the preview picker (SchemePicker): only for a review
 * link — one that carries `?preview`, or already names a scheme or a face.
 * Visitors get the default scheme and face, and no picker.
 */
export function showsM3Preview(params: Record<string, string | string[] | undefined>): boolean {
  return params.preview !== undefined || params.scheme !== undefined || params.font !== undefined;
}
