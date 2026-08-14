export const EQUIPMENT_REGISTRY_FIXTURE = `HOI4txt
equipments={
  infantry_equipment_1={
    id={ id=10 type=70 }
    max_version=0
    creator="ENG"
    origin="---"
    is_frame=no
  }
  light_tank_chassis_1={
    id={ id=2386 type=70 }
    name="M2A2"
    version=2
    parent_id={ id=2385 type=70 }
    obsolete=yes
    is_frame=no
    creator="USA"
    origin="CZE"
    design_team={ id=42 type=79 }
    modules={
      main_armament_slot=tank_heavy_machine_gun
    }
  }
  light_tank_chassis_1={
    id={ id=5199 type=70 }
    name="M2 Light"
    version=3
    parent_id={ id=2385 type=70 }
    is_frame=no
    creator="USA"
    origin="---"
  }
  modded-equipment.alpha={
    id={ id=900 type=170 }
    name=""
    creator="D04"
  }
}
wrapper={
  equipments={
    nested_equipment={ id={ id=999 type=70 } }
  }
}`;

export const STOCKPILE_SCOPE_FIXTURE = `${EQUIPMENT_REGISTRY_FIXTURE}
countries={
  USA={
    units={
      division={
        equipment={ id={ id=10 type=70 } amount=999 }
      }
    }
    production={
      available_equipments={
        equipment={ id=10 type=70 }
      }
      foreign_lease_equipments={
        equipment={ id=2386 type=70 }
      }
      military_lines={
        equipment_variant_index={ id=5199 type=70 }
        equipments={
          equipment={ id={ id=10 type=70 } amount=888 }
        }
      }
      equipments={
        equipment={ id={ id=2386 type=70 } amount=49 }
        equipment={ id={ id=5199 type=70 } amount=327 }
      }
    }
    equipment_market={
      market_stockpile={
        equipments={
          equipment={ id={ id=10 type=70 } amount=777 }
        }
      }
    }
  }
  D04={
    production={
      equipments={
        equipment={ id={ id=900 type=170 } amount=-0.4816 }
      }
    }
  }
  LUX={
    political={ value=1 }
  }
}
air_wing_pool={
  air_wings={
    equipment={
      equipment={ id={ id=10 type=70 } amount=100 }
    }
  }
}
equipment_market={
  contracts={
    equipments={
      equipment={ id={ id=10 type=70 } amount=666 }
    }
  }
}`;

export const AMOUNT_FIXTURE = `HOI4txt
equipments={
  test_equipment_1={ id={ id=1 type=70 } }
  test_equipment_2={ id={ id=2 type=70 } }
  test_equipment_3={ id={ id=3 type=70 } }
  test_equipment_4={ id={ id=4 type=70 } }
  test_equipment_5={ id={ id=5 type=70 } }
}
countries={
  GER={
    production={
      equipments={
        equipment={ id={ id=1 type=70 } amount=49 }
        equipment={ id={ id=2 type=70 } amount=15555.42655 }
        equipment={ id={ id=3 type=70 } amount=-0.4816 }
        equipment={ id={ id=4 type=70 } amount=-20 }
        equipment={ id={ id=5 type=70 } amount=220197.792 }
      }
    }
  }
}`;

export const MALFORMED_STOCKPILE_FIXTURE = `HOI4txt
equipments={
  known_equipment={ id={ id=1 type=70 } }
}
countries={
  SOV={
    production={
      equipments={
        equipment={ id={ id=1 type=70 } }
        equipment={ id={ id=1 type=70 } amount=not-a-number }
        equipment={ amount=3 }
        equipment={ id={ id=broken type=70 } amount=4 }
        equipment={ id={ type=70 } amount=5 }
        equipment={ id={ id=1 } amount=6 }
        equipment={ id={ id=1 type=broken } amount=7 }
        equipment={ id={ id=999 type=70 } amount=8 }
        equipment={ id={ id=1 type=70 } amount=9 }
      }
    }
  }
}`;

export const DUPLICATE_STOCKPILE_FIXTURE = `HOI4txt
equipments={
  known_equipment={ id={ id=1 type=70 } }
}
countries={
  GER={
    production={
      equipments={
        equipment={ id={ id=1 type=70 } amount=4 }
        equipment={ id={ id=1 type=70 } amount=4 }
      }
    }
  }
}`;
