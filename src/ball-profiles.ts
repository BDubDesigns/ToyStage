export type BallType = "eight-ball" | "basketball" | "bowling-ball" | "super-ball" | "dodgeball" | "balloon";

// Distances/speeds use the shorter stage edge. Shared physics supports a
// contained tabletop ball and airborne objects with a floor but no ceiling.
export interface BallProfile {
  readonly id: BallType;
  readonly label: string;
  readonly hint: string;
  readonly description: string;
  readonly colors: readonly [string, string, string];
  readonly bounds: "contained" | "gravity";
  readonly radius: number;
  readonly gravity: number;
  readonly airDrag: number;
  readonly rollingDrag: number;
  readonly floorRestitution: number;
  readonly wallRestitution: number;
  readonly hitScale: number;
  readonly maxSpeed: number;
  readonly settleSpeed: number;
}

export const BALL_PROFILES: readonly BallProfile[] = [
  {
    id: "eight-ball", label: "8 Ball", hint: "Roll & drift",
    description: "No gravity: nudge it to roll and drift. Best with a top-down camera.",
    colors: ["#657078", "#20282e", "#080b10"], bounds: "contained",
    radius: 0.055, gravity: 0, airDrag: 1.05, rollingDrag: 1.05,
    floorRestitution: 0.78, wallRestitution: 0.78, hitScale: 1, maxSpeed: 2, settleSpeed: 0.015,
  },
  {
    id: "basketball", label: "Basketball", hint: "Bounce & settle",
    description: "A strong floor bounce gets lower each time. Swipe upward to send it flying!",
    colors: ["#ffd087", "#ec8736", "#a8441f"], bounds: "gravity",
    radius: 0.06, gravity: 1.85, airDrag: 0.09, rollingDrag: 1.25,
    floorRestitution: 0.8, wallRestitution: 0.76, hitScale: 1, maxSpeed: 2.2, settleSpeed: 0.075,
  },
  {
    id: "bowling-ball", label: "Bowling Ball", hint: "Heavy & low",
    description: "Heavy, with almost no bounce. Give it a firm push; it soon rolls to a stop.",
    colors: ["#a7a4da", "#564477", "#231c3e"], bounds: "gravity",
    radius: 0.062, gravity: 2.7, airDrag: 0.18, rollingDrag: 4.5,
    floorRestitution: 0.07, wallRestitution: 0.18, hitScale: 0.48, maxSpeed: 1.15, settleSpeed: 0.055,
  },
  {
    id: "super-ball", label: "Super Ball", hint: "Small & springy",
    description: "Small and super springy! It keeps bouncing high and zips off the walls.",
    colors: ["#e7ff9a", "#8cdf44", "#26764c"], bounds: "gravity",
    radius: 0.035, gravity: 1.7, airDrag: 0.025, rollingDrag: 0.2,
    floorRestitution: 0.96, wallRestitution: 0.96, hitScale: 1.05, maxSpeed: 2.4, settleSpeed: 0.035,
  },
  {
    id: "dodgeball", label: "Dodgeball", hint: "Big & soft",
    description: "A bigger, softer ball: easier to hit with a toy and gentler to control.",
    colors: ["#ffc4b6", "#e85759", "#982946"], bounds: "gravity",
    radius: 0.07, gravity: 1.5, airDrag: 0.24, rollingDrag: 1.7,
    floorRestitution: 0.7, wallRestitution: 0.62, hitScale: 0.86, maxSpeed: 1.8, settleSpeed: 0.11,
  },
  {
    id: "balloon", label: "Air-filled Balloon", hint: "Float softly down",
    description: "Filled with air, it falls softly. Bat it high and watch the arrow until it floats back!",
    colors: ["#ffcee9", "#f075bb", "#b8358e"], bounds: "gravity",
    radius: 0.075, gravity: 0.26, airDrag: 1.05, rollingDrag: 1.6,
    floorRestitution: 0.62, wallRestitution: 0.8, hitScale: 1.5, maxSpeed: 2.7, settleSpeed: 0.065,
  },
];

export function getBallProfile(type: BallType): BallProfile {
  return BALL_PROFILES.find(profile => profile.id === type)!;
}
