export const DIVISION_TEMPLATE_FIXTURE = `
division_templates={
  division_template={
    id={ id=100 type=52 }
    name="Duplicate Name"
    country="GER"
    original_tag="GER"
    foreign_template_tag="---"
    role="infantry"
    regiments={
      infantry={ x=0 y=0 }
      infantry={ x=0 y=1 }
      artillery_brigade={ x=1 y=0 }
    }
    support={
      engineer={ x=0 y=0 }
      mod_support.alpha={ x=0 y=1 }
    }
    regimental_support={
      fire_support={ x=0 y=0 }
    }
  }
  division_template={
    id={ id=101 type=52 }
    name="Duplicate Name"
    country="ENG"
    original_tag="ENG"
    foreign_template_tag="GER"
    obsolete=yes
    obsolete_change_date="1944.5.1.24"
    regiments={
      medium_armor={ x=0 y=0 }
      motorized={ x=1 y=0 }
    }
  }
  division_template={
    id={ id=7 type=170 }
    name=""
    country="D04"
    role="rangers_role"
    support={
      hq_support_company={ x=0 y=0 }
    }
  }
}
`;

export const MALFORMED_DIVISION_TEMPLATE_FIXTURE = `
division_templates={
  division_template={
    id={ id=broken type=52 }
    name="Partial"
    obsolete=perhaps
    obsolete_change_date="not-a-date"
    regiments={
      penal_battalion={ x=broken y=also_broken }
      bus={ x=1 y=2 }
    }
    support={
      broken_support={ x=bad y=3 }
      valid_support={ x=0 y=1 }
    }
  }
  division_template={
    id={ id=202 type=52 }
    name="Valid Later Template"
    country="USA"
  }
}
`;

export const DUPLICATE_TEMPLATE_REFERENCE_FIXTURE = `
division_templates={
  division_template={ id={ id=9 type=52 } name="First" country="GER" }
  division_template={ id={ id=9 type=52 } name="Second" country="GER" }
}
`;

export const DIVISION_TEMPLATE_SCOPE_FIXTURE = `
division_template={ id={ id=1 type=52 } name="Top lookalike" country="GER" }
countries={
  GER={
    units={
      division={
        division_template={ id={ id=2 type=52 } name="Nested lookalike" country="GER" }
      }
    }
  }
}
unrelated_registry={
  division_template={ id={ id=3 type=52 } name="Registry lookalike" country="GER" }
}
division_templates={
  wrapper={
    division_template={ id={ id=4 type=52 } name="Nested registry lookalike" country="GER" }
  }
  division_template={ id={ id=5 type=52 } name="Canonical" country="GER" }
}
`;
