/**
 * Compact derived fixtures from the 1.19.2.0.3eb1 (85f4) research controls:
 * A autosave_100_reload_1192_control_temp.hoi4
 * B post_load_1h_no_trade_control_temp.hoi4
 * C subject_trade_control_temp.hoi4
 * National maps / trade / rights fields retain their serialized values.
 * Production rows compact the validated per-consumer totals, not runtime supply.
 */
export const RIGHTS_ORIGIN = `extra_resource_origin={
  giver="SWE"
  origin={
    id={ id=76538 type=4713 } country="GER" state=918 destination=64
    efficiency=1 efficiency_due_to_lost_convoys=1 request=0
    resources={ tungsten=39.2 steel=43.68 chromium=16.8 }
    resources_unclapmed={ tungsten=39.2 steel=43.68 chromium=16.8 }
    given_resource_rights={
      { aluminium "GER" } { chromium "GER" } { coal "GER" }
      { oil "GER" } { rubber "GER" } { steel "GER" } { tungsten "GER" }
    }
    delivery_route={
      type=1 from_state=918 to_state=64 sender="SWE" receiver="GER"
      convoys_owner="GER" land_path={ 918 38 141 140 138 37 911 912 909 58 61 64 }
      dirty=no
    }
  }
}`;

const PRODUCTION = `production={
  military_lines={
    id={ id=1738 type=56 } equipment_variant_index={ id=6847 type=70 }
    active_factories=11 requested_factories=11 priority=8
    speed=84.64039 cost=5.82 produced=4.58278
    resources={
      { resource=tungsten amount=22 need=0 }
      { resource=steel amount=33 need=0 }
      { resource=chromium amount=11 need=0 }
    }
  }
  military_lines={
    resources={
      { resource=aluminium amount=187 need=0 }
      { resource=rubber amount=105 need=0 }
      { resource=tungsten amount=115 need=0 }
      { resource=steel amount=673 need=0 }
      { resource=chromium amount=78 need=0 }
    }
  }
  naval_lines={ resources={ { resource=steel amount=67 need=0 } { resource=chromium amount=1 need=0 } {} } }
  ship_refit_lines={ resources={ { resource=steel amount=0 need=0 } { resource=chromium amount=0 need=0 } {} } }
  energy_production_cost={ resource=coal amount=467 need=0 }
}`;

const PROJECTS = `program_status={ project_pool={ resources={ tungsten=10 steel=28 chromium=10 } } }`;

const POR = `POR={ resources={
  delivery_routes={ GER={
    type=1 from_state=112 to_state=64 sender="POR" receiver="GER"
    convoys_owner="GER" land_path={ 112 180 174 790 792 806 31 22 20 17 28 42 55 60 64 }
  } }
  export={
    id={ id=136587 type=4713 } country="GER" receiver="GER" resource="tungsten"
    delivered=48 efficiency=1 efficiency_due_to_lost_convoys=1 request=0
    required_cic=6 lended_cic=6
  }
} }`;

function ins(state: 'A' | 'B' | 'C'): string {
  return `INS={ resources={
    delivery_routes={ GER={
      type=2 from_state=1058 to_state=64 sender="INS" receiver="GER"
      convoys_owner="GER" naval_path={ 72 71 60 104 100 69 29 68 47 42 18 }
    } }
    export={
      id={ id=144352 type=4713 } country="GER" receiver="GER" resource="rubber"
      delivered=${state === 'A' ? '5.57792' : '4.46688'} efficiency=1
      efficiency_due_to_lost_convoys=${state === 'A' ? '0.69724' : '0.55836'} request=9
      required_cic=1 lended_cic=1 convoys_subscriber={ convoys=9 total=9 }
    }
  } }`;
}

const RKB = `RKB={ resources={
  delivery_routes={ GER={
    type=1 from_state=6 to_state=64 sender="RKB" receiver="GER"
    convoys_owner="GER" land_path={ 6 35 51 55 60 64 }
  } }
  export={
    id={ id=147945 type=4713 } country="GER" receiver="GER" resource="steel"
    delivered=32 efficiency=1 efficiency_due_to_lost_convoys=1 request=0
    required_cic=1 lended_cic=1
  }
} }`;

export function economyFixture(state: 'A' | 'B' | 'C' = 'A'): string {
  const produced =
    state === 'A'
      ? 'oil=57 aluminium=414 rubber=128 tungsten=12 steel=897 chromium=35 coal=611'
      : 'oil=67 aluminium=485 rubber=128 tungsten=118 steel=1184 chromium=84 coal=737';
  const beforeDemand =
    state === 'A'
      ? 'aluminium=352 rubber=114.57792 tungsten=52 steel=737 chromium=62 coal=515'
      : `aluminium=412 rubber=114.57792 tungsten=148 steel=${state === 'C' ? 1030 : 1006} chromium=103 coal=626`;
  return `HOI4txt
date="1944.5.1.${state === 'A' ? 2 : 3}"
countries={
  GER={
    resources={
      produced={ ${produced} }
      imported={ oil=45.71428 rubber=5.57792 tungsten=48 chromium=32 ${state === 'C' ? 'steel=24' : ''} }
      base_export={ ${state === 'A' ? 'aluminium=62.1 rubber=19.2 tungsten=1.8 steel=134.55 chromium=5.25 coal=91.65' : 'aluminium=73 rubber=19 tungsten=18 steel=178 chromium=13 coal=111'} }
      to_export={ ${state === 'A' ? 'aluminium=62.1 rubber=19.2 tungsten=8 steel=160 chromium=5.25 coal=96' : 'aluminium=73 rubber=19 tungsten=18 steel=178 chromium=13 coal=111'} }
      exported={ aluminium=56 rubber=16 tungsten=8 steel=160 coal=96 }
      transfer_overlord_subject={}
      to_use={
        { ${beforeDemand} }
        { tungsten=-10 steel=-28 chromium=-10 }
        { aluminium=-187 rubber=-105 tungsten=-137 steel=-773 chromium=-90 coal=-467 }
      }
      ${RIGHTS_ORIGIN}
    }
    ${PRODUCTION}
    ${PROJECTS}
  }
  ${POR}
  ${ins(state)}
  ${state === 'C' ? RKB : ''}
}`;
}
