// Minimal transcriptions of line 56:1738 / equipment 70:6847 in the validated
// 1.19.2.0.3eb1 (85f4) controls. No game installation or private save is needed.
// A: autosave_100_reload_1192_control_temp.hoi4 (1944.5.1.2)
// B: post_load_1h_no_trade_control_temp.hoi4 (1944.5.1.3, no new trade)
// Manual UI oracle is evidence, NOT an input to parser/aggregator calculations.
export const PAK44_RUNTIME_ORACLE = {
  A: { suppliedTungsten: 1, missingTungsten: 21, itemsPerDay: 7.74 },
  B: { suppliedTungsten: 22, missingTungsten: 0, itemsPerDay: 14.54 },
} as const;

export function pak44ControlSave(control: 'A' | 'B'): string {
  return `HOI4txt
date="1944.5.1.${control === 'A' ? 2 : 3}"
equipments={
  anti_tank_equipment_3={
    id={ id=6847 type=70 }
    name="12.8 cm PaK 44"
    creator="GER"
  }
}
countries={
  GER={
    production={
      military_lines={
        id={ id=1738 type=56 }
        produced=4.58278
        active_factories=11
        priority=8
        amount=-1
        speed=84.64039
        cost=5.82
        requested_factories=11
        equipment_variant_index={ id=6847 type=70 }
        factory_efficiencies={ 113 113 113 113 113 113 113 109.57720 89.78839 71.22549 61.34225 }
        resources={
          { resource=tungsten amount=22 need=0 }
          { resource=steel amount=33 need=0 }
          { resource=chromium amount=11 need=0 }
        }
        industrial_manufacturer={ id=24 type=79 }
      }
    }
  }
}`;
}
