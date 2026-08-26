import {
  findDirectBlocks,
  parseSunkShipBlock,
  readDirectScalar,
  type LocatedBlock,
} from './global-history.parser';
import type {
  NavalLossParentContext,
  ParsedNavalLoss,
  SaveScopedId,
} from './naval-loss.types';

export interface ShipHistoryParseResult {
  records: ParsedNavalLoss[];
  parentContexts: NavalLossParentContext[];
}

export interface ShipHistoryCountryBlock {
  countryTag: string;
  countryBlock: LocatedBlock;
  fleetBlocks?: readonly LocatedBlock[];
  unitsBlocks?: readonly LocatedBlock[];
}

interface RecordCandidate {
  block: LocatedBlock;
  parentContextId: string;
  provenanceWarnings: string[];
  sourcePath: string;
}

interface FleetCandidate {
  block: LocatedBlock;
  sourcePath: string;
}

interface ParsedParentId {
  value: SaveScopedId | null;
  warnings: string[];
}

function parseDirectId(
  saveText: string,
  parent: LocatedBlock,
  label: string,
): ParsedParentId {
  const idBlock = findDirectBlocks(
    saveText,
    parent.bodyStart,
    parent.bodyEnd,
    'id',
  )[0];
  if (!idBlock) {
    return { value: null, warnings: [`missing parent ${label} id`] };
  }

  const idRaw = readDirectScalar(
    saveText,
    idBlock.bodyStart,
    idBlock.bodyEnd,
    'id',
  );
  const typeRaw = readDirectScalar(
    saveText,
    idBlock.bodyStart,
    idBlock.bodyEnd,
    'type',
  );
  const idNumber = idRaw === null || idRaw.trim() === '' ? null : Number(idRaw);
  const typeNumber =
    typeRaw === null || typeRaw.trim() === '' ? null : Number(typeRaw);
  const id = idNumber !== null && Number.isFinite(idNumber) ? idNumber : null;
  const type =
    typeNumber !== null && Number.isFinite(typeNumber) ? typeNumber : null;

  if (id === null || type === null) {
    return {
      value: { id, type, status: 'incomplete' },
      warnings: [`incomplete parent ${label} id`],
    };
  }
  if (id === 0 && type === 0) {
    return {
      value: { id: 0, type: 0, status: 'zero_sentinel' },
      warnings: [],
    };
  }
  return { value: { id, type, status: 'valid' }, warnings: [] };
}

function readParentShipName(
  saveText: string,
  ship: LocatedBlock,
): string | null {
  const directName = readDirectScalar(
    saveText,
    ship.bodyStart,
    ship.bodyEnd,
    'name',
  );
  if (directName !== null) return directName;

  const shipName = findDirectBlocks(
    saveText,
    ship.bodyStart,
    ship.bodyEnd,
    'ship_name',
  )[0];
  if (!shipName) return null;
  return (
    readDirectScalar(
      saveText,
      shipName.bodyStart,
      shipName.bodyEnd,
      'override',
    ) ??
    readDirectScalar(saveText, shipName.bodyStart, shipName.bodyEnd, 'name')
  );
}

function collectShipHistoryCandidates(
  saveText: string,
  countryTag: string,
  fleetId: ParsedParentId,
  taskForceId: ParsedParentId,
  ship: LocatedBlock,
  sourcePath: string,
): {
  context: NavalLossParentContext;
  candidates: RecordCandidate[];
} | null {
  const shipId = parseDirectId(saveText, ship, 'ship');
  const shipDefinition = readDirectScalar(
    saveText,
    ship.bodyStart,
    ship.bodyEnd,
    'definition',
  );
  const provenanceWarnings = [
    ...fleetId.warnings,
    ...taskForceId.warnings,
    ...shipId.warnings,
  ];
  if (shipDefinition === null) {
    provenanceWarnings.push('missing parent ship definition');
  }

  const contextId = `ship_history_context:${ship.keyOffset}`;
  const candidates: RecordCandidate[] = [];
  for (const history of findDirectBlocks(
    saveText,
    ship.bodyStart,
    ship.bodyEnd,
    'history',
  )) {
    for (const armyHistory of findDirectBlocks(
      saveText,
      history.bodyStart,
      history.bodyEnd,
      'army_history',
    )) {
      for (const queue of findDirectBlocks(
        saveText,
        armyHistory.bodyStart,
        armyHistory.bodyEnd,
        'history_queue',
      )) {
        for (const sunkShip of findDirectBlocks(
          saveText,
          queue.bodyStart,
          queue.bodyEnd,
          'sunk_ship',
        )) {
          candidates.push({
            block: sunkShip,
            parentContextId: contextId,
            provenanceWarnings,
            sourcePath,
          });
        }
      }
    }
  }
  if (candidates.length === 0) return null;

  return {
    context: {
      contextId,
      countryTag,
      fleetId: fleetId.value,
      taskForceId: taskForceId.value,
      shipId: shipId.value,
      shipName: readParentShipName(saveText, ship),
      shipDefinition,
    },
    candidates,
  };
}

