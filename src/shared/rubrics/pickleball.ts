import type { SportRubric } from "../rubric";

// Default skill rubric for pickleball. Coaches can rename, reorder, add, or retire skills.
export const PICKLEBALL_RUBRIC: SportRubric = {
  sport: "pickleball",
  label: "Pickleball",
  skills: [
    { category: "Shots", name: "Serve", description: "Depth, consistency, and placement." },
    {
      category: "Shots",
      name: "Return",
      description: "Deep returns that buy time to reach the kitchen.",
    },
    {
      category: "Shots",
      name: "Dink",
      description: "Soft, low, unattackable dinks crosscourt and straight.",
    },
    {
      category: "Shots",
      name: "Third-shot drop",
      description: "Drops that land in the kitchen from the baseline.",
    },
    {
      category: "Shots",
      name: "Drive",
      description: "Pace and control on drives and passing shots.",
    },
    {
      category: "Shots",
      name: "Volley",
      description: "Punch, block, and roll volleys at the line.",
    },
    {
      category: "Shots",
      name: "Reset",
      description: "Neutralizing hard balls back into the kitchen.",
    },
    { category: "Shots", name: "Lob", description: "Offensive and defensive lob control." },
    { category: "Shots", name: "Overhead", description: "Putting away high balls with control." },
    { category: "Movement", name: "Footwork", description: "Split step, balance, and recovery." },
    {
      category: "Movement",
      name: "Transition zone",
      description: "Moving forward safely through mid-court.",
    },
    { category: "Strategy", name: "Positioning", description: "Court coverage with a partner." },
    { category: "Strategy", name: "Stacking", description: "Executing stacking and switching." },
    {
      category: "Strategy",
      name: "Shot selection",
      description: "Choosing when to speed up, reset, or dink.",
    },
    {
      category: "Strategy",
      name: "Communication",
      description: "Calling balls and coordinating with a partner.",
    },
    {
      category: "Mental",
      name: "Composure",
      description: "Staying calm and consistent under pressure.",
    },
  ],
};
