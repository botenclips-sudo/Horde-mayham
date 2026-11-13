// Story mode: "Operation Patient Zero". Hand-made missions with their own
// objectives, gear and radio chatter, played in order.

import type { ZombieKind } from './data';

export type Goal =
  | { type: 'survive'; time: number }
  | { type: 'kill'; n: number; kind?: ZombieKind }
  | { type: 'collect'; n: number }
  | { type: 'defend'; time: number; hp: number }
  | { type: 'evac'; after: number; hold: number }
  | { type: 'boss'; kind: ZombieKind };

/** The third star: beat a par time, or finish without taking many hits. */
export type Star3 = { type: 'time'; s: number } | { type: 'hits'; n: number };

export interface OpDef {
  id: string;
  name: string;
  map: string;
  /** Briefing shown before you deploy. */
  brief: string;
  goal: Goal;
  /** How tough the horde is (as if it were this wave of Endless). */
  level: number;
  /** Field issue: the guns you carry on this op. */
  guns: string[];
  perks?: string[];
  /** Extra spawn chances on top of the usual mix for this level. */
  mix?: [ZombieKind, number][];
  star3: Star3;
  /** Brains for the first clear. */
  reward: number;
  /** Radio chatter: [seconds into the op, who, line]. */
  radio: [number, string, string][];
}

export const HALE = 'CMDR. HALE';
export const OKAFOR = 'DR. OKAFOR';

