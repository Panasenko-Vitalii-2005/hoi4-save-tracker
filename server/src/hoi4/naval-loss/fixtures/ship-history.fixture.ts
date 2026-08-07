import { COMPLETE_SUNK_SHIP } from './global-history.fixture';

export interface FixtureShipOptions {
  id?: string | null;
  definition?: string | null;
  name?: string | null;
  entries?: string[];
}

export interface ShipHistoryFixtureOptions {
  countryTag?: string;
  fleetId?: string | null;
  taskForceId?: string | null;
  ships?: FixtureShipOptions[];
  unitsWrapper?: boolean;
}

export function historyQueue(
  sunkShip = COMPLETE_SUNK_SHIP,
  wrapperDate = '1.1.1.1',
): string {
  return `history_queue={
    date="${wrapperDate}"
    unique=17
    sunk_ship=${sunkShip.slice(sunkShip.indexOf('{'))}
  }`;
}

export function assistedSunkShip(sunkShip = COMPLETE_SUNK_SHIP): string {
  return sunkShip.replace('  convoy=no', '  assist=yes\n  convoy=no');
}

export function shipHistoryFixture({
  countryTag = 'ENG',
  fleetId = '{ id=11 type=61 }',
  taskForceId = '{ id=22 type=61 }',
  ships = [
    {
      id: '{ id=33 type=51 }',
      definition: 'destroyer',
      name: 'HMS Napier',
      entries: [historyQueue()],
    },
  ],
  unitsWrapper = false,
}: ShipHistoryFixtureOptions = {}): string {
  const shipBlocks = ships
    .map(
      ({
        id = '{ id=33 type=51 }',
        definition = 'destroyer',
        name = 'HMS Napier',
        entries = [historyQueue()],
      }) => `ship={
        ${id === null ? '' : `id=${id}`}
        ${definition === null ? '' : `definition=${definition}`}
        ${name === null ? '' : `name="${name}"`}
        history={
          army_history={
            ${entries.join('\n')}
          }
        }
      }`,
    )
    .join('\n');

  const fleetBlock = `fleet={
        ${fleetId === null ? '' : `id=${fleetId}`}
        task_force={
          ${taskForceId === null ? '' : `id=${taskForceId}`}
          ${shipBlocks}
        }
      }`;

  return `countries={
    ${countryTag}={
      ${unitsWrapper ? `units={ ${fleetBlock} }` : fleetBlock}
    }
  }`;
}
