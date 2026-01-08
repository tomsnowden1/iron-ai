const NAME_OVERRIDES = {
  "bench press": { required: ["barbell", "bench"] },
  "overhead press": { required: ["barbell"] },
  "hip thrust": { required: ["barbell"], optional: ["bench"] },
  "goblet squat": { required: ["dumbbell"] },
  "bulgarian split squat": { required: ["bodyweight"], optional: ["bench", "dumbbell"] },
  "walking lunges": { required: ["bodyweight"], optional: ["dumbbell"] },
  "push up": { required: ["bodyweight"] },
  "plank": { required: ["bodyweight"] },
  "pull up": { required: ["pullup_bar"] },
  "hanging knee raise": { required: ["pullup_bar"] },
  dips: { required: ["dip_station"] },
  running: { required: ["bodyweight"], optional: ["treadmill"] },
  cycling: { required: ["stationary_bike"] },
  "rowing machine": { required: ["rower"] },
  "lat pulldown": { required: ["lat_pulldown_machine"] },
  "leg press": { required: ["leg_press_machine"] },
  "leg extension": { required: ["leg_extension_machine"] },
  "leg curl": { required: ["leg_curl_machine"] },
  "standing calf raise": { required: ["calf_raise_machine"] },
};

function pushUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

export function inferExerciseEquipment(exercise) {
  const name = String(exercise?.name ?? "").trim();
  const lowered = name.toLowerCase();
  if (!lowered) {
    return { requiredEquipmentIds: [], optionalEquipmentIds: [] };
  }

  const override = NAME_OVERRIDES[lowered];
  if (override) {
    return {
      requiredEquipmentIds: [...(override.required ?? [])],
      optionalEquipmentIds: [...(override.optional ?? [])],
    };
  }

  const required = [];
  const optional = [];

  if (lowered.includes("barbell")) pushUnique(required, "barbell");
  if (lowered.includes("trap bar")) pushUnique(required, "trap_bar");
  if (lowered.includes("ez bar")) pushUnique(required, "ez_bar");
  if (lowered.includes("dumbbell")) pushUnique(required, "dumbbell");
  if (lowered.includes("kettlebell")) pushUnique(required, "dumbbell");
  if (lowered.includes("cable")) pushUnique(required, "cable_machine");
  if (lowered.includes("lat pulldown")) pushUnique(required, "lat_pulldown_machine");
  if (lowered.includes("leg press")) pushUnique(required, "leg_press_machine");
  if (lowered.includes("leg extension")) pushUnique(required, "leg_extension_machine");
  if (lowered.includes("leg curl")) pushUnique(required, "leg_curl_machine");
  if (lowered.includes("calf raise")) pushUnique(required, "calf_raise_machine");
  if (lowered.includes("pull up") || lowered.includes("pull-up") || lowered.includes("hanging")) {
    pushUnique(required, "pullup_bar");
  }
  if (lowered.includes("dip")) pushUnique(required, "dip_station");
  if (lowered.includes("rowing machine") || lowered.includes("rower")) {
    pushUnique(required, "rower");
  }
  if (lowered.includes("cycling") || lowered.includes("bike")) {
    pushUnique(required, "stationary_bike");
  }
  if (lowered.includes("running")) pushUnique(optional, "treadmill");

  const needsBench =
    lowered.includes("bench press") ||
    lowered.includes("dumbbell bench") ||
    lowered.includes("incline") ||
    lowered.includes("chest fly");
  if (needsBench) pushUnique(required, "bench");

  if (required.length === 0) {
    pushUnique(required, "bodyweight");
  }

  return {
    requiredEquipmentIds: required,
    optionalEquipmentIds: optional,
  };
}
