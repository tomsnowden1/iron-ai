export const EQUIPMENT_CATEGORIES = [
  { id: "free_weights", label: "Free weights" },
  { id: "machine", label: "Machine" },
  { id: "bodyweight", label: "Bodyweight" },
  { id: "cardio", label: "Cardio" },
  { id: "accessory", label: "Accessory" },
];

export const EQUIPMENT_CATALOG = [
  {
    id: "bodyweight",
    name: "Bodyweight",
    category: "bodyweight",
    aliases: ["bodyweight", "body weight"],
    isPortable: true,
  },
  {
    id: "barbell",
    name: "Barbell",
    category: "free_weights",
    aliases: ["barbell"],
    isPortable: false,
  },
  {
    id: "dumbbell",
    name: "Dumbbell",
    category: "free_weights",
    aliases: ["dumbbell", "db"],
    isPortable: true,
  },
  {
    id: "ez_bar",
    name: "EZ Bar",
    category: "free_weights",
    aliases: ["ez bar", "curl bar"],
    isPortable: false,
  },
  {
    id: "trap_bar",
    name: "Trap Bar",
    category: "free_weights",
    aliases: ["trap bar", "hex bar"],
    isPortable: false,
  },
  {
    id: "bench",
    name: "Bench",
    category: "accessory",
    aliases: ["bench"],
    isPortable: false,
  },
  {
    id: "squat_rack",
    name: "Squat Rack",
    category: "accessory",
    aliases: ["rack", "squat rack", "power rack"],
    isPortable: false,
  },
  {
    id: "cable_machine",
    name: "Cable Machine",
    category: "machine",
    aliases: ["cable", "cable machine"],
    isPortable: false,
  },
  {
    id: "lat_pulldown_machine",
    name: "Lat Pulldown Machine",
    category: "machine",
    aliases: ["lat pulldown"],
    isPortable: false,
  },
  {
    id: "leg_press_machine",
    name: "Leg Press Machine",
    category: "machine",
    aliases: ["leg press"],
    isPortable: false,
  },
  {
    id: "leg_extension_machine",
    name: "Leg Extension Machine",
    category: "machine",
    aliases: ["leg extension"],
    isPortable: false,
  },
  {
    id: "leg_curl_machine",
    name: "Leg Curl Machine",
    category: "machine",
    aliases: ["leg curl"],
    isPortable: false,
  },
  {
    id: "calf_raise_machine",
    name: "Calf Raise Machine",
    category: "machine",
    aliases: ["calf raise"],
    isPortable: false,
  },
  {
    id: "pullup_bar",
    name: "Pull-up Bar",
    category: "accessory",
    aliases: ["pull-up bar", "pull up bar"],
    isPortable: true,
  },
  {
    id: "dip_station",
    name: "Dip Station",
    category: "accessory",
    aliases: ["dip station", "dip bar"],
    isPortable: true,
  },
  {
    id: "treadmill",
    name: "Treadmill",
    category: "cardio",
    aliases: ["treadmill"],
    isPortable: false,
  },
  {
    id: "stationary_bike",
    name: "Stationary Bike",
    category: "cardio",
    aliases: ["bike", "stationary bike"],
    isPortable: false,
  },
  {
    id: "rower",
    name: "Rowing Machine",
    category: "cardio",
    aliases: ["rower", "rowing machine"],
    isPortable: false,
  },
];

export const EQUIPMENT_ID_SET = new Set(EQUIPMENT_CATALOG.map((item) => item.id));

export function getEquipmentMap(list = EQUIPMENT_CATALOG) {
  return new Map(list.map((item) => [item.id, item]));
}

export function sortEquipment(list) {
  return [...list].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}