export const OPS: OpDef[] = [
  {
    id: 'op1',
    name: 'Lights Out',
    map: 'lab',
    brief: 'Hive Labs went dark at 03:00. Something broke out of Zone 0 and the backup power is failing. Hold the glass chamber until the generators restart.',
    goal: { type: 'survive', time: 75 },
    level: 3,
    guns: ['smg', 'pistol'],
    star3: { type: 'hits', n: 6 },
    reward: 40,
    radio: [
      [1, HALE, "Sweeper One, you're inside Hive Labs. Hold that chamber."],
      [11, OKAFOR, 'The floor consoles still work! Stand on one to fire the laser grid.'],
      [24, HALE, 'Careful, the grid cuts you too. DASH right through the beam.'],
      [46, OKAFOR, "If the lights die, that's the power. It comes back. Keep moving."],
      [64, OKAFOR, 'Generators are spooling up... almost there!'],
    ],
  },
  {
    id: 'op2',
    name: 'Patient Files',
    map: 'lab',
    brief: "My research is on five data drives scattered around the lab. Without them there's no cure. Grab them before the horde tramples them.",
    goal: { type: 'collect', n: 5 },
    level: 5,
    guns: ['plasma', 'rifle'],
    perks: ['hollow'],
    mix: [['parasite', 0.08]],
    star3: { type: 'time', s: 100 },
    reward: 50,
    radio: [
      [1, OKAFOR, 'The drives blink green. Follow the arrow at the edge of your screen.'],
      [9, HALE, "You've got the Plasma Cutter. Hold it on one target and it heats up."],
      [26, OKAFOR, 'Those little crawling things are parasites. If one grabs you, DASH to shake it off.'],
    ],
  },
  {
    id: 'op3',
    name: 'Hold the Line',
    map: 'lot',
    brief: "We're airlifting a generator into the parking lot to power the evac beacon. Keep the horde off it for 90 seconds.",
    goal: { type: 'defend', time: 90, hp: 1500 },
    level: 6,
    guns: ['railgun', 'shotgun'],
    perks: ['hollow', 'tough'],
    mix: [['mutant', 0.06]],
    star3: { type: 'hits', n: 8 },
    reward: 60,
    radio: [
      [1, HALE, 'Generator is down. Every zombie that reaches it chews on it. Do not let it fall.'],
      [10, OKAFOR, 'The Railgun charges while you hold the trigger, then punches through EVERYTHING in a line.'],
      [28, OKAFOR, "Mutants heal themselves when you stop hurting them. Keep shooting. Fire and ice stop the healing."],
      [70, HALE, '20 seconds! Hold!'],
    ],
  },
  {
    id: 'op4',
    name: 'The Nest',
    map: 'subway',
    brief: "The parasites are breeding in the subway tunnels. Burn the nest: kill 70 of them. They'll go for your face.",
    goal: { type: 'kill', n: 70, kind: 'parasite' },
    level: 7,
    guns: ['flamer', 'autoshotgun'],
    perks: ['sprint', 'tough'],
    mix: [['parasite', 0.28]],
    star3: { type: 'time', s: 80 },
    reward: 60,
    radio: [
      [1, HALE, 'Flamethrower and auto shotgun. Light them up.'],
      [8, OKAFOR, 'Remember: if one latches on, DASH. Dashing rips it off and squashes it.'],
      [30, HALE, 'And watch the tracks. Those trains still run.'],
    ],
  },
  {
    id: 'op5',
    name: 'Mind Games',
    map: 'gas',
    brief: 'Psykers: test subjects with their brains on the outside. They yank you across the room with their minds. Take out 6 of them.',
    goal: { type: 'kill', n: 6, kind: 'psyker' },
    level: 9,
    guns: ['mindray', 'rifle'],
    perks: ['hollow', 'tough', 'trigger'],
    mix: [['psyker', 0.07]],
    star3: { type: 'time', s: 130 },
    reward: 70,
    radio: [
      [1, OKAFOR, "That's the Mind Ray. A few hits and a zombie fights for YOU, until its brain fries."],
      [12, HALE, 'When a Psyker glows purple and the line locks on you, dash sideways or get pulled.'],
      [40, OKAFOR, 'Turned zombies hit their friends hard. Turn the big ones!'],
    ],
  },
  {
    id: 'op6',
    name: 'Mitosis',
    map: 'refinery',
    brief: 'The refinery tanks are full of Mitosis blobs. Every one you pop splits in two, then two again. Survive 100 seconds.',
    goal: { type: 'survive', time: 100 },
    level: 10,
    guns: ['swarm', 'plasma'],
    perks: ['hollow', 'hollow', 'tough', 'mags'],
    mix: [['blob', 0.2]],
    star3: { type: 'hits', n: 10 },
    reward: 70,
    radio: [
      [1, HALE, 'Blobs split when they die. Big blob, two medium, four small.'],
      [14, OKAFOR, 'Splash damage is your friend here. Lure them over the steam vents.'],
      [80, HALE, '20 seconds left!'],
    ],
  },
  {
    id: 'op7',
    name: 'Extraction',
    map: 'graveyard',
    brief: "The evac chopper can only land in one spot and it won't wait. Fight your way to the landing zone and hold it.",
    goal: { type: 'evac', after: 20, hold: 12 },
    level: 12,
    guns: ['minigun', 'railgun'],
    perks: ['hollow', 'hollow', 'tough', 'tough', 'sprint'],
    mix: [['mutant', 0.05], ['psyker', 0.03], ['blob', 0.05]],
    star3: { type: 'time', s: 75 },
    reward: 80,
    radio: [
      [1, HALE, 'Chopper is 20 seconds out. Clear a path.'],
      [20, HALE, 'Landing zone is marked! Get in the circle and STAY there.'],
      [40, OKAFOR, "Don't leave the circle, the timer only runs while you're in it!"],
    ],
  },
  {
    id: 'op8',
    name: 'Patient Zero',
    map: 'lab',
    brief: "Subject Zero is back in Hive Labs and it's evolving. It changes form twice as it gets hurt. End this.",
    goal: { type: 'boss', kind: 'zero' },
    level: 14,
    guns: ['railgun', 'plasma', 'mindray'],
    perks: ['hollow', 'hollow', 'tough', 'tough', 'hands'],
    mix: [['parasite', 0.05]],
    star3: { type: 'time', s: 180 },
    reward: 150,
    radio: [
      [1, OKAFOR, "That's it. That's Patient Zero. It used to be my colleague."],
      [8, HALE, 'Watch the floor: red lines mean tendrils are about to burst out.'],
      [30, OKAFOR, 'The lab lasers hurt it too! Use the consoles.'],
    ],
  },
];

export const opById = (id: string) => OPS.find((o) => o.id === id);

/** One line for the HUD and the result screen. */
export function goalText(g: Goal): string {
  switch (g.type) {
    case 'survive':
      return `Survive ${g.time} seconds`;
    case 'kill':
      return `Kill ${g.n} ${g.kind ? `${g.kind}s` : 'zombies'}`;
    case 'collect':
      return `Collect ${g.n} data drives`;
    case 'defend':
      return `Defend the generator for ${g.time} seconds`;
    case 'evac':
      return `Hold the landing zone for ${g.hold} seconds`;
    case 'boss':
      return 'Kill Patient Zero';
  }
}

export function star3Text(s: Star3): string {
  return s.type === 'time' ? `Finish in under ${s.s} seconds` : `Get hit ${s.n} times or less`;
}
