"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  STAKE_LIFECYCLE_STATUSES,
  VALUE_IDS,
  canBeAnticipated,
  catalogSourceForStakeSpecies,
  stakeCatalogOf,
  stakeMetadataWith,
  stakeProvenanceOf,
  stakeSpeciesFor,
  stakeSpeciesOf,
  type StakeFieldChange,
  type StakeProvenanceId,
  type StakeSpeciesId,
} from "@arkaik/schema";

import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { PanelSection } from "@/components/panels/PanelSection";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { STAKE_SPECIES, STAKE_SPECIES_LABELS } from "@/lib/config/stake-species";
import { VALUES } from "@/lib/config/values";
import type { Node, NodeMetadata } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";

const AUTOSAVE_DELAY_MS = 350;
const NO_VALUE = "__none";

type OnUpdate = (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;

interface StakeEditorProps {
  node: Node;
  /** Absent on a read-only surface (the Changelog): the editor then shows facts and offers nothing. */
  onUpdate?: OnUpdate;
  /** The panel's shared latest-metadata write base — see `NodeDetailPanel`, which owns it. */
  metadataRef: React.MutableRefObject<NodeMetadata | undefined>;
}

const PROVENANCE_OPTIONS = [
  { id: "observed", label: "Observed", title: "Seen in the world: a signal, a ticket, a test" },
  { id: "anticipated", label: "Anticipated", title: "Reasoned about ahead of the world: nothing exists yet to have a bug or a friction" },
] as const satisfies readonly { id: StakeProvenanceId; label: string; title: string }[];

/**
 * A stake's own facts: what kind it is (bug, friction, need, requirement, risk
 * or defect), whether it was observed or anticipated, the catalog entry it
 * points at, and where it stands in its stored lifecycle (idea, discovery,
 * archived; every other state is derived, never typed in).
 *
 * Every write is one metadata patch built by `stakeMetadataWith` over the
 * panel's shared write base, so the rules the validator warns about (a
 * catalog link that does not fit the kind, an anticipated bug) are applied at
 * the keyboard rather than discovered later. The anchor is not here: it is the
 * `concerns` line of the Relations group.
 */
export function StakeEditor({ node, onUpdate, metadataRef }: StakeEditorProps) {
  const fieldId = useId();
  const species = stakeSpeciesOf(node);
  const provenance = stakeProvenanceOf(node);
  const catalog = stakeCatalogOf(node);
  const readOnly = !onUpdate;

  function write(change: StakeFieldChange) {
    if (!onUpdate) return;
    const next = stakeMetadataWith(metadataRef.current, change);
    metadataRef.current = next;
    void onUpdate(node.id, { metadata: next });
  }

  const speciesOptions = stakeSpeciesFor(provenance);
  const catalogSource = species === undefined ? undefined : catalogSourceForStakeSpecies(species);
  const lifecycle = STAKE_LIFECYCLE_STATUSES as readonly StatusId[];
  // A hand-edited status outside the stored lifecycle stays visible so the
  // select can show it; the validator is what says it is wrong.
  const statusOptions = lifecycle.includes(node.status) ? lifecycle : [...lifecycle, node.status];

  return (
    <PanelGroup title="Stake" meta={species ? <span>{STAKE_SPECIES_LABELS[species]}</span> : undefined}>
      <PanelSection title="Kind">
        {readOnly ? (
          <p className="text-sm" data-stake-kind="">
            {species ? STAKE_SPECIES_LABELS[species] : "Not set"}
          </p>
        ) : (
          <Select
            value={species ?? ""}
            onValueChange={(value) => write({ stake_species: value as StakeSpeciesId })}
          >
            <SelectTrigger id={`${fieldId}-kind`} aria-label="Stake kind" data-stake-kind="">
              <SelectValue placeholder="Choose a kind" />
            </SelectTrigger>
            <SelectContent>
              {STAKE_SPECIES.filter((entry) => speciesOptions.includes(entry.id)).map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {species && <p className="text-xs text-muted-foreground">{STAKE_SPECIES.find((entry) => entry.id === species)?.hint}</p>}
        {!species && !readOnly && (
          <p className="text-xs text-muted-foreground">A stake without a kind cannot be weighed or routed to a reference.</p>
        )}
      </PanelSection>

      <PanelSection title="Provenance">
        {readOnly ? (
          <p className="text-sm">{provenance === "anticipated" ? "Anticipated" : "Observed"}</p>
        ) : (
          <SegmentedControl
            ariaLabel="Stake provenance"
            options={PROVENANCE_OPTIONS}
            value={provenance}
            onChange={(next) => {
              // A bug or a friction cannot be anticipated; the way out is to
              // reroute it as a need first, which is a person's call.
              if (next === "anticipated" && !canBeAnticipated(species)) return;
              write({ provenance: next });
            }}
          />
        )}
        {!readOnly && !canBeAnticipated(species) && (
          <p className="text-xs text-muted-foreground">
            Nothing exists yet to have a {species}: reroute it as a need to anticipate it.
          </p>
        )}
      </PanelSection>

      {catalogSource && (
        <PanelSection title={catalogSource === "kritik" ? "Kritik criterion" : "Value"}>
          {catalogSource === "kritik" ? (
            <CatalogCriterionField
              key={node.id}
              id={`${fieldId}-catalog`}
              stored={catalog?.source === "kritik" ? catalog.id : ""}
              readOnly={readOnly}
              onCommit={(id) => write({ catalog: id === "" ? undefined : { source: "kritik", id } })}
            />
          ) : readOnly ? (
            <p className="text-sm">
              {catalog?.source === "values" ? (VALUES.find((entry) => entry.id === catalog.id)?.label ?? catalog.id) : "None"}
            </p>
          ) : (
            <Select
              value={catalog?.source === "values" ? catalog.id : NO_VALUE}
              onValueChange={(value) =>
                write({ catalog: value === NO_VALUE ? undefined : { source: "values", id: value } })
              }
            >
              <SelectTrigger id={`${fieldId}-catalog`} aria-label="Value of the pyramid">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>
                  <span className="text-muted-foreground">No value</span>
                </SelectItem>
                {VALUES.filter((entry) => (VALUE_IDS as readonly string[]).includes(entry.id)).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
                {catalog?.source === "values" && !VALUES.some((entry) => entry.id === catalog.id) && (
                  <SelectItem value={catalog.id}>{catalog.id}</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
        </PanelSection>
      )}

      <PanelSection title="Lifecycle">
        {readOnly ? (
          <p className="text-sm">{node.status}</p>
        ) : (
          <Select value={node.status} onValueChange={(value) => void onUpdate?.(node.id, { status: value as StatusId })}>
            <SelectTrigger id={`${fieldId}-status`} aria-label="Stake lifecycle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <StatusSelectItems only={statusOptions} />
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          Stored: idea, discovery or archived. Raised, considered, promised and addressed are read off the graph, never typed in.
        </p>
      </PanelSection>
    </PanelGroup>
  );
}

/** A Kritik criterion id (SAF-01) typed in, saved after a pause like the panel's other text fields. */
function CatalogCriterionField({
  id,
  stored,
  readOnly,
  onCommit,
}: {
  id: string;
  stored: string;
  readOnly: boolean;
  onCommit: (id: string) => void;
}) {
  const [value, setValue] = useState(stored);
  const lastSaved = useRef(stored);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === lastSaved.current) return;
    const timeout = setTimeout(() => {
      lastSaved.current = trimmed;
      commit.current(trimmed);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [value]);

  if (readOnly) return <p className="text-sm">{stored || "None"}</p>;
  return (
    <Input
      id={id}
      aria-label="Kritik criterion id"
      value={value}
      placeholder="SAF-01"
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
