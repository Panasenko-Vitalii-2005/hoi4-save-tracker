export const ARMY_HIERARCHY_FIXTURE = `
character_manager={
  historical={
    character={
      id={ id=1 type=73 }
      name="Duplicate Commander Name"
      country="GER"
      corps_commander={
        id={ id=10 type=4713 }
        name="Duplicate Commander Name"
        skill=3
        traits={ organizer custom_general_trait }
      }
    }
    character={
      id={ id=2 type=73 }
      name="Duplicate Commander Name"
      country="GER"
      field_marshal={
        id={ id=20 type=4713 }
        name="Duplicate Commander Name"
        skill=4
        traits={ offensive_doctrine }
      }
    }
    wrapper={
      character={
        id={ id=99 type=73 }
        country="GER"
        corps_commander={ id={ id=99 type=4713 } name="Nested lookalike" }
      }
    }
  }
  dynamic={
    character={
      id={ id=4 type=73 }
      name="Dynamic Commander"
      country="D04"
      corps_commander={
        id={ id=40 type=4713 }
        name="Dynamic Commander"
        skill=2
      }
    }
  }
}
countries={
  GER={
    theatres={
      theatre={
        id={ id=1 type=67 }
        orders_group={
          id={ id=100 type=53 }
          name="Army Alpha"
          member={ unit={ id=1 type=51 } }
          member={ unit={ id=2 type=4713 } }
          member={ unit={ id=5 type=51 } }
          leader_unit={ id=1 type=51 }
          leader={ id=10 type=4713 }
        }
        orders_group={
          id={ id=101 type=53 }
          member={ unit={ id=3 type=51 } }
        }
        field_marshal_group={
          orders_group={ id=100 type=53 }
          orders_group={ id=101 type=53 }
          id={ id=200 type=53 }
          name="Army Group Alpha"
          leader={ id=20 type=4713 }
        }
        theater_group={
          id={ id=300 type=68 }
          orders_group={ id=100 type=53 }
        }
        wrapper={
          orders_group={ id={ id=999 type=53 } name="Nested lookalike" }
        }
      }
    }
    history={
      theatres={
        theatre={
          id={ id=9 type=67 }
          orders_group={ id={ id=998 type=53 } name="History lookalike" }
        }
      }
    }
  }
  SOV={
    theatres={
      theatre={
        id={ id=2 type=67 }
        orders_group={
          id={ id=300 type=53 }
          name="Independent Army"
          member={ unit={ id=99 type=51 } }
          leader={ id=999 type=4713 }
        }
      }
    }
  }
  D04={
    theatres={
      theatre={
        id={ id=3 type=67 }
        orders_group={
          id={ id=400 type=53 }
          name="Dynamic Army"
          member={ unit={ id=4 type=4713 } }
          leader={ id=40 type=4713 }
        }
        field_marshal_group={
          orders_group={ id=400 type=53 }
          orders_group={ id=999 type=53 }
          id={ id=401 type=53 }
          name="Dynamic Army Group"
        }
      }
    }
  }
}
orders_group={ id={ id=997 type=53 } name="Top-level lookalike" }
`;

export const MALFORMED_ARMY_HIERARCHY_FIXTURE = `
character_manager={
  historical={
    character={
      id={ id=broken type=73 }
      country="USA"
      corps_commander={
        id={ id=broken type=4713 }
        name="Partial Commander"
        skill=broken
        traits={ malformed_trait }
      }
    }
    character={
      id={ id=8 type=73 }
      country="USA"
      corps_commander={ id={ id=80 type=4713 } name="Valid Later Commander" }
    }
  }
}
countries={
  USA={
    theatres={
      theatre={
        id={ id=broken type=67 }
        orders_group={
          id={ id=broken type=53 }
          name="Partial Army"
          member={ unit={ id=broken type=51 } }
        }
        orders_group={
          id={ id=800 type=53 }
          name="Valid Later Army"
          member={ unit={ id=8 type=51 } }
        }
        field_marshal_group={
          orders_group={ id=broken type=53 }
          id={ id=broken type=53 }
          name="Partial Group"
        }
        field_marshal_group={
          orders_group={ id=800 type=53 }
          id={ id=801 type=53 }
          name="Valid Later Group"
        }
      }
    }
  }
}
`;

export const DUPLICATE_ARMY_HIERARCHY_FIXTURE = `
character_manager={
  historical={
    character={
      id={ id=1 type=73 }
      country="GER"
      corps_commander={ id={ id=10 type=4713 } name="Earlier Commander" }
    }
    character={
      id={ id=2 type=73 }
      country="GER"
      corps_commander={ id={ id=10 type=4713 } name="Later Commander" }
    }
  }
}
countries={
  GER={
    theatres={
      theatre={
        id={ id=1 type=67 }
        orders_group={
          id={ id=100 type=53 }
          name="Earlier Army"
          member={ unit={ id=1 type=51 } }
          leader={ id=10 type=4713 }
        }
        orders_group={
          id={ id=100 type=53 }
          name="Later Army"
          member={ unit={ id=1 type=51 } }
          leader={ id=10 type=4713 }
        }
        field_marshal_group={
          orders_group={ id=100 type=53 }
          id={ id=200 type=53 }
          name="Earlier Group"
        }
        field_marshal_group={
          orders_group={ id=100 type=53 }
          id={ id=200 type=53 }
          name="Later Group"
        }
      }
    }
  }
}
`;