function findCountryFleets(
  saveText: string,
  country: LocatedBlock,
  precomputedFleetBlocks?: readonly LocatedBlock[],
  precomputedUnitsBlocks?: readonly LocatedBlock[],
): FleetCandidate[] {
  const direct: FleetCandidate[] = [];
  let unitsBlocks: readonly LocatedBlock[];
  if (precomputedFleetBlocks && precomputedUnitsBlocks) {
    for (const block of precomputedFleetBlocks) {
      direct.push({
        block,
        sourcePath:
          'countries.TAG.fleet.task_force.ship.history.army_history.history_queue.sunk_ship',
      });
    }
    unitsBlocks = precomputedUnitsBlocks;
  } else {
    const countryBlocks = findDirectBlocks(
      saveText,
      country.bodyStart,
      country.bodyEnd,
    );
    const discoveredUnitsBlocks: LocatedBlock[] = [];
    for (const block of countryBlocks) {
      if (block.key === 'fleet') {
        direct.push({
          block,
          sourcePath:
            'countries.TAG.fleet.task_force.ship.history.army_history.history_queue.sunk_ship',
        });
      } else if (block.key === 'units') {
        discoveredUnitsBlocks.push(block);
      }
    }
    unitsBlocks = discoveredUnitsBlocks;
  }
  const insideUnits = unitsBlocks.flatMap((units) =>
    findDirectBlocks(saveText, units.bodyStart, units.bodyEnd, 'fleet').map(
      (block) => ({
        block,
        sourcePath:
          'countries.TAG.units.fleet.task_force.ship.history.army_history.history_queue.sunk_ship',
      }),
    ),
  );
  return [...direct, ...insideUnits].sort(
    (left, right) => left.block.keyOffset - right.block.keyOffset,
  );
}

export function parseShipHistoryNavalLosses(
  saveText: string,
  precomputedCountryBlocks?: readonly ShipHistoryCountryBlock[],
): ShipHistoryParseResult {
  const contexts: NavalLossParentContext[] = [];
  const candidates: RecordCandidate[] = [];

  const countryEntries: readonly ShipHistoryCountryBlock[] =
    precomputedCountryBlocks
      ? precomputedCountryBlocks
      : findDirectBlocks(saveText, 0, saveText.length, 'countries').flatMap(
          (countries) =>
            findDirectBlocks(saveText, countries.bodyStart, countries.bodyEnd)
              .filter((block) => /^[A-Z][A-Z0-9]{2}$/.test(block.key))
              .map((countryBlock) => ({
                countryTag: countryBlock.key,
                countryBlock,
              })),
        );

  for (const {
    countryTag,
    countryBlock,
    fleetBlocks,
    unitsBlocks,
  } of countryEntries) {
    const fleetCandidates = findCountryFleets(
      saveText,
      countryBlock,
      fleetBlocks,
      unitsBlocks,
    );
    for (const fleetCandidate of fleetCandidates) {
      const fleet = fleetCandidate.block;
      const fleetId = parseDirectId(saveText, fleet, 'fleet');
      const taskForces = findDirectBlocks(
        saveText,
        fleet.bodyStart,
        fleet.bodyEnd,
        'task_force',
      );
      for (const taskForce of taskForces) {
        const taskForceId = parseDirectId(saveText, taskForce, 'task-force');
        const ships = findDirectBlocks(
          saveText,
          taskForce.bodyStart,
          taskForce.bodyEnd,
          'ship',
        );
        for (const ship of ships) {
          const collected = collectShipHistoryCandidates(
            saveText,
            countryTag,
            fleetId,
            taskForceId,
            ship,
            fleetCandidate.sourcePath,
          );
          if (collected) {
            contexts.push(collected.context);
            candidates.push(...collected.candidates);
          }
        }
      }
    }
  }

  candidates.sort(
    (left, right) => left.block.keyOffset - right.block.keyOffset,
  );
  const records = candidates.map((candidate, ordinal) =>
    parseSunkShipBlock(
      saveText,
      candidate.block,
      ordinal,
      'ship_history',
      candidate.sourcePath,
      candidate.parentContextId,
      candidate.provenanceWarnings,
    ),
  );

  contexts.sort((left, right) => {
    const leftOffset = Number(left.contextId.split(':')[1]);
    const rightOffset = Number(right.contextId.split(':')[1]);
    return leftOffset - rightOffset;
  });
  return { records, parentContexts: contexts };
}
