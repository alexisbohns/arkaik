import { PARTS, SECTIONS } from "@/components/landing/content";
import { LandingPart } from "@/components/landing/LandingPart";
import { LandingSection } from "@/components/landing/LandingSection";
import { PREVIEW_META } from "@/components/landing/previews/ids";
import { PREVIEW_REGISTRY } from "@/components/landing/previews/registry";
import { loadLandingSeeds } from "@/lib/landing/seeds";

/**
 * Everything below the hero. A loop over `PARTS` → `SECTIONS`: this component
 * holds no copy and no data logic. Seeds load once here and reach each preview
 * as the one bundle its catalogue entry names.
 */
export function LandingPage() {
  const seeds = loadLandingSeeds();
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6">
      {PARTS.map((part, index) => {
        const sections = SECTIONS.filter((section) => section.part === part.id);
        return (
          <LandingPart key={part.id} part={part} number={index + 1} total={PARTS.length} sections={sections}>
            {sections.map((section) => {
              if (section.preview === "none") {
                return <LandingSection key={section.id} section={section} preview={null} />;
              }
              const Preview = PREVIEW_REGISTRY[section.preview];
              const meta = PREVIEW_META[section.preview];
              const seed = seeds[meta.source];
              // A client preview that never reads the journal must not carry it
              // across the RSC boundary; the catalogue says which ones do.
              const bundle = meta.journal ? seed : { ...seed, journal: [] };
              return <LandingSection key={section.id} section={section} preview={<Preview bundle={bundle} />} />;
            })}
          </LandingPart>
        );
      })}
    </div>
  );
}
