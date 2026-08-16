export const MILITARY_PRODUCTION_FIXTURE = `HOI4txt
equipments={
  infantry_equipment_1={
    id={ id=10 type=70 }
    creator="USA"
  }
  light_tank_chassis_1={
    id={ id=20 type=70 }
    name="M2A2"
    obsolete=yes
    creator="USA"
  }
  modded-airframe.alpha={
    id={ id=900 type=170 }
    name="Modded Airframe"
    creator="D04"
  }
}
military_lines={
  id={ id=999 type=56 }
  equipment_variant_index={ id=20 type=70 }
}
countries={
  USA={
    production={
      military_lines={
        id={ id=1 type=56 }
        produced=0.125
        active_factories=4
        priority=0
        amount=-1
        speed=12.75
        cost=2.5
        requested_factories=4
        equipment_variant_index={ id=20 type=70 }
        factory_efficiencies={ 100 99.5 80 75 }
        resources={
          { resource=steel amount=8 need=0 }
          { resource=unobtanium amount=3.25 need=0.75 }
          { }
        }
        industrial_manufacturer={ id=9 type=79 }
      }
      naval_lines={
        id={ id=500 type=57 }
        equipment_variant_index={ id=20 type=70 }
      }
      wrapper={
        military_lines={
          id={ id=998 type=56 }
          equipment_variant_index={ id=20 type=70 }
        }
      }
      military_lines={
        id={ id=2 type=56 }
        queued_factories=2
        damaged_factories=1
        priority=2
        amount=-1
        cost=4
        requested_factories=3
        equipment_variant_index={ id=10 type=70 }
        factory_efficiencies={ 20 15 }
        resources={ { } }
      }
    }
  }
  D04={
    production={
      military_lines={
        id={ id=3 type=56 }
        queued_factories=1
        priority=0
        amount=-1
        cost=7.5
        requested_factories=1
        equipment_variant_index={ id=900 type=170 }
        factory_efficiencies={ }
        resources={
          { resource=modded_crystal amount=1.5 need=0.25 }
        }
      }
      military_lines={
        id={ id=4 type=56 }
        active_factories=1
        priority=1
        amount=-1
        cost=1
        requested_factories=1
        equipment_variant_index={ id=999 type=70 }
        factory_efficiencies={ 10 }
        resources={ { resource=steel amount=1 need=0 } }
      }
    }
  }
}`;

export const DUPLICATE_MILITARY_PRODUCTION_FIXTURE = `HOI4txt
equipments={ known={ id={ id=10 type=70 } } }
countries={
  GER={
    production={
      military_lines={
        id={ id=5 type=56 }
        priority=0 amount=-1 cost=1 requested_factories=1
        equipment_variant_index={ id=10 type=70 }
        factory_efficiencies={ 10 }
        resources={ { resource=steel amount=1 need=0 } }
      }
      military_lines={
        id={ id=5 type=56 }
        priority=0 amount=-1 cost=1 requested_factories=1
        equipment_variant_index={ id=10 type=70 }
        factory_efficiencies={ 10 }
        resources={ { resource=steel amount=1 need=0 } }
      }
    }
  }
}`;

export const MALFORMED_MILITARY_PRODUCTION_FIXTURE = `HOI4txt
equipments={ known={ id={ id=10 type=70 } } }
countries={
  GER={
    production={
      military_lines={
        id={ id=broken type=56 }
        priority=broken
        amount=not-a-number
        cost=broken
        equipment_variant_index={ id=10 type=70 }
        factory_efficiencies={ 10 broken-token 20.5 }
        resources={
          { resource=steel amount=broken need=1 }
          { unexpected=value }
        }
      }
      military_lines={
        id={ id=6 type=56 }
        priority=1 amount=-1 cost=2 requested_factories=1
        equipment_variant_index={ id=10 type=70 }
        factory_efficiencies={ 30 }
        resources={ { resource=steel amount=2 need=0 } }
      }
    }
  }
}`;
