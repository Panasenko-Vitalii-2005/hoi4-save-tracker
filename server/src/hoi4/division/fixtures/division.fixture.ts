export const DIVISION_FIXTURE = `HOI4txt
equipments={
  infantry_equipment_2={
    id={ id=10 type=70 }
    name="Service Rifle"
    creator="USA"
    origin="---"
  }
  modded_tank.alpha={
    id={ id=20 type=170 }
    name="Variant Alpha"
    creator="D04"
    origin="D04"
  }
}
countries={
  USA={
    units={
      division={
        id={ id=1 type=51 }
        logical_country="USA"
        id={ id=1 type=51 }
        division_template_id={ id=100 type=52 }
        division_name={ type=0 override="Hawaiian Division" }
        location=4200
        max_supply=108
        organisation=33.25
        strength=232.8
        equipment={
          equipment={ id={ id=10 type=70 } amount=1010 }
          equipment={ id={ id=20 type=170 } amount=1.25 }
          allow_zero_entries=no
        }
        army_manpower={
          army_manpower_value={ value={ tag="USA" value=12520 } }
          army_manpower_need={ value={ tag="USA" value=12520 } }
        }
        experience=1636.33096
        fuel=6.5
        fuel_requested=1.25
        out_of_supply_days=3
        disrupted_supply=0.25
        army_current_supply_ratio=120
        supply_gain=0.15
        strategic_redeployment=yes
        retreat=no
        support_attack=6519
      }
      division={
        id={ id=2 type=4713 }
        logical_country="USA"
        id={ id=2 type=4713 }
        division_template_id={ id=101 type=52 }
        division_name={ type=0 name_order=42 }
        location=5656
        max_supply=108
        organisation=3.5
        strength=85.03714
        equipment={
          equipment={ id={ id=10 type=70 } amount=350 }
          allow_zero_entries=no
        }
        army_manpower={
          army_manpower_value={ value={ tag="FRA" value=6020 } }
          army_manpower_need={ value={ tag="FRA" value=6020 } }
        }
        experience=331.54889
        army_current_supply_ratio=108
        supply_gain=0.15
      }
    }
  }
  D04={
    units={
      division={
        id={ id=3 type=4713 }
        logical_country="D04"
        expeditionary_owner="RKN"
        id={ id=3 type=4713 }
        division_template_id={ id=102 type=52 }
        division_name={ type=1 override="Foreign Division" name_order=7 }
        location=6449
        max_supply=108
        organisation=12
        strength=151
        equipment={
          equipment={ id={ id=20 type=170 } amount=0 }
          equipment={ id={ id=20 type=170 } amount=-2.5 }
          equipment={ id={ id=999 type=70 } amount=0.03846 }
          allow_zero_entries=yes
        }
        army_manpower={
          army_manpower_value={ value={ tag="RKN" value=6400 } }
          army_manpower_need={ value={ tag="RKN" value=6500 } }
        }
        experience=639.639
        army_current_supply_ratio=0
        supply_gain=0.04
      }
    }
  }
}`;

export const MALFORMED_DIVISION_FIXTURE = `HOI4txt
equipments={
  known_equipment={ id={ id=1 type=70 } creator="GER" }
}
countries={
  GER={
    units={
      division={
        id={ id=broken type=51 }
        id={ id=7 type=4713 }
        logical_country="GER"
        division_template_id={ id=7 type=52 }
        division_name={ type=0 name_order=7 }
        location=1
        max_supply=108
        organisation=10
        strength=120
        equipment={ equipment={ id={ id=1 type=70 } amount=5 } }
        army_manpower={
          army_manpower_value={ value={ tag="GER" value=900 } }
          army_manpower_need={ value={ tag="GER" value=1000 } }
        }
        experience=20
        army_current_supply_ratio=100
        supply_gain=0.1
      }
      division={
        id={ id=8 type=51 }
        id={ id=9 type=4713 }
        logical_country="SOV"
        division_template_id={ id=8 type=52 }
        division_name={ type=0 override="Conflicting ID" }
        location=2
        max_supply=108
        organisation=20
        strength=130
        equipment={ equipment={ id={ id=1 type=70 } amount=6 } }
        army_manpower={
          army_manpower_value={ value={ tag="GER" value=1000 } }
          army_manpower_need={ value={ tag="GER" value=1000 } }
        }
        experience=30
        army_current_supply_ratio=108
        supply_gain=0.15
      }
      division={
        id={ id=broken type=broken }
        division_template_id={ id=broken }
        division_name={ type=broken name_order=invalid }
        location=invalid
        max_supply=invalid
        organisation=invalid
        strength=invalid
        equipment={ equipment={ id={ id=1 } amount=invalid } }
        army_manpower={
          army_manpower_value={ value={ value=invalid } }
        }
        experience=invalid
        fuel=invalid
        army_current_supply_ratio=invalid
        supply_gain=invalid
        retreat=perhaps
      }
      division={
        id={ id=10 type=51 }
        id={ id=10 type=51 }
        logical_country="GER"
        division_template_id={ id=10 type=52 }
        division_name={ type=0 override="Valid Later Division" }
        location=3
        max_supply=108
        organisation=30
        strength=140
        equipment={ equipment={ id={ id=1 type=70 } amount=7 } }
        army_manpower={
          army_manpower_value={ value={ tag="GER" value=1100 } }
          army_manpower_need={ value={ tag="GER" value=1100 } }
        }
        experience=40
        army_current_supply_ratio=108
        supply_gain=0.15
      }
    }
  }
}`;

export const DIVISION_SCOPE_FIXTURE = `HOI4txt
countries={
  GER={
    units={
      division={
        id={ id=1 type=51 }
        id={ id=1 type=51 }
        logical_country="GER"
        division_template_id={ id=1 type=52 }
        division_name={ type=0 override="Canonical" }
        location=1
        max_supply=108
        organisation=10
        strength=100
        equipment={ }
        army_manpower={
          army_manpower_value={ value={ tag="GER" value=1000 } }
          army_manpower_need={ value={ tag="GER" value=1000 } }
        }
        experience=10
        army_current_supply_ratio=108
        supply_gain=0.15
      }
      history={
        division={ id={ id=2 type=51 } }
      }
      training_queue={
        division={ id={ id=3 type=51 } }
      }
    }
    orders_group={
      division={ id={ id=4 type=51 } }
    }
    field_marshal_group={
      division={ id={ id=5 type=51 } }
    }
    experience_status={
      division={ id={ id=6 type=51 } }
    }
    deployment={
      military_deployment_line={
        division={ id={ id=7 type=51 } }
      }
    }
  }
}
combat={
  land_combat={
    attacker={ division={ id={ id=8 type=51 } } }
  }
}
division={ id={ id=9 type=51 } }
history={ division={ id={ id=10 type=51 } } }
}`;
