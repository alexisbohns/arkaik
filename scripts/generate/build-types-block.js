const { extractDeclarations } = require("./extract-types");

function enumTypeAlias(name, ids) {
  return `type ${name} = ${ids.map((v) => JSON.stringify(v)).join(" | ")};`;
}

/**
 * Builds the body (no fences) of the canonical TypeScript type listing for a
 * ProjectBundle: enum type aliases (derived from the ID arrays) followed by
 * the playlist and bundle interfaces (extracted verbatim from their zod
 * source files, since those are already hand-authored as plain TS types).
 */
function buildTypesBlock(schemaPackage) {
  const { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS } = schemaPackage;

  const enumAliases = [
    enumTypeAlias("SpeciesId", SPECIES_IDS),
    enumTypeAlias("StatusId", STATUS_IDS),
    enumTypeAlias("PlatformId", PLATFORM_IDS),
    enumTypeAlias("EdgeTypeId", EDGE_TYPE_IDS),
  ];

  const [playlistEntry, junctionCase, flowPlaylist] = extractDeclarations("playlist.ts", [
    "PlaylistEntry",
    "JunctionCase",
    "FlowPlaylist",
  ]);

  const [
    refType,
    ref,
    nodeMetadata,
    platformNotesMap,
    platformStatusMap,
    platformScreenshotsMap,
    node,
    edge,
    project,
    projectMetadata,
    projectBundle,
  ] = extractDeclarations("bundle.ts", [
    "RefType",
    "Ref",
    "NodeMetadata",
    "PlatformNotesMap",
    "PlatformStatusMap",
    "PlatformScreenshotsMap",
    "Node",
    "Edge",
    "Project",
    "ProjectMetadata",
    "ProjectBundle",
  ]);

  // ProjectMetadata references these by name; without them the listing an
  // agent authors maps from would point at types it cannot see (maps.md
  // § MapDefinition, § Display Options).
  const mapDecls = extractDeclarations("maps.ts", [
    "MapKind",
    "MapLayoutHints",
    "MapFlowPlatformsMode",
    "MapViewPlatformsMode",
    "MapDisplayOptions",
    "MapDefinition",
  ]);

  const journalDecls = extractDeclarations("journal.ts", [
    "JournalEvent",
    "NodeCreatedEvent",
    "NodeUpdatedEvent",
    "NodeStatusChangedEvent",
    "NodeDeletedEvent",
    "EdgeAddedEvent",
    "EdgeRemovedEvent",
    "ReleaseTaggedEvent",
    "IdeaProposedEvent",
    "RequestFiledEvent",
    "RefAddedEvent",
    "RefRemovedEvent",
    "RefStatusChangedEvent",
    "KnownJournalEvent",
  ]);

  return [
    ...enumAliases,
    "",
    playlistEntry,
    "",
    junctionCase,
    "",
    flowPlaylist,
    "",
    platformNotesMap,
    platformStatusMap,
    platformScreenshotsMap,
    "",
    refType,
    "",
    ref,
    "",
    nodeMetadata,
    "",
    node,
    "",
    edge,
    "",
    ...mapDecls.flatMap((decl) => [decl, ""]),
    projectMetadata,
    "",
    project,
    "",
    ...journalDecls.flatMap((decl) => [decl, ""]),
    projectBundle,
  ].join("\n");
}

module.exports = { buildTypesBlock };
