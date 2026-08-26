import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeSave } from './hoi4-parser';

describe('hoi4-parser effective industry', () => {
  const fixturePath = path.join(
    os.tmpdir(),
    `hoi4-effective-industry-${process.pid}.hoi4`,
  );

  afterEach(() => {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  });

  function analyze(content: string) {
    fs.writeFileSync(fixturePath, `\n${content}`, 'latin1');
    return analyzeSave(fixturePath);
  }

  function country(content: string, tag: string) {
    return analyze(content).by_country.find((entry) => entry.tag === tag);
  }

  test('uses healthy factory levels and classifies autonomous occupation as owned', () => {
    const result = country(
      `states={
\t1={
\t\tbuildings={
\t\t\tarms_factory={ level=4 healthy_levels=3 }
\t\t\tindustrial_complex={ level=2 healthy_levels=2 }
\t\t}
\t\towner="AAA"
\t}
\t2={
\t\tbuildings={
\t\t\tarms_factory={ level=2 healthy_levels=2 }
\t\t\tindustrial_complex={ level=3 healthy_levels=3 }
\t\t}
\t\towner="AAA"
\t\tresistance={ occupied_country_tag="BBB" compliance=0 }
\t}
}
countries={
\tAAA={
\t\tcores={ 1 }
\t\toccupation_status={
\t\t\toccupation={
\t\t\t\tBBB={ occupation_law_list={ 2="autonomous_occupation" } }
\t\t\t}
\t\t}
\t}
}`,
      'AAA',
    );

    expect(result).toMatchObject({
      militaryFactories: 6,
      civilianFactories: 5,
      effectiveOwnMilitaryFactories: 6,
      occupiedMilitaryFactories: 0,
      effectiveMilitaryFactories: 5,
      ownedCivilianFactories: 5,
      occupiedCivilianFactories: 0,
      effectiveCivilianFactories: 5,
    });
  });

  test('floors controller-owned occupation and jointly rounds foreign occupation', () => {
    const result = country(
      `states={
\t10={
\t\tbuildings={
\t\t\tarms_factory={ level=1 healthy_levels=1 }
\t\t\tindustrial_complex={ level=1 healthy_levels=1 }
\t\t}
\t\towner="BBB"
\t\tcontroller="AAA"
\t\tresistance={ occupied_country_tag="BBB" compliance=10 }
\t}
\t11={
\t\tbuildings={ arms_factory={ level=2 healthy_levels=2 } }
\t\towner="CCC"
\t\tcontroller="AAA"
\t\tresistance={ occupied_country_tag="CCC" compliance=70 }
\t}
\t12={
\t\tbuildings={
\t\t\tarms_factory={ level=2 healthy_levels=2 }
\t\t\tindustrial_complex={ level=1 healthy_levels=1 }
\t\t}
\t\towner="AAA"
\t\tresistance={ occupied_country_tag="DDD" compliance=16 }
\t}
}
countries={
\tAAA={
\t\tcores={ }
\t\toccupation_status={
\t\t\toccupation={
\t\t\t\tBBB={ occupation_law_list={ 10="military_governor_occupation" } }
\t\t\t\tCCC={ occupation_law_list={ 11="military_governor_occupation" } }
\t\t\t\tDDD={ occupation_law_list={ 12="military_governor_occupation" } }
\t\t\t}
\t\t}
\t}
}`,
      'AAA',
    );

    expect(result?.occupiedCivilianFactories).toBe(1);
    expect(result?.effectiveOwnMilitaryFactories).toBe(1);
    expect(result?.occupiedMilitaryFactories).toBe(2);
  });

  test('aggregates ordinary subject transfers with off-map, trade, idea and leader modifiers', () => {
    const result = country(
      `character_manager={
\tcharacter={
\t\tid={ id=1 type=73 }
\t\tcountry_leaders={ traits={ aloof_authority } }
\t}
}
states={
\t2={
\t\tbuildings={
\t\t\tarms_factory={ level=2 healthy_levels=2 }
\t\t\tindustrial_complex={ level=3 healthy_levels=3 }
\t\t}
\t\towner="BBB"
\t}
}
countries={
\tAAA={
\t\tpuppet={ first="AAA" second="BBB" autonomy_state="autonomy_integrated_puppet" }
\t}
\tBBB={
\t\tcores={ 2 }
\t\tbuildings={
\t\t\tarms_factory={ level=1 healthy_levels=1 }
\t\t\tindustrial_complex={ level=1 healthy_levels=1 }
\t\t}
\t\texport={ lended_cic=4 }
\t\tpolitics={
\t\t\truling_party=neutrality
\t\t\tideas={ MAL_colonial_administration_idea }
\t\t\tparties={
\t\t\t\tneutrality={
\t\t\t\t\tcountry_leader={ character={ id=1 type=73 } }
\t\t\t\t}
\t\t\t}
\t\t}
\t}
}`,
      'AAA',
    );

    expect(result?.subjectCivilianFactories).toBe(4);
    expect(result?.subjectMilitaryFactories).toBe(2);
  });

  test('attributes government-in-exile legitimacy donations to the host', () => {
    const result = country(
      `countries={
\tAAA={ }
\tBBB={ hosting_our_government_in_exile="AAA" legitimacy=77.728 }
\tCCC={ hosting_our_government_in_exile="AAA" legitimacy=100 }
}`,
      'AAA',
    );

    expect(result?.effectiveCivilianFactories).toBe(9);
    expect(result?.effectiveMilitaryFactories).toBe(9);
  });

  test('keeps targeted subject transfers save-driven instead of tag-driven', () => {
    const result = country(
      `states={
\t2={
\t\tbuildings={
\t\t\tarms_factory={ level=8 healthy_levels=8 }
\t\t\tindustrial_complex={ level=8 healthy_levels=8 }
\t\t}
\t\towner="BBB"
\t}
}
countries={
\tAAA={
\t\tpuppet={ first="AAA" second="BBB" autonomy_state="autonomy_integrated_puppet" }
\t}
\tBBB={
\t\tcores={ 2 }
\t\tpolitics={ ideas={ GER_german_controlled_reichskommissariat } }
\t}
}`,
      'AAA',
    );

    expect(result?.subjectCivilianFactories).toBe(3);
    expect(result?.subjectMilitaryFactories).toBe(7);
  });

  test('uses the subject runtime autonomy state when diplomacy is stale', () => {
    const result = country(
      `states={
\t2={
\t\tbuildings={
\t\t\tarms_factory={ level=8 healthy_levels=8 }
\t\t\tindustrial_complex={ level=4 healthy_levels=4 }
\t\t}
\t\towner="BBB"
\t}
}
countries={
\tAAA={
\t\tpuppet={ first="AAA" second="BBB" autonomy_state="autonomy_puppet" }
\t}
\tBBB={
\t\tcores={ 2 }
\t\tautonomy_state={ current_state="autonomy_integrated_puppet" }
\t}
}`,
      'AAA',
    );

    expect(result?.subjectCivilianFactories).toBe(1);
    expect(result?.subjectMilitaryFactories).toBe(6);
  });

  test('rounds ordinary subject transfers per subject', () => {
    const result = country(
      `states={
\t2={ buildings={ arms_factory={ level=1 healthy_levels=1 } } owner="BBB" }
\t3={ buildings={ arms_factory={ level=1 healthy_levels=1 } } owner="CCC" }
}
countries={
\tAAA={
\t\tpuppet={ first="AAA" second="BBB" autonomy_state="autonomy_puppet" }
\t\tpuppet={ first="AAA" second="CCC" autonomy_state="autonomy_puppet" }
\t}
\tBBB={
\t\tcores={ 2 }
\t\tpolitics={ ideas={ SOV_comecon_puppet_default } }
\t}
\tCCC={
\t\tcores={ 3 }
\t\tpolitics={ ideas={ SOV_comecon_puppet_default } }
\t}
}`,
      'AAA',
    );

    expect(result?.subjectMilitaryFactories).toBe(2);
  });

  test('preserves a relation whose subject country block is missing', () => {
    const result = country(
      `states={
\t1={ buildings={ arms_factory={ level=1 healthy_levels=1 } } owner="AAA" }
}
countries={
\tAAA={
\t\tcores={ 1 }
\t\tpuppet={ first="AAA" second="BBB" autonomy_state="autonomy_integrated_puppet" }
\t}
}`,
      'AAA',
    );

    expect(result?.subjectCivilianFactories).toBe(0);
    expect(result?.subjectMilitaryFactories).toBe(0);
  });

  test('preserves duplicate subject relations and their source order semantics', () => {
    const result = country(
      `states={
\t2={
\t\tbuildings={
\t\t\tarms_factory={ level=8 healthy_levels=8 }
\t\t\tindustrial_complex={ level=4 healthy_levels=4 }
\t\t}
\t\towner="BBB"
\t}
}
countries={
\tAAA={
\t\tpuppet={ first="AAA" second="BBB" autonomy_state="autonomy_integrated_puppet" }
\t\tpuppet={ first="AAA" second="BBB" autonomy_state="autonomy_integrated_puppet" }
\t}
\tBBB={ cores={ 2 } }
}`,
      'AAA',
    );

    expect(result?.subjectCivilianFactories).toBe(2);
    expect(result?.subjectMilitaryFactories).toBe(12);
  });

  test('applies the selected occupation-law local factory modifier', () => {
    const result = country(
      `states={
\t2={
\t\tbuildings={
\t\t\tarms_factory={ level=4 healthy_levels=4 }
\t\t\tindustrial_complex={ level=4 healthy_levels=4 }
\t\t}
\t\towner="BBB"
\t\tcontroller="AAA"
\t\tresistance={ occupied_country_tag="BBB" compliance=50 }
\t}
}
countries={
\tAAA={
\t\toccupation_status={
\t\t\toccupation={ BBB={ occupation_law_list={ 2="independent_rule" } } }
\t\t}
\t}
}`,
      'AAA',
    );

    expect(result?.occupiedCivilianFactories).toBe(1);
    expect(result?.occupiedMilitaryFactories).toBe(2);
  });

  test('counts controller-owned occupied cores as full owned industry', () => {
    const result = country(
      `states={
\t2={
\t\tbuildings={
\t\t\tarms_factory={ level=3 healthy_levels=3 }
\t\t\tindustrial_complex={ level=2 healthy_levels=2 }
\t\t}
\t\towner="AAA"
\t\tresistance={ occupied_country_tag="BBB" compliance=0 }
\t}
}
countries={
\tAAA={ cores={ 2 } }
}`,
      'AAA',
    );

    expect(result).toMatchObject({
      ownedCivilianFactories: 2,
      occupiedCivilianFactories: 0,
      effectiveOwnMilitaryFactories: 3,
      occupiedMilitaryFactories: 0,
    });
  });

  test('includes healthy off-map country buildings in effective industry', () => {
    const result = country(
      `countries={
\tAAA={
\t\tbuildings={
\t\t\tarms_factory={ level=1 healthy_levels=1 }
\t\t\tindustrial_complex={ level=2 healthy_levels=2 }
\t\t}
\t}
}`,
      'AAA',
    );

    expect(result).toMatchObject({
      occupiedCivilianFactories: 2,
      effectiveCivilianFactories: 2,
      occupiedMilitaryFactories: 1,
      effectiveMilitaryFactories: 1,
    });
  });
});
